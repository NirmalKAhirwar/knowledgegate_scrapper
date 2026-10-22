"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/lib/db";
import { getQuestionsByIds, getSession, parseScope } from "@/lib/queries";
import type { GradingSource } from "@/lib/types";

export interface PracticeFormState {
  error?: string;
}

const optionSchema = z.object({
  sessionId: z.string().min(1).max(64),
  questionId: z.string().min(1).max(64),
  selectedOrd: z.number().int().min(0).max(20),
  elapsedSeconds: z.number().min(0).max(36000),
});

const selfGradeSchema = optionSchema.extend({
  isCorrect: z.boolean(),
});

const keySchema = z.object({
  sessionId: z.string().min(1).max(64),
  questionId: z.string().min(1).max(64),
  correctOrd: z.number().int().min(0).max(20),
  selectedOrd: z.number().int().min(0).max(20).nullable(),
  elapsedSeconds: z.number().min(0).max(36000),
});

const skipSchema = z.object({
  sessionId: z.string().min(1).max(64),
  questionId: z.string().min(1).max(64),
  elapsedSeconds: z.number().min(0).max(36000),
});

interface QuestionKeyRow {
  id: string;
  topic_id: string | null;
  subject_id: string | null;
  kind: string | null;
  answer_available: number;
  answer_correct_options: string | null;
  solution_text: string | null;
}

function assertQuestionInSession(sessionId: string, questionId: string): QuestionKeyRow {
  const session = getSession(sessionId);
  if (!session) throw new Error("Session not found.");
  const scope = parseScope(session.scope_json);
  if (!scope || !scope.questionIds.includes(questionId)) {
    throw new Error("Question does not belong to this session.");
  }

  const row = db
    .prepare(
      `SELECT id, topic_id, subject_id, kind, answer_available, answer_correct_options,
              solution_text
       FROM question WHERE id = ?`,
    )
    .get(questionId) as QuestionKeyRow | undefined;
  if (!row) throw new Error("Question not found.");
  return row;
}

function recomputeSession(sessionId: string): void {
  db.prepare(
    `UPDATE session SET
       correct = (SELECT COUNT(*) FROM attempt WHERE session_id = ? AND is_correct = 1),
       incorrect = (SELECT COUNT(*) FROM attempt WHERE session_id = ? AND is_correct = 0),
       skipped = (SELECT COUNT(*) FROM attempt WHERE session_id = ? AND is_correct IS NULL)
     WHERE id = ?`,
  ).run(sessionId, sessionId, sessionId, sessionId);

  const counts = db
    .prepare(
      `SELECT s.total,
              (SELECT COUNT(*) FROM attempt a WHERE a.session_id = s.id) AS recorded
       FROM session s WHERE s.id = ?`,
    )
    .get(sessionId) as { total: number; recorded: number } | undefined;
  if (counts && counts.recorded >= counts.total) {
    db.prepare("UPDATE session SET ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(
      Date.now() / 1000,
      sessionId,
    );
  }
}

function saveAttempt(input: {
  sessionId: string;
  question: QuestionKeyRow;
  selectedOption: string | null;
  isCorrect: boolean | null;
  gradingSource: GradingSource | null;
  elapsedSeconds: number;
}): void {
  const existing = db
    .prepare(
      "SELECT id FROM attempt WHERE session_id = ? AND question_id = ? ORDER BY id DESC LIMIT 1",
    )
    .get(input.sessionId, input.question.id) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE attempt SET selected_option = ?, is_correct = ?, elapsed_seconds = ?,
              answered_at = ?, grading_source = ?
       WHERE id = ?`,
    ).run(
      input.selectedOption,
      input.isCorrect === null ? null : input.isCorrect ? 1 : 0,
      input.elapsedSeconds,
      Date.now() / 1000,
      input.gradingSource,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO attempt (session_id, question_id, topic_id, subject_id, kind,
                            selected_option, is_correct, elapsed_seconds, answered_at,
                            grading_source)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.sessionId,
      input.question.id,
      input.question.topic_id,
      input.question.subject_id,
      input.question.kind,
      input.selectedOption,
      input.isCorrect === null ? null : input.isCorrect ? 1 : 0,
      input.elapsedSeconds,
      Date.now() / 1000,
      input.gradingSource,
    );
  }

  recomputeSession(input.sessionId);
}

function correctOrdSet(questionId: string, fallback: string | null): Set<number> {
  const options = db
    .prepare("SELECT ord, is_correct FROM option WHERE question_id = ? ORDER BY ord")
    .all(questionId) as Array<{ ord: number; is_correct: number }>;
  const marked = new Set(options.filter((option) => option.is_correct === 1).map((o) => o.ord));
  if (marked.size > 0) return marked;

  if (fallback) {
    try {
      const ids = JSON.parse(fallback) as Array<string | number>;
      return new Set(ids.map((id) => Number(id)).filter((id) => Number.isInteger(id)));
    } catch {
      const single = Number(fallback);
      return Number.isInteger(single) ? new Set([single]) : new Set();
    }
  }
  return new Set();
}

function lookupLabel(
  table: "course" | "subject" | "chapter" | "topic",
  id: string,
): string | null {
  if (!id) return null;
  const row = db
    .prepare(
      `SELECT COALESCE(NULLIF(title, ''), slug) AS label FROM ${table} WHERE id = ?`,
    )
    .get(id) as { label: string } | undefined;
  return row?.label ?? null;
}

export async function createSessionAction(
  _previous: PracticeFormState,
  formData: FormData,
): Promise<PracticeFormState> {
  const courseId = String(formData.get("courseId") ?? "").trim();
  const subjectId = String(formData.get("subjectId") ?? "").trim();
  const chapterId = String(formData.get("chapterId") ?? "").trim();
  const topicId = String(formData.get("topicId") ?? "").trim();
  const examSlug = String(formData.get("examSlug") ?? "").trim();
  const yearRaw = String(formData.get("year") ?? "").trim();
  const kind = String(formData.get("kind") ?? "both");
  const mode = String(formData.get("mode") ?? "study");
  const count = Number(formData.get("count") ?? 20);
  const shuffle = formData.get("shuffle") === "on";
  const unattemptedOnly = formData.get("unattemptedOnly") === "on";

  if (!["pyq", "practice", "both"].includes(kind)) {
    return { error: "Choose a valid question type." };
  }
  if (!["study", "timed"].includes(mode)) {
    return { error: "Choose a valid session mode." };
  }
  if (!Number.isInteger(count) || count < 1 || count > 100) {
    return { error: "Question count must be between 1 and 100." };
  }

  const where: string[] = ["EXISTS (SELECT 1 FROM option o WHERE o.question_id = q.id)"];
  const params: unknown[] = [];

  if (topicId) {
    where.push("q.topic_id = ?");
    params.push(topicId);
  } else if (chapterId) {
    where.push("q.chapter_id = ?");
    params.push(chapterId);
  } else if (subjectId) {
    where.push("q.subject_id = ?");
    params.push(subjectId);
  } else if (courseId) {
    where.push("q.subject_id IN (SELECT id FROM subject WHERE course_id = ?)");
    params.push(courseId);
  }

  if (kind !== "both") {
    where.push("q.kind = ?");
    params.push(kind);
  }
  if (examSlug) {
    where.push("q.exam_slug = ?");
    params.push(examSlug);
  }
  const year = Number(yearRaw);
  if (yearRaw && Number.isInteger(year) && year >= 1990 && year <= 2100) {
    where.push("q.year = ?");
    params.push(year);
  }
  if (unattemptedOnly) {
    where.push("NOT EXISTS (SELECT 1 FROM attempt a WHERE a.question_id = q.id)");
  }

  const ids = db
    .prepare(
      `SELECT q.id FROM question q
       WHERE ${where.join(" AND ")}
       ORDER BY ${shuffle ? "RANDOM()" : "q.subject_id, q.chapter_id, q.topic_id, q.number"}
       LIMIT ?`,
    )
    .all(...params, count) as Array<{ id: string }>;

  if (ids.length === 0) {
    return { error: "No questions match those filters. Try a broader scope." };
  }

  const label =
    lookupLabel("topic", topicId) ??
    lookupLabel("chapter", chapterId) ??
    lookupLabel("subject", subjectId) ??
    lookupLabel("course", courseId) ??
    (examSlug ? examSlug.toUpperCase() : "Mixed practice");

  const sessionId = randomUUID();
  const scope = {
    label,
    courseId: courseId || undefined,
    subjectId: subjectId || undefined,
    chapterId: chapterId || undefined,
    topicId: topicId || undefined,
    examSlug: examSlug || undefined,
    year: yearRaw && Number.isInteger(year) ? year : undefined,
    kind,
    mode,
    shuffle,
    unattemptedOnly,
    questionIds: ids.map((row) => row.id),
  };

  db.prepare(
    `INSERT INTO session (id, scope_json, kind, started_at, total, mode, paused_seconds)
     VALUES (?,?,?,?,?,?,0)`,
  ).run(
    sessionId,
    JSON.stringify(scope),
    kind === "both" ? "pyq,practice" : kind,
    Date.now() / 1000,
    ids.length,
    mode,
  );

  redirect(`/practice/session/${sessionId}`);
}

export async function submitAnswerAction(input: unknown): Promise<{
  graded: boolean;
  isCorrect?: boolean;
  correctOrds?: number[];
  solution?: string | null;
  feedback?: string | null;
}> {
  const parsed = optionSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid answer.");
  const { sessionId, questionId, selectedOrd, elapsedSeconds } = parsed.data;
  const question = assertQuestionInSession(sessionId, questionId);

  const selected = db
    .prepare("SELECT ord, label, feedback FROM option WHERE question_id = ? AND ord = ?")
    .get(questionId, selectedOrd) as
    | { ord: number; label: string | null; feedback: string | null }
    | undefined;
  if (!selected) throw new Error("Option not found.");

  if (!question.answer_available) {
    return { graded: false };
  }

  const correct = correctOrdSet(questionId, question.answer_correct_options);
  const isCorrect = correct.has(selectedOrd);
  saveAttempt({
    sessionId,
    question,
    selectedOption: selected.label ?? String(selectedOrd),
    isCorrect,
    gradingSource: "key",
    elapsedSeconds,
  });

  return {
    graded: true,
    isCorrect,
    correctOrds: [...correct],
    solution: question.solution_text,
    feedback: selected.feedback,
  };
}

export async function selfGradeAction(input: unknown): Promise<void> {
  const parsed = selfGradeSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid self-grade.");
  const { sessionId, questionId, selectedOrd, elapsedSeconds, isCorrect } = parsed.data;
  const question = assertQuestionInSession(sessionId, questionId);
  const selected = db
    .prepare("SELECT label FROM option WHERE question_id = ? AND ord = ?")
    .get(questionId, selectedOrd) as { label: string | null } | undefined;
  if (!selected) throw new Error("Option not found.");

  saveAttempt({
    sessionId,
    question,
    selectedOption: selected.label ?? String(selectedOrd),
    isCorrect,
    gradingSource: "self",
    elapsedSeconds,
  });
}

export async function setAnswerKeyAction(input: unknown): Promise<{
  correctOrds: number[];
  isCorrect: boolean | null;
  solution: string | null;
  feedback: string | null;
}> {
  const parsed = keySchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid answer key.");
  const { sessionId, questionId, correctOrd, selectedOrd, elapsedSeconds } = parsed.data;
  const question = assertQuestionInSession(sessionId, questionId);

  const option = db
    .prepare("SELECT ord FROM option WHERE question_id = ? AND ord = ?")
    .get(questionId, correctOrd) as { ord: number } | undefined;
  if (!option) throw new Error("Correct option not found.");

  const answers = JSON.stringify([String(correctOrd)]);
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE question SET answer_correct_option = ?, answer_correct_options = ?,
              answer_available = 1, answer_source = 'manual'
       WHERE id = ?`,
    ).run(String(correctOrd), answers, questionId);
    db.prepare("UPDATE option SET is_correct = CASE WHEN ord = ? THEN 1 ELSE 0 END WHERE question_id = ?").run(
      correctOrd,
      questionId,
    );
  });
  tx();

  let isCorrect: boolean | null = null;
  let feedback: string | null = null;
  if (selectedOrd != null) {
    const selected = db
      .prepare("SELECT label, feedback FROM option WHERE question_id = ? AND ord = ?")
      .get(questionId, selectedOrd) as
      | { label: string | null; feedback: string | null }
      | undefined;
    feedback = selected?.feedback ?? null;
    isCorrect = selectedOrd === correctOrd;
    saveAttempt({
      sessionId,
      question: { ...question, answer_available: 1 },
      selectedOption: selected?.label ?? String(selectedOrd),
      isCorrect,
      gradingSource: "key",
      elapsedSeconds,
    });
  }

  return {
    correctOrds: [correctOrd],
    isCorrect,
    solution: question.solution_text,
    feedback,
  };
}

export async function skipQuestionAction(input: unknown): Promise<void> {
  const parsed = skipSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid skip.");
  const { sessionId, questionId, elapsedSeconds } = parsed.data;
  const question = assertQuestionInSession(sessionId, questionId);

  saveAttempt({
    sessionId,
    question,
    selectedOption: null,
    isCorrect: null,
    gradingSource: null,
    elapsedSeconds,
  });
}

export async function finishSessionAction(sessionId: string): Promise<void> {
  const session = getSession(sessionId);
  if (!session) return;
  recomputeSession(sessionId);
  db.prepare("UPDATE session SET ended_at = COALESCE(ended_at, ?) WHERE id = ?").run(
    Date.now() / 1000,
    sessionId,
  );
  revalidatePath("/history");
  revalidatePath("/analytics");
}

export async function retryQuestionsAction(formData: FormData): Promise<void> {
  const raw = String(formData.get("questionIds") ?? "");
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      ids = parsed.filter((value): value is string => typeof value === "string").slice(0, 100);
    }
  } catch {
    redirect("/practice");
  }

  const questions = getQuestionsByIds(ids);
  if (questions.length === 0) redirect("/practice");

  const sessionId = randomUUID();
  const scope = {
    label: "Retry incorrect",
    kind: "both",
    mode: "study",
    shuffle: false,
    unattemptedOnly: false,
    questionIds: questions.map((question) => question.id),
  };

  db.prepare(
    `INSERT INTO session (id, scope_json, kind, started_at, total, mode, paused_seconds)
     VALUES (?,?,?,?,?,?,0)`,
  ).run(
    sessionId,
    JSON.stringify(scope),
    "pyq,practice",
    Date.now() / 1000,
    questions.length,
    "study",
  );

  redirect(`/practice/session/${sessionId}`);
}
