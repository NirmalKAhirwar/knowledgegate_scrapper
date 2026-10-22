export type PracticeKind = "pyq" | "practice" | "both";
export type SessionMode = "study" | "timed";
export type GradingSource = "key" | "self";

export interface CourseOption {
  id: string;
  slug: string;
  title: string;
  pyq_count: number;
  practice_count: number;
}

export interface SubjectOption {
  id: string;
  course_id: string;
  slug: string;
  title: string;
  ord: number;
  pyq_count: number;
  practice_count: number;
}

export interface ChapterOption {
  id: string;
  subject_id: string;
  slug: string;
  title: string;
  ord: number;
  pyq_count: number;
  practice_count: number;
}

export interface TopicOption {
  id: string;
  chapter_id: string;
  subject_id: string;
  slug: string;
  title: string;
  ord: number;
  pyq_count: number;
  practice_count: number;
}

export interface ExamOption {
  exam_slug: string;
  exam_name: string;
  questions: number;
}

export interface Taxonomy {
  courses: CourseOption[];
  subjects: SubjectOption[];
  chapters: ChapterOption[];
  topics: TopicOption[];
}

export interface AnswerOption {
  ord: number;
  label: string;
  text: string;
  is_correct: number;
  feedback: string | null;
}

export interface SessionQuestion {
  id: string;
  kind: string;
  type: string;
  question_text: string;
  instructions: string | null;
  solution_text: string | null;
  answer_available: number;
  answer_correct_option: string | null;
  answer_correct_options: string | null;
  avg_success_rate: number | null;
  total_attempts: number | null;
  median_time_taken: number | null;
  exam_name: string | null;
  exam_slug: string | null;
  year: number | null;
  paper_label: string | null;
  section_label: string | null;
  topic_id: string | null;
  topic_title: string | null;
  subject_id: string | null;
  subject_title: string | null;
  chapter_title: string | null;
  options: AnswerOption[];
}

export interface SessionRecord {
  id: string;
  scope_json: string | null;
  kind: string | null;
  started_at: number;
  ended_at: number | null;
  total: number;
  correct: number;
  incorrect: number;
  skipped: number;
  mode: SessionMode | null;
  paused_seconds: number | null;
}

export interface SessionScope {
  label?: string;
  courseId?: string;
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  examSlug?: string;
  year?: number;
  kind: PracticeKind;
  mode: SessionMode;
  shuffle: boolean;
  unattemptedOnly: boolean;
  questionIds: string[];
}

export interface AttemptRow {
  id: number;
  session_id: string;
  question_id: string;
  topic_id: string | null;
  subject_id: string | null;
  kind: string | null;
  selected_option: string | null;
  is_correct: number | null;
  elapsed_seconds: number | null;
  answered_at: number;
  grading_source: GradingSource | null;
}

export interface DailyPoint {
  day: string;
  attempts: number;
  correct: number;
  seconds: number;
  accuracy: number;
}

export interface SubjectPerformance {
  id: string;
  title: string;
  attempts: number;
  correct: number;
  seconds: number;
  accuracy: number;
}

export interface WeakTopic {
  id: string;
  title: string;
  subject: string;
  attempts: number;
  correct: number;
  accuracy: number;
  avg_seconds: number;
}

export interface SpeedAccuracyPoint {
  id: string;
  title: string;
  accuracy: number;
  avg_seconds: number;
  attempts: number;
}

export interface SessionSummaryData {
  session: SessionRecord;
  attempts: AttemptRow[];
  questions: SessionQuestion[];
  correct: number;
  incorrect: number;
  skipped: number;
  graded: number;
  accuracy: number;
  totalSeconds: number;
  averageSeconds: number;
  medianSeconds: number;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
  selfGraded: number;
  keyGraded: number;
}

export interface OverallStats {
  attempts: number;
  graded: number;
  correct: number;
  incorrect: number;
  skipped: number;
  seconds: number;
  accuracy: number;
  selfGraded: number;
  keyGraded: number;
  coverage: number;
  covered: number;
  totalQuestions: number;
  studyDays: number;
  streak: number;
}
