"use client";

import { AlertCircle, Clock3, Loader2, Play, Shuffle, Sparkles } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { Badge, Card, buttonClass } from "@/components/ui";
import { createSessionAction, type PracticeFormState } from "@/lib/actions";
import { formatNumber } from "@/lib/format";
import type { ExamOption, PracticeKind, SessionMode, Taxonomy } from "@/lib/types";
import { cn } from "@/lib/utils";

const initial: PracticeFormState = {};

const kindOptions: Array<{ value: PracticeKind; label: string; hint: string }> = [
  { value: "both", label: "Both", hint: "PYQ + practice" },
  { value: "pyq", label: "PYQ", hint: "Previous year" },
  { value: "practice", label: "Practice", hint: "Topic drills" },
];

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
      </span>
      <span className="mt-1.5 block">{children}</span>
    </label>
  );
}

const selectClass =
  "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground transition hover:bg-muted/50 focus:bg-background disabled:cursor-not-allowed disabled:opacity-50";

export function PracticeSetupForm({
  taxonomy,
  exams,
  totalQuestions,
}: {
  taxonomy: Taxonomy;
  exams: ExamOption[];
  totalQuestions: number;
}) {
  const [state, formAction, pending] = useActionState(createSessionAction, initial);

  const [courseId, setCourseId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [topicId, setTopicId] = useState("");
  const [kind, setKind] = useState<PracticeKind>("both");
  const [mode, setMode] = useState<SessionMode>("study");
  const [count, setCount] = useState(20);

  const subjects = useMemo(
    () => taxonomy.subjects.filter((subject) => !courseId || subject.course_id === courseId),
    [taxonomy.subjects, courseId],
  );
  const chapters = useMemo(
    () => taxonomy.chapters.filter((chapter) => !subjectId || chapter.subject_id === subjectId),
    [taxonomy.chapters, subjectId],
  );
  const topics = useMemo(
    () => taxonomy.topics.filter((topic) => !chapterId || topic.chapter_id === chapterId),
    [taxonomy.topics, chapterId],
  );

  const selectedTopic = taxonomy.topics.find((topic) => topic.id === topicId);
  const selectedChapter = taxonomy.chapters.find((chapter) => chapter.id === chapterId);
  const selectedSubject = taxonomy.subjects.find((subject) => subject.id === subjectId);
  const selectedCourse = taxonomy.courses.find((course) => course.id === courseId);

  const scope = selectedTopic ?? selectedChapter ?? selectedSubject ?? selectedCourse;
  const scopeLabel = selectedTopic
    ? "topic"
    : selectedChapter
      ? "chapter"
      : selectedSubject
        ? "subject"
        : selectedCourse
          ? "course"
          : "question bank";

  const totalPyq = taxonomy.courses.reduce((sum, course) => sum + course.pyq_count, 0);
  const totalPractice = taxonomy.courses.reduce(
    (sum, course) => sum + course.practice_count,
    0,
  );
  const pyqAvailable = scope?.pyq_count ?? totalPyq;
  const practiceAvailable = scope?.practice_count ?? totalPractice;
  const available =
    kind === "both"
      ? pyqAvailable + practiceAvailable
      : kind === "pyq"
        ? pyqAvailable
        : practiceAvailable;

  function resetChildren(level: "course" | "subject" | "chapter") {
    if (level === "course") {
      setSubjectId("");
      setChapterId("");
      setTopicId("");
    } else if (level === "subject") {
      setChapterId("");
      setTopicId("");
    } else {
      setTopicId("");
    }
  }

  return (
    <form action={formAction} className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
      <div className="space-y-4">
        <Card className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Choose your scope</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Narrow down to a chapter, topic, or rehearse the whole course.
              </p>
            </div>
            <Badge tone={available > 0 ? "primary" : "danger"}>
              {formatNumber(available)} available
            </Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Course">
              <select
                name="courseId"
                value={courseId}
                onChange={(event) => {
                  setCourseId(event.target.value);
                  resetChildren("course");
                }}
                className={selectClass}
              >
                <option value="">All courses</option>
                {taxonomy.courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Subject">
              <select
                name="subjectId"
                value={subjectId}
                onChange={(event) => {
                  setSubjectId(event.target.value);
                  resetChildren("subject");
                }}
                className={selectClass}
              >
                <option value="">All subjects</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.title}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Chapter">
              <select
                name="chapterId"
                value={chapterId}
                onChange={(event) => {
                  setChapterId(event.target.value);
                  resetChildren("chapter");
                }}
                disabled={!subjectId}
                className={selectClass}
              >
                <option value="">{subjectId ? "All chapters" : "Select a subject first"}</option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Topic" hint={chapterId ? undefined : "Pick a chapter first"}>
              <select
                name="topicId"
                value={topicId}
                onChange={(event) => setTopicId(event.target.value)}
                disabled={!chapterId}
                className={selectClass}
              >
                <option value="">{chapterId ? "All topics" : "Select a chapter first"}</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.title}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4 flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-[11px] text-muted-foreground">
            <Sparkles className="size-3.5 shrink-0 text-primary" />
            Practising across <span className="font-medium text-foreground">{scopeLabel}</span>
            {selectedTopic ? ` · ${selectedTopic.title}` : ""}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Question set</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Mix previous-year papers with topic-wise practice.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-2">
            {kindOptions.map((option) => (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded-xl border px-3 py-3 text-center transition",
                  kind === option.value
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="kind"
                  value={option.value}
                  checked={kind === option.value}
                  onChange={() => setKind(option.value)}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">{option.hint}</span>
              </label>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Number of questions">
              <div className="flex gap-2">
                <input
                  type="number"
                  name="count"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(event) => setCount(Number(event.target.value))}
                  className={selectClass}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[10, 20, 30, 50].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCount(preset)}
                    className={cn(
                      "rounded-lg border px-2 py-1 text-[10px] font-medium transition",
                      count === preset
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </Field>

            <div className="space-y-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-xs transition hover:bg-muted/60">
                <input
                  type="checkbox"
                  name="shuffle"
                  defaultChecked
                  className="size-3.5 accent-[var(--primary)]"
                />
                <Shuffle className="size-3.5 text-muted-foreground" />
                Shuffle question order
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 text-xs transition hover:bg-muted/60">
                <input
                  type="checkbox"
                  name="unattemptedOnly"
                  className="size-3.5 accent-[var(--primary)]"
                />
                <Sparkles className="size-3.5 text-muted-foreground" />
                Only questions I have never attempted
              </label>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Session mode</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Time is always recorded. Timed mode shows a target pace based on the platform median.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  value: "study" as const,
                  label: "Study",
                  hint: "Open timer. Search, think, and learn without pressure.",
                },
                {
                  value: "timed" as const,
                  label: "Timed",
                  hint: "Target time per question, with an over-pace indicator.",
                },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={cn(
                  "cursor-pointer rounded-xl border p-3 transition",
                  mode === option.value
                    ? "border-primary bg-primary/10"
                    : "border-border bg-background hover:bg-muted",
                )}
              >
                <input
                  type="radio"
                  name="mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  className="sr-only"
                />
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Clock3 className="size-4" />
                  {option.label}
                </span>
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                  {option.hint}
                </span>
              </label>
            ))}
          </div>
        </Card>

        <details className="rounded-2xl border border-border bg-card/80 px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Optional exam filters
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Exam">
              <select name="examSlug" defaultValue="" className={selectClass}>
                <option value="">All exams</option>
                {exams.map((exam) => (
                  <option key={exam.exam_slug} value={exam.exam_slug}>
                    {exam.exam_name} ({formatNumber(exam.questions)})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Year">
              <input
                type="number"
                name="year"
                min={1990}
                max={2100}
                placeholder="Any year"
                className={selectClass}
              />
            </Field>
          </div>
        </details>
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-br from-primary/20 via-card to-card p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Session preview
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">
              {count} {kind === "both" ? "mixed" : kind === "pyq" ? "PYQ" : "practice"} question
              {count === 1 ? "" : "s"}
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {scopeLabel} · {mode === "timed" ? "timed mode" : "study mode"}
            </p>
          </div>
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Available in scope</span>
              <span className="font-medium">{formatNumber(available)}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Estimated time</span>
              <span className="font-medium">
                {mode === "timed"
                  ? `~${Math.max(1, Math.round((count * 60) / 60))} min`
                  : `~${Math.max(1, Math.round((count * 45) / 60))} min`}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Answer keys</span>
              <span className="font-medium">Self-mark fallback</span>
            </div>

            {state?.error ? (
              <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                {state.error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={pending || available === 0}
              className={buttonClass({ size: "lg", className: "w-full" })}
            >
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Building session…
                </>
              ) : (
                <>
                  <Play className="size-4" /> Start session
                </>
              )}
            </button>
            <p className="text-center text-[10px] leading-relaxed text-muted-foreground">
              Your timer starts when the first question appears.
            </p>
          </div>
        </Card>
      </div>
    </form>
  );
}
