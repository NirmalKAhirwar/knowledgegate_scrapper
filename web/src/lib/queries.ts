import "server-only";

import { db } from "@/lib/db";
import type {
  AnswerOption,
  AttemptRow,
  ChapterOption,
  CourseOption,
  DailyPoint,
  ExamOption,
  OverallStats,
  SessionQuestion,
  SessionRecord,
  SessionScope,
  SessionSummaryData,
  SpeedAccuracyPoint,
  SubjectOption,
  SubjectPerformance,
  Taxonomy,
  TopicOption,
  WeakTopic,
} from "@/lib/types";

interface ScalarRow {
  value: number;
}

function scalar(sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as ScalarRow | undefined;
  return row?.value ?? 0;
}

function localDay(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseScope(raw: string | null): SessionScope | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SessionScope;
    if (!Array.isArray(parsed.questionIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getTaxonomy(): Taxonomy {
  const courses = db
    .prepare(
      `SELECT id, slug, COALESCE(NULLIF(title, ''), slug) AS title,
              pyq_count, practice_count
       FROM course ORDER BY title`,
    )
    .all() as CourseOption[];

  const subjects = db
    .prepare(
      `SELECT id, course_id, slug, COALESCE(NULLIF(title, ''), slug) AS title, ord,
              pyq_count, practice_count
       FROM subject ORDER BY course_id, ord, title`,
    )
    .all() as SubjectOption[];

  const chapters = db
    .prepare(
      `SELECT id, subject_id, slug, COALESCE(NULLIF(title, ''), slug) AS title, ord,
              pyq_count, practice_count
       FROM chapter ORDER BY subject_id, ord, title`,
    )
    .all() as ChapterOption[];

  const topics = db
    .prepare(
      `SELECT id, chapter_id, subject_id, slug, COALESCE(NULLIF(title, ''), slug) AS title, ord,
              pyq_count, practice_count
       FROM topic ORDER BY chapter_id, ord, title`,
    )
    .all() as TopicOption[];

  return { courses, subjects, chapters, topics };
}

export function getCourses(): CourseOption[] {
  return db
    .prepare(
      `SELECT id, slug, COALESCE(NULLIF(title, ''), slug) AS title,
              pyq_count, practice_count
       FROM course ORDER BY title`,
    )
    .all() as CourseOption[];
}

function computeStreak(days: string[]): number {
  if (days.length === 0) return 0;
  const set = new Set(days);
  let offset = set.has(localDay(0)) ? 0 : set.has(localDay(1)) ? 1 : -1;
  if (offset === -1) return 0;

  let streak = 0;
  while (set.has(localDay(offset))) {
    streak += 1;
    offset += 1;
  }
  return streak;
}

export function getOverallStats(): OverallStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS attempts,
         SUM(CASE WHEN is_correct IS NOT NULL THEN 1 ELSE 0 END) AS graded,
         SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
         SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS incorrect,
         SUM(CASE WHEN is_correct IS NULL THEN 1 ELSE 0 END) AS skipped,
         COALESCE(SUM(elapsed_seconds), 0) AS seconds,
         SUM(CASE WHEN grading_source = 'self' THEN 1 ELSE 0 END) AS selfGraded,
         SUM(CASE WHEN grading_source = 'key' THEN 1 ELSE 0 END) AS keyGraded
       FROM attempt`,
    )
    .get() as {
    attempts: number;
    graded: number;
    correct: number;
    incorrect: number;
    skipped: number;
    seconds: number;
    selfGraded: number;
    keyGraded: number;
  };

  const totalQuestions = scalar("SELECT COUNT(*) AS value FROM question");
  const covered = scalar("SELECT COUNT(DISTINCT question_id) AS value FROM attempt");
  const studyDays = scalar(
    "SELECT COUNT(DISTINCT date(answered_at, 'unixepoch', 'localtime')) AS value FROM attempt",
  );
  const days = db
    .prepare(
      `SELECT DISTINCT date(answered_at, 'unixepoch', 'localtime') AS day
       FROM attempt ORDER BY day DESC`,
    )
    .all() as Array<{ day: string }>;

  const graded = Number(row.graded ?? 0);
  const correct = Number(row.correct ?? 0);
  const incorrect = Number(row.incorrect ?? 0);

  return {
    attempts: Number(row.attempts ?? 0),
    graded,
    correct,
    incorrect,
    skipped: Number(row.skipped ?? 0),
    seconds: Number(row.seconds ?? 0),
    accuracy: graded > 0 ? (correct / graded) * 100 : 0,
    selfGraded: Number(row.selfGraded ?? 0),
    keyGraded: Number(row.keyGraded ?? 0),
    coverage: totalQuestions > 0 ? (covered / totalQuestions) * 100 : 0,
    covered,
    totalQuestions,
    studyDays,
    streak: computeStreak(days.map((entry) => entry.day)),
  };
}

export function getDailySeries(days = 30): DailyPoint[] {
  const rows = db
    .prepare(
      `SELECT date(answered_at, 'unixepoch', 'localtime') AS day,
              COUNT(*) AS attempts,
              SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              SUM(CASE WHEN is_correct IS NOT NULL THEN 1 ELSE 0 END) AS graded,
              COALESCE(SUM(elapsed_seconds), 0) AS seconds
       FROM attempt
       WHERE answered_at >= strftime('%s', 'now', ?)
       GROUP BY day
       ORDER BY day`,
    )
    .all(`-${Math.max(1, days)} days`) as Array<{
    day: string;
    attempts: number;
    correct: number;
    graded: number;
    seconds: number;
  }>;

  const byDay = new Map(rows.map((row) => [row.day, row]));
  const series: DailyPoint[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = localDay(offset);
    const row = byDay.get(day);
    const graded = Number(row?.graded ?? 0);
    const correct = Number(row?.correct ?? 0);
    series.push({
      day,
      attempts: Number(row?.attempts ?? 0),
      correct,
      seconds: Number(row?.seconds ?? 0),
      accuracy: graded > 0 ? (correct / graded) * 100 : 0,
    });
  }
  return series;
}

export function getSubjectPerformance(limit = 12): SubjectPerformance[] {
  const rows = db
    .prepare(
      `SELECT s.id, COALESCE(NULLIF(s.title, ''), s.slug) AS title,
              COUNT(*) AS attempts,
              SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              COALESCE(SUM(a.elapsed_seconds), 0) AS seconds
       FROM attempt a
       JOIN subject s ON s.id = a.subject_id
       WHERE a.is_correct IS NOT NULL
       GROUP BY s.id
       ORDER BY attempts DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    title: string;
    attempts: number;
    correct: number;
    seconds: number;
  }>;

  return rows.map((row) => ({
    ...row,
    attempts: Number(row.attempts),
    correct: Number(row.correct),
    seconds: Number(row.seconds),
    accuracy: row.attempts > 0 ? (row.correct / row.attempts) * 100 : 0,
  }));
}

export function getWeakTopics(limit = 8, minAttempts = 5): WeakTopic[] {
  const rows = db
    .prepare(
      `SELECT t.id, COALESCE(NULLIF(t.title, ''), t.slug) AS title,
              COALESCE(NULLIF(s.title, ''), s.slug) AS subject,
              COUNT(*) AS attempts,
              SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              ROUND(AVG(a.elapsed_seconds), 1) AS avg_seconds
       FROM attempt a
       JOIN topic t ON t.id = a.topic_id
       LEFT JOIN subject s ON s.id = a.subject_id
       WHERE a.is_correct IS NOT NULL
       GROUP BY t.id
       HAVING attempts >= ?
       ORDER BY (1.0 - (SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*)))
                * COUNT(*) DESC,
                attempts DESC
       LIMIT ?`,
    )
    .all(minAttempts, limit) as Array<{
    id: string;
    title: string;
    subject: string | null;
    attempts: number;
    correct: number;
    avg_seconds: number | null;
  }>;

  return rows.map((row) => ({
    ...row,
    subject: row.subject ?? "—",
    attempts: Number(row.attempts),
    correct: Number(row.correct),
    avg_seconds: Number(row.avg_seconds ?? 0),
    accuracy: Number(row.attempts) > 0 ? (Number(row.correct) / Number(row.attempts)) * 100 : 0,
  }));
}

export function getSpeedAccuracyPoints(limit = 40): SpeedAccuracyPoint[] {
  const rows = db
    .prepare(
      `SELECT t.id, COALESCE(NULLIF(t.title, ''), t.slug) AS title,
              COUNT(*) AS attempts,
              SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              ROUND(AVG(a.elapsed_seconds), 1) AS avg_seconds
       FROM attempt a
       JOIN topic t ON t.id = a.topic_id
       WHERE a.is_correct IS NOT NULL AND a.elapsed_seconds IS NOT NULL
       GROUP BY t.id
       HAVING attempts >= 3
       ORDER BY attempts DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
    id: string;
    title: string;
    attempts: number;
    correct: number;
    avg_seconds: number;
  }>;

  return rows.map((row) => ({
    ...row,
    attempts: Number(row.attempts),
    accuracy: Number(row.attempts) > 0 ? (Number(row.correct) / Number(row.attempts)) * 100 : 0,
    avg_seconds: Number(row.avg_seconds ?? 0),
  }));
}

export function getRecentSessions(limit = 6): SessionRecord[] {
  return db
    .prepare("SELECT * FROM session ORDER BY started_at DESC LIMIT ?")
    .all(limit) as SessionRecord[];
}

export function getSessionHistory(limit = 60): SessionRecord[] {
  return db
    .prepare("SELECT * FROM session ORDER BY started_at DESC LIMIT ?")
    .all(limit) as SessionRecord[];
}

export function getSession(id: string): SessionRecord | null {
  return (
    (db.prepare("SELECT * FROM session WHERE id = ?").get(id) as SessionRecord | undefined) ??
    null
  );
}

export function getAttemptsForSession(id: string): AttemptRow[] {
  return db
    .prepare(
      `SELECT id, session_id, question_id, topic_id, subject_id, kind, selected_option,
              is_correct, elapsed_seconds, answered_at, grading_source
       FROM attempt WHERE session_id = ? ORDER BY id`,
    )
    .all(id) as AttemptRow[];
}

export function getQuestionsByIds(ids: string[]): SessionQuestion[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT q.id, q.kind, q.type, q.question_text, q.instructions, q.solution_text,
              q.answer_available, q.answer_correct_option, q.answer_correct_options,
              q.avg_success_rate, q.total_attempts, q.median_time_taken,
              q.exam_name, q.exam_slug, q.year, q.paper_label, q.section_label,
              q.topic_id, COALESCE(NULLIF(t.title, ''), t.slug) AS topic_title,
              q.subject_id, COALESCE(NULLIF(s.title, ''), s.slug) AS subject_title,
              COALESCE(NULLIF(c.title, ''), c.slug) AS chapter_title
       FROM question q
       LEFT JOIN topic t ON t.id = q.topic_id
       LEFT JOIN subject s ON s.id = q.subject_id
       LEFT JOIN chapter c ON c.id = q.chapter_id
       WHERE q.id IN (${placeholders})`,
    )
    .all(...ids) as Array<
    Omit<SessionQuestion, "options"> & { options?: AnswerOption[] }
  >;

  const optionRows = db
    .prepare(
      `SELECT question_id, ord, label, text, is_correct, feedback
       FROM option WHERE question_id IN (${placeholders})
       ORDER BY question_id, ord`,
    )
    .all(...ids) as Array<AnswerOption & { question_id: string }>;

  const optionsByQuestion = new Map<string, AnswerOption[]>();
  for (const option of optionRows) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push({
      ord: option.ord,
      label: option.label,
      text: option.text,
      is_correct: option.is_correct,
      feedback: option.feedback,
    });
    optionsByQuestion.set(option.question_id, list);
  }

  const byId = new Map(
    rows.map((row) => [
      row.id,
      { ...row, options: optionsByQuestion.get(row.id) ?? [] } as SessionQuestion,
    ]),
  );

  return ids.map((id) => byId.get(id)).filter((row): row is SessionQuestion => Boolean(row));
}

export function getSessionQuestions(session: SessionRecord): SessionQuestion[] {
  const scope = parseScope(session.scope_json);
  if (!scope) return [];
  return getQuestionsByIds(scope.questionIds);
}

export function getSessionSummary(id: string): SessionSummaryData | null {
  const session = getSession(id);
  if (!session) return null;
  const attempts = getAttemptsForSession(id);
  const questions = getSessionQuestions(session);

  const gradedAttempts = attempts.filter((attempt) => attempt.is_correct !== null);
  const correct = gradedAttempts.filter((attempt) => attempt.is_correct === 1).length;
  const incorrect = gradedAttempts.filter((attempt) => attempt.is_correct === 0).length;
  const skipped = attempts.length - gradedAttempts.length;
  const times = gradedAttempts
    .map((attempt) => attempt.elapsed_seconds)
    .filter((value): value is number => value != null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const totalSeconds = attempts.reduce(
    (sum, attempt) => sum + Math.max(0, Number(attempt.elapsed_seconds ?? 0)),
    0,
  );
  const median =
    times.length === 0
      ? 0
      : times.length % 2 === 1
        ? times[Math.floor(times.length / 2)]
        : (times[times.length / 2 - 1] + times[times.length / 2]) / 2;

  return {
    session,
    attempts,
    questions,
    correct,
    incorrect,
    skipped,
    graded: gradedAttempts.length,
    accuracy: gradedAttempts.length > 0 ? (correct / gradedAttempts.length) * 100 : 0,
    totalSeconds,
    averageSeconds: times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0,
    medianSeconds: median,
    fastestSeconds: times.length > 0 ? times[0] : null,
    slowestSeconds: times.length > 0 ? times[times.length - 1] : null,
    selfGraded: attempts.filter((attempt) => attempt.grading_source === "self").length,
    keyGraded: attempts.filter((attempt) => attempt.grading_source === "key").length,
  };
}

export interface AnalyticsFilters {
  courseId?: string;
  kind?: string;
  grading?: string;
  days?: number;
}

function analyticsWhere(filters: AnalyticsFilters): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  const days = Math.max(1, Math.min(3650, filters.days ?? 90));
  where.push("a.answered_at >= strftime('%s', 'now', ?)");
  params.push(`-${days} days`);

  if (filters.courseId) {
    where.push("a.subject_id IN (SELECT id FROM subject WHERE course_id = ?)");
    params.push(filters.courseId);
  }
  if (filters.kind === "pyq" || filters.kind === "practice") {
    where.push("a.kind = ?");
    params.push(filters.kind);
  }
  if (filters.grading === "key" || filters.grading === "self") {
    where.push("a.grading_source = ?");
    params.push(filters.grading);
  }

  return { clause: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "", params };
}

export interface AnalyticsData {
  attemptedQuestions: number;
  totalQuestions: number;
  sessions: number;
  accuracy: number;
  graded: number;
  correct: number;
  incorrect: number;
  skipped: number;
  seconds: number;
  avgSeconds: number;
  selfGraded: number;
  keyGraded: number;
  coverage: number;
  daily: DailyPoint[];
  subjects: SubjectPerformance[];
  weakTopics: WeakTopic[];
  speedAccuracy: SpeedAccuracyPoint[];
}

export function getAnalytics(filters: AnalyticsFilters): AnalyticsData {
  const { clause, params } = analyticsWhere(filters);
  const days = Math.max(1, Math.min(3650, filters.days ?? 90));

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS attempts,
              SUM(CASE WHEN a.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS graded,
              SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              SUM(CASE WHEN a.is_correct = 0 THEN 1 ELSE 0 END) AS incorrect,
              SUM(CASE WHEN a.is_correct IS NULL THEN 1 ELSE 0 END) AS skipped,
              COALESCE(SUM(a.elapsed_seconds), 0) AS seconds,
              SUM(CASE WHEN a.grading_source = 'self' THEN 1 ELSE 0 END) AS selfGraded,
              SUM(CASE WHEN a.grading_source = 'key' THEN 1 ELSE 0 END) AS keyGraded,
              COUNT(DISTINCT a.question_id) AS covered
       FROM attempt a
       ${clause}`,
    )
    .get(...params) as {
    attempts: number;
    graded: number;
    correct: number;
    incorrect: number;
    skipped: number;
    seconds: number;
    selfGraded: number;
    keyGraded: number;
    covered: number;
  };

  const totalWhere: string[] = [];
  const totalParams: unknown[] = [];
  if (filters.courseId) {
    totalWhere.push("q.subject_id IN (SELECT id FROM subject WHERE course_id = ?)");
    totalParams.push(filters.courseId);
  }
  if (filters.kind === "pyq" || filters.kind === "practice") {
    totalWhere.push("q.kind = ?");
    totalParams.push(filters.kind);
  }
  const totalQuestions = scalar(
    `SELECT COUNT(*) AS value FROM question q ${totalWhere.length > 0 ? `WHERE ${totalWhere.join(" AND ")}` : ""}`,
    ...totalParams,
  );

  const sessionWhere = ["started_at >= strftime('%s', 'now', ?)"];
  const sessionParams: unknown[] = [`-${days} days`];
  if (filters.courseId) {
    sessionWhere.push(
      "id IN (SELECT session_id FROM attempt WHERE subject_id IN (SELECT id FROM subject WHERE course_id = ?))",
    );
    sessionParams.push(filters.courseId);
  }
  const sessions = scalar(
    `SELECT COUNT(*) AS value FROM session WHERE ${sessionWhere.join(" AND ")}`,
    ...sessionParams,
  );

  const dailyRows = db
    .prepare(
      `SELECT date(a.answered_at, 'unixepoch', 'localtime') AS day,
              COUNT(*) AS attempts,
              SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              SUM(CASE WHEN a.is_correct IS NOT NULL THEN 1 ELSE 0 END) AS graded,
              COALESCE(SUM(a.elapsed_seconds), 0) AS seconds
       FROM attempt a ${clause}
       GROUP BY day ORDER BY day`,
    )
    .all(...params) as Array<{
    day: string;
    attempts: number;
    correct: number;
    graded: number;
    seconds: number;
  }>;
  const dailyMap = new Map(dailyRows.map((row) => [row.day, row]));
  const chartDays = Math.min(days, 90);
  const daily: DailyPoint[] = [];
  for (let offset = chartDays - 1; offset >= 0; offset -= 1) {
    const day = localDay(offset);
    const row = dailyMap.get(day);
    const graded = Number(row?.graded ?? 0);
    const correct = Number(row?.correct ?? 0);
    daily.push({
      day,
      attempts: Number(row?.attempts ?? 0),
      correct,
      seconds: Number(row?.seconds ?? 0),
      accuracy: graded > 0 ? (correct / graded) * 100 : 0,
    });
  }

  const subjectRows = db
    .prepare(
      `SELECT s.id, COALESCE(NULLIF(s.title, ''), s.slug) AS title,
              COUNT(*) AS attempts,
              SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              COALESCE(SUM(a.elapsed_seconds), 0) AS seconds
       FROM attempt a
       JOIN subject s ON s.id = a.subject_id
       ${clause} ${clause ? "AND" : "WHERE"} a.is_correct IS NOT NULL
       GROUP BY s.id
       ORDER BY attempts DESC
       LIMIT 14`,
    )
    .all(...params) as Array<{
    id: string;
    title: string;
    attempts: number;
    correct: number;
    seconds: number;
  }>;

  const weakRows = db
    .prepare(
      `SELECT t.id, COALESCE(NULLIF(t.title, ''), t.slug) AS title,
              COALESCE(NULLIF(s.title, ''), s.slug) AS subject,
              COUNT(*) AS attempts,
              SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              ROUND(AVG(a.elapsed_seconds), 1) AS avg_seconds
       FROM attempt a
       JOIN topic t ON t.id = a.topic_id
       LEFT JOIN subject s ON s.id = a.subject_id
       ${clause} ${clause ? "AND" : "WHERE"} a.is_correct IS NOT NULL
       GROUP BY t.id
       HAVING attempts >= 3
       ORDER BY (1.0 - (SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) * 1.0 / COUNT(*)))
                * COUNT(*) DESC
       LIMIT 10`,
    )
    .all(...params) as Array<{
    id: string;
    title: string;
    subject: string | null;
    attempts: number;
    correct: number;
    avg_seconds: number | null;
  }>;

  const speedRows = db
    .prepare(
      `SELECT t.id, COALESCE(NULLIF(t.title, ''), t.slug) AS title,
              COUNT(*) AS attempts,
              SUM(CASE WHEN a.is_correct = 1 THEN 1 ELSE 0 END) AS correct,
              ROUND(AVG(a.elapsed_seconds), 1) AS avg_seconds
       FROM attempt a
       JOIN topic t ON t.id = a.topic_id
       ${clause} ${clause ? "AND" : "WHERE"} a.is_correct IS NOT NULL AND a.elapsed_seconds IS NOT NULL
       GROUP BY t.id
       HAVING attempts >= 2
       ORDER BY attempts DESC
       LIMIT 40`,
    )
    .all(...params) as Array<{
    id: string;
    title: string;
    attempts: number;
    correct: number;
    avg_seconds: number;
  }>;

  const correct = Number(totals.correct ?? 0);
  const graded = Number(totals.graded ?? 0);
  const seconds = Number(totals.seconds ?? 0);

  return {
    attemptedQuestions: Number(totals.covered ?? 0),
    totalQuestions,
    sessions,
    accuracy: graded > 0 ? (correct / graded) * 100 : 0,
    graded,
    correct,
    incorrect: Number(totals.incorrect ?? 0),
    skipped: Number(totals.skipped ?? 0),
    seconds,
    avgSeconds: graded > 0 ? seconds / graded : 0,
    selfGraded: Number(totals.selfGraded ?? 0),
    keyGraded: Number(totals.keyGraded ?? 0),
    coverage: totalQuestions > 0 ? (Number(totals.covered ?? 0) / totalQuestions) * 100 : 0,
    daily,
    subjects: subjectRows.map((row) => ({
      ...row,
      attempts: Number(row.attempts),
      correct: Number(row.correct),
      seconds: Number(row.seconds),
      accuracy: Number(row.attempts) > 0 ? (Number(row.correct) / Number(row.attempts)) * 100 : 0,
    })),
    weakTopics: weakRows.map((row) => ({
      ...row,
      subject: row.subject ?? "—",
      attempts: Number(row.attempts),
      correct: Number(row.correct),
      avg_seconds: Number(row.avg_seconds ?? 0),
      accuracy:
        Number(row.attempts) > 0 ? (Number(row.correct) / Number(row.attempts)) * 100 : 0,
    })),
    speedAccuracy: speedRows.map((row) => ({
      id: row.id,
      title: row.title,
      attempts: Number(row.attempts),
      accuracy:
        Number(row.attempts) > 0 ? (Number(row.correct) / Number(row.attempts)) * 100 : 0,
      avg_seconds: Number(row.avg_seconds ?? 0),
    })),
  };
}

export function getQuestionCounts(courseId?: string): {
  questions: number;
  pyq: number;
  practice: number;
  answers: number;
} {
  const where = courseId ? "WHERE subject_id IN (SELECT id FROM subject WHERE course_id = ?)" : "";
  const params = courseId ? [courseId] : [];
  const row = db
    .prepare(
      `SELECT COUNT(*) AS questions,
              SUM(CASE WHEN kind = 'pyq' THEN 1 ELSE 0 END) AS pyq,
              SUM(CASE WHEN kind = 'practice' THEN 1 ELSE 0 END) AS practice,
              SUM(CASE WHEN answer_available = 1 THEN 1 ELSE 0 END) AS answers
       FROM question ${where}`,
    )
    .get(...params) as {
    questions: number;
    pyq: number;
    practice: number;
    answers: number;
  };
  return {
    questions: Number(row.questions ?? 0),
    pyq: Number(row.pyq ?? 0),
    practice: Number(row.practice ?? 0),
    answers: Number(row.answers ?? 0),
  };
}

export function getExamOptions(): ExamOption[] {
  return db
    .prepare(
      `SELECT exam_slug, COALESCE(NULLIF(exam_name, ''), exam_slug) AS exam_name,
              COUNT(*) AS questions
       FROM question
       WHERE kind = 'pyq' AND exam_slug IS NOT NULL AND exam_slug != ''
       GROUP BY exam_slug
       ORDER BY questions DESC, exam_name`,
    )
    .all() as ExamOption[];
}
