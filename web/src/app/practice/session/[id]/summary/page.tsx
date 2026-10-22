import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Flag,
  Gauge,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  Timer,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading,
  StatCard,
  buttonClass,
} from "@/components/ui";
import { retryQuestionsAction } from "@/lib/actions";
import { formatClock, formatDate, formatDuration, formatPercent } from "@/lib/format";
import { optionLabel } from "@/lib/lookup-links";
import { getSessionSummary } from "@/lib/queries";
import type { AnswerOption, SessionQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Session summary" };

function correctOptions(question: SessionQuestion): AnswerOption[] {
  const marked = question.options.filter((option) => option.is_correct === 1);
  if (marked.length > 0) return marked;
  if (!question.answer_correct_options) return [];
  try {
    const ids = (JSON.parse(question.answer_correct_options) as Array<string | number>).map(Number);
    return question.options.filter((option) => ids.includes(option.ord));
  } catch {
    const id = Number(question.answer_correct_options);
    return question.options.filter((option) => option.ord === id);
  }
}

export default async function SessionSummaryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const summary = getSessionSummary(id);
  if (!summary) notFound();

  const { session } = summary;
  const questionById = new Map(summary.questions.map((question) => [question.id, question]));
  const attemptByQuestion = new Map(summary.attempts.map((attempt) => [attempt.question_id, attempt]));
  const incomplete = summary.attempts.length < session.total;
  const incorrectIds = summary.attempts
    .filter((attempt) => attempt.is_correct === 0)
    .map((attempt) => attempt.question_id);
  const skippedIds = summary.attempts
    .filter((attempt) => attempt.is_correct === null)
    .map((attempt) => attempt.question_id);

  const subjectMap = new Map<
    string,
    { title: string; attempts: number; correct: number; seconds: number }
  >();
  for (const attempt of summary.attempts) {
    const question = questionById.get(attempt.question_id);
    const key = attempt.subject_id ?? "unknown";
    const entry = subjectMap.get(key) ?? {
      title: question?.subject_title ?? "Other",
      attempts: 0,
      correct: 0,
      seconds: 0,
    };
    entry.attempts += 1;
    if (attempt.is_correct === 1) entry.correct += 1;
    entry.seconds += Number(attempt.elapsed_seconds ?? 0);
    subjectMap.set(key, entry);
  }
  const subjects = [...subjectMap.values()]
    .map((entry) => ({
      ...entry,
      accuracy: entry.attempts > 0 ? (entry.correct / entry.attempts) * 100 : 0,
    }))
    .sort((a, b) => b.attempts - a.attempts);

  const duration = (session.ended_at ?? Date.now() / 1000) - session.started_at;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Session summary"
        description={`${formatDate(session.started_at)} · ${session.total} questions · ${session.mode === "timed" ? "timed" : "study"} mode`}
        actions={
          <>
            <Link href="/history" className={buttonClass({ variant: "secondary", size: "md" })}>
              <ArrowLeft className="size-4" /> History
            </Link>
            {incomplete ? (
              <Link
                href={`/practice/session/${session.id}`}
                className={buttonClass({ size: "md" })}
              >
                <Play className="size-4" /> Resume
              </Link>
            ) : (
              <Link href="/practice" className={buttonClass({ size: "md" })}>
                <Play className="size-4" /> New session
              </Link>
            )}
          </>
        }
      />

      {incomplete ? (
        <div className="flex items-center gap-2 rounded-xl border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <CircleHelp className="size-3.5" />
          This session is still in progress. Resume it to finish the remaining questions.
        </div>
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[1.2fr_1.8fr]">
        <Card className="flex items-center gap-5 p-5">
          <div
            className="relative grid size-28 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(var(--success) ${summary.accuracy}%, var(--muted) 0)`,
            }}
            role="img"
            aria-label={`${formatPercent(summary.accuracy, 1)} accuracy`}
          >
            <div className="grid size-[88px] place-items-center rounded-full bg-card text-center">
              <div>
                <p className="text-xl font-semibold">{formatPercent(summary.accuracy, 1)}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">accuracy</p>
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">
                {summary.graded === 0
                  ? "No graded answers"
                  : summary.accuracy >= 75
                    ? "Strong session"
                    : summary.accuracy >= 50
                      ? "Making progress"
                      : "Worth another pass"}
              </h2>
              {summary.keyGraded > 0 ? (
                <Badge tone="success">{summary.keyGraded} key graded</Badge>
              ) : null}
              {summary.selfGraded > 0 ? (
                <Badge tone="warning">{summary.selfGraded} self reported</Badge>
              ) : null}
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {summary.correct} correct · {summary.incorrect} incorrect · {summary.skipped} skipped
              {summary.selfGraded > 0
                ? " · Self-reported attempts count toward accuracy but are marked separately."
                : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {incorrectIds.length > 0 ? (
                <form action={retryQuestionsAction}>
                  <input type="hidden" name="questionIds" value={JSON.stringify(incorrectIds)} />
                  <button type="submit" className={buttonClass({ variant: "danger", size: "sm" })}>
                    <RotateCcw className="size-3.5" /> Retry {incorrectIds.length} incorrect
                  </button>
                </form>
              ) : null}
              {skippedIds.length > 0 ? (
                <form action={retryQuestionsAction}>
                  <input type="hidden" name="questionIds" value={JSON.stringify(skippedIds)} />
                  <button type="submit" className={buttonClass({ variant: "secondary", size: "sm" })}>
                    <Flag className="size-3.5" /> Retry {skippedIds.length} skipped
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            label="Session time"
            value={formatDuration(duration)}
            hint="Wall-clock session duration"
            icon={Clock3}
            tone="info"
          />
          <StatCard
            label="Average / question"
            value={formatDuration(summary.averageSeconds)}
            hint={`Median ${formatDuration(summary.medianSeconds)}`}
            icon={Timer}
            tone="primary"
          />
          <StatCard
            label="Fastest correct"
            value={
              summary.fastestSeconds != null ? formatDuration(summary.fastestSeconds) : "—"
            }
            hint={
              summary.slowestSeconds != null
                ? `Slowest ${formatDuration(summary.slowestSeconds)}`
                : "No graded timing"
            }
            icon={Gauge}
            tone="success"
          />
          <StatCard
            label="Completion"
            value={formatPercent((summary.attempts.length / session.total) * 100, 0)}
            hint={`${summary.attempts.length} of ${session.total} questions`}
            icon={Target}
            tone="warning"
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Question review"
            description="Every attempt, in the order it was served."
          />
          <div className="mt-4 space-y-2">
            {summary.questions.length === 0 ? (
              <EmptyState
                icon={CircleHelp}
                title="No questions in this session"
                description="The session did not contain any question ids."
              />
            ) : (
              summary.questions.map((question, index) => {
                const attempt = attemptByQuestion.get(question.id);
                const correct = correctOptions(question);
                const status =
                  !attempt
                    ? "unattempted"
                    : attempt.is_correct === 1
                      ? "correct"
                      : attempt.is_correct === 0
                        ? "incorrect"
                        : "skipped";

                return (
                  <details
                    key={question.id}
                    className="group rounded-xl border border-border bg-background/60 px-3 py-2.5 open:bg-muted/30"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-3">
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-lg text-[10px] font-semibold",
                          status === "correct"
                            ? "bg-success/10 text-success"
                            : status === "incorrect"
                              ? "bg-danger/10 text-danger"
                              : status === "skipped"
                                ? "bg-warning/10 text-warning"
                                : "bg-muted text-muted-foreground",
                        )}
                      >
                        {status === "correct" ? (
                          <CheckCircle2 className="size-3.5" />
                        ) : status === "incorrect" ? (
                          <XCircle className="size-3.5" />
                        ) : status === "skipped" ? (
                          <Flag className="size-3.5" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {question.question_text}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {attempt?.elapsed_seconds != null
                          ? formatClock(attempt.elapsed_seconds)
                          : "—"}
                      </span>
                      <ArrowRight className="size-3 shrink-0 text-muted-foreground transition group-open:rotate-90" />
                    </summary>
                    <div className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone={question.kind === "pyq" ? "warning" : "info"}>
                          {question.kind === "pyq" ? "PYQ" : "Practice"}
                        </Badge>
                        {question.topic_title ? (
                          <Badge tone="default">{question.topic_title}</Badge>
                        ) : null}
                        {attempt?.grading_source ? (
                          <Badge tone={attempt.grading_source === "key" ? "success" : "warning"}>
                            {attempt.grading_source === "key" ? "Key graded" : "Self reported"}
                          </Badge>
                        ) : null}
                      </div>
                      {attempt?.selected_option ? (
                        <p className="text-muted-foreground">
                          Your answer: <span className="font-medium text-foreground">
                            {attempt.selected_option}
                          </span>
                        </p>
                      ) : null}
                      {correct.length > 0 ? (
                        <p className="text-muted-foreground">
                          Correct:{" "}
                          <span className="font-medium text-success">
                            {correct.map((option) => `${optionLabel(option)}. ${option.text}`).join(" · ")}
                          </span>
                        </p>
                      ) : (
                        <p className="text-muted-foreground">No stored answer key for this question.</p>
                      )}
                      {attempt?.elapsed_seconds != null ? (
                        <p className="text-muted-foreground">
                          Time: {formatDuration(attempt.elapsed_seconds)}
                        </p>
                      ) : null}
                    </div>
                  </details>
                );
              })
            )}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Subject breakdown"
            description="Accuracy and time spent by subject."
          />
          <div className="mt-4 space-y-4">
            {subjects.length === 0 ? (
              <EmptyState
                icon={Target}
                title="Nothing recorded"
                description="Once you answer questions, the subject breakdown appears here."
              />
            ) : (
              subjects.map((subject) => (
                <div key={subject.title}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{subject.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatPercent(subject.accuracy)} · {formatDuration(subject.seconds)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        subject.accuracy >= 70
                          ? "bg-success"
                          : subject.accuracy >= 45
                            ? "bg-warning"
                            : "bg-danger",
                      )}
                      style={{ width: `${subject.accuracy}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {subject.attempts} attempts · {subject.correct} correct
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="mt-5 rounded-xl border border-border bg-background p-3">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Sparkles className="size-3.5 text-primary" /> Want better grading?
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Enter correct options while you review. Future attempts will be graded automatically
              and your key-graded accuracy becomes more reliable.
            </p>
            <Link
              href="/practice"
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3 w-full" })}
            >
              Practise again <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
