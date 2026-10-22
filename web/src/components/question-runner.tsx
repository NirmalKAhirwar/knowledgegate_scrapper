"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Flag,
  Loader2,
  Pause,
  Play,
  Search,
  Sparkles,
  Timer,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { MathText } from "@/components/math-text";
import { SetKeyDialog } from "@/components/set-key-dialog";
import { Badge, Card, ProgressBar, buttonClass } from "@/components/ui";
import {
  finishSessionAction,
  selfGradeAction,
  setAnswerKeyAction,
  skipQuestionAction,
  submitAnswerAction,
} from "@/lib/actions";
import { formatClock, formatDate, formatDuration, formatPercent } from "@/lib/format";
import { buildLookupPrompt, googleSearchUrl, geminiUrl, optionLabel } from "@/lib/lookup-links";
import type { AttemptRow, SessionQuestion, SessionRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

type Phase = "answering" | "submitting" | "awaiting" | "graded";

interface GradeResult {
  isCorrect: boolean;
  correctOrds: number[];
  solution: string | null;
  feedback: string | null;
  source: "key" | "self";
}

function useQuestionTimer(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  const [paused, setPaused] = useState(false);
  const startRef = useRef(Date.now());
  const baseRef = useRef(0);

  useEffect(() => {
    if (!active || paused) return;
    const timer = window.setInterval(() => {
      const elapsed = baseRef.current + (Date.now() - startRef.current) / 1000;
      setSeconds(Math.max(0, Math.floor(elapsed)));
    }, 250);
    return () => window.clearInterval(timer);
  }, [active, paused]);

  function reset() {
    baseRef.current = 0;
    startRef.current = Date.now();
    setSeconds(0);
    setPaused(false);
  }

  function togglePause() {
    if (paused) {
      startRef.current = Date.now();
      setPaused(false);
    } else {
      baseRef.current += (Date.now() - startRef.current) / 1000;
      setPaused(true);
    }
  }

  function getElapsed(): number {
    const elapsed = baseRef.current + (paused ? 0 : (Date.now() - startRef.current) / 1000);
    return Math.max(0, Math.round(elapsed));
  }

  return { seconds, paused, reset, togglePause, getElapsed };
}

export function QuestionRunner({
  session,
  questions,
  initialAttempts,
}: {
  session: SessionRecord;
  questions: SessionQuestion[];
  initialAttempts: AttemptRow[];
}) {
  const router = useRouter();
  const [completed, setCompleted] = useState<Set<string>>(
    () => new Set(initialAttempts.map((attempt) => attempt.question_id)),
  );
  const [index, setIndex] = useState(() => {
    const first = questions.findIndex(
      (question) => !initialAttempts.some((attempt) => attempt.question_id === question.id),
    );
    return first === -1 ? 0 : first;
  });
  const [selectedOrd, setSelectedOrd] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("answering");
  const [result, setResult] = useState<GradeResult | null>(null);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [keyPending, setKeyPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const question = questions[index];
  const timerActive = phase === "answering" || phase === "awaiting";
  const timer = useQuestionTimer(timerActive);

  const target = Math.round(question?.median_time_taken ?? 60);
  const overTarget = session.mode === "timed" && timer.seconds > target;
  const prompt = question ? buildLookupPrompt(question) : "";
  const progress = questions.length > 0 ? (completed.size / questions.length) * 100 : 0;

  useEffect(() => {
    setSelectedOrd(null);
    setPhase("answering");
    setResult(null);
    setShowKeyDialog(false);
    setError(null);
    setCopied(false);
    timer.reset();
    // Reset only when the displayed question changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id]);

  function markCompleted(id: string): Set<string> {
    const updated = new Set(completed);
    updated.add(id);
    setCompleted(updated);
    return updated;
  }

  async function advance(afterId: string) {
    const updated = markCompleted(afterId);
    const next = questions.findIndex((candidate) => !updated.has(candidate.id));
    if (next === -1) {
      setLeaving(true);
      try {
        await finishSessionAction(session.id);
      } finally {
        router.push(`/practice/session/${session.id}/summary`);
      }
      return;
    }
    setIndex(next);
  }

  async function submit() {
    if (!question || selectedOrd == null || phase !== "answering") return;
    setError(null);
    setPhase("submitting");
    const elapsedSeconds = timer.getElapsed();
    try {
      const response = await submitAnswerAction({
        sessionId: session.id,
        questionId: question.id,
        selectedOrd,
        elapsedSeconds,
      });
      if (response.graded) {
        setResult({
          isCorrect: Boolean(response.isCorrect),
          correctOrds: response.correctOrds ?? [],
          solution: response.solution ?? null,
          feedback: response.feedback ?? null,
          source: "key",
        });
        setPhase("graded");
        markCompleted(question.id);
      } else {
        setPhase("awaiting");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not submit the answer.");
      setPhase("answering");
    }
  }

  async function selfGrade(isCorrect: boolean) {
    if (!question || selectedOrd == null) return;
    setError(null);
    setPhase("submitting");
    const elapsedSeconds = timer.getElapsed();
    try {
      await selfGradeAction({
        sessionId: session.id,
        questionId: question.id,
        selectedOrd,
        elapsedSeconds,
        isCorrect,
      });
      setResult({
        isCorrect,
        correctOrds: [],
        solution: null,
        feedback: null,
        source: "self",
      });
      setPhase("graded");
      markCompleted(question.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the self-grade.");
      setPhase("awaiting");
    }
  }

  async function saveKey(correctOrd: number) {
    if (!question) return;
    setError(null);
    setKeyPending(true);
    const elapsedSeconds = timer.getElapsed();
    try {
      const response = await setAnswerKeyAction({
        sessionId: session.id,
        questionId: question.id,
        correctOrd,
        selectedOrd,
        elapsedSeconds,
      });
      setResult({
        isCorrect: response.isCorrect ?? selectedOrd === correctOrd,
        correctOrds: response.correctOrds,
        solution: response.solution,
        feedback: response.feedback,
        source: "key",
      });
      setShowKeyDialog(false);
      setPhase("graded");
      if (selectedOrd != null) markCompleted(question.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the answer key.");
    } finally {
      setKeyPending(false);
    }
  }

  async function skip() {
    if (!question || phase === "submitting" || phase === "graded") return;
    setError(null);
    setPhase("submitting");
    const elapsedSeconds = timer.getElapsed();
    try {
      await skipQuestionAction({
        sessionId: session.id,
        questionId: question.id,
        elapsedSeconds,
      });
      await advance(question.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not skip the question.");
      setPhase("answering");
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Clipboard access was blocked. Select the question text and copy it manually.");
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (showKeyDialog || event.metaKey || event.ctrlKey || event.altKey) return;
      const targetElement = event.target as HTMLElement | null;
      if (
        targetElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(targetElement.tagName)
      ) {
        return;
      }
      if (!question) return;

      if (phase === "graded") {
        if (event.key === "Enter" || event.key.toLowerCase() === "n") {
          event.preventDefault();
          void advance(question.id);
        }
        return;
      }
      if (phase !== "answering") return;

      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void skip();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
        return;
      }

      const letter = event.key.toUpperCase();
      const byLetter = question.options.find(
        (option) => optionLabel(option).toUpperCase() === letter,
      );
      const numeric = /^[1-9]$/.test(event.key) ? question.options[Number(event.key) - 1] : undefined;
      const option = byLetter ?? numeric;
      if (option) {
        event.preventDefault();
        setSelectedOrd(option.ord);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, question, selectedOrd, showKeyDialog, completed]);

  if (!question) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm font-medium">This session has no questions.</p>
        <Link href="/practice" className={buttonClass({ className: "mt-4" })}>
          Build another session
        </Link>
      </Card>
    );
  }

  const isLast = questions.every((candidate) => completed.has(candidate.id));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/practice"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Exit session
        </Link>
        <div className="flex items-center gap-2">
          {session.mode === "timed" ? (
            <Badge tone={overTarget ? "danger" : "info"}>
              <Timer className="size-3" /> Target {formatClock(target)}
            </Badge>
          ) : (
            <Badge tone="default">
              <Timer className="size-3" /> Study mode
            </Badge>
          )}
          <Badge tone="primary">
            {completed.size} / {questions.length}
          </Badge>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Question {index + 1} of {questions.length}
          </span>
          <span>{formatPercent(progress, 0)} complete</span>
        </div>
        <ProgressBar value={progress} className="h-1.5" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/35 px-4 py-3 sm:px-5">
          <Badge tone={question.kind === "pyq" ? "warning" : "info"}>
            {question.kind === "pyq" ? "PYQ" : "Practice"}
          </Badge>
          {question.exam_name ? <Badge tone="default">{question.exam_name}</Badge> : null}
          {question.year ? <Badge tone="default">{question.year}</Badge> : null}
          {question.topic_title ? (
            <Badge tone="primary" className="max-w-[18rem] truncate">
              {question.topic_title}
            </Badge>
          ) : null}
          {question.avg_success_rate != null ? (
            <span className="ml-auto text-[10px] text-muted-foreground">
              Platform avg {formatPercent(question.avg_success_rate, 0)}
              {question.median_time_taken != null
                ? ` · median ${formatDuration(question.median_time_taken)}`
                : ""}
            </span>
          ) : null}
        </div>

        <div className="p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-xs font-bold text-primary-foreground">
              {index + 1}
            </span>
            <MathText
              text={question.question_text}
              className="question-text min-w-0 text-[15px] font-medium sm:text-base"
            />
          </div>

          {question.instructions ? (
            <div className="mt-4 rounded-xl bg-muted/50 px-3 py-2">
              <MathText
                text={question.instructions}
                className="question-text text-xs text-muted-foreground"
              />
            </div>
          ) : null}

          <div className="mt-6 space-y-2.5">
            {question.options.map((option) => {
              const selected = selectedOrd === option.ord;
              const isCorrectOption = Boolean(result?.correctOrds.includes(option.ord));
              const selfWrong = result?.source === "self" && !result.isCorrect && selected;
              const selfRight = result?.source === "self" && result.isCorrect && selected;
              const showCorrect = isCorrectOption || selfRight;
              const showWrong = Boolean(
                result && !isCorrectOption && selected && (result.source === "key" || selfWrong),
              );

              return (
                <button
                  key={option.ord}
                  type="button"
                  disabled={phase === "submitting" || phase === "graded"}
                  onClick={() => setSelectedOrd(option.ord)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition sm:px-4",
                    "disabled:cursor-default",
                    showCorrect
                      ? "border-success/50 bg-success/10"
                      : showWrong
                        ? "border-danger/50 bg-danger/10"
                        : selected
                          ? "border-primary bg-primary/8 shadow-sm"
                          : "border-border bg-background hover:border-primary/40 hover:bg-muted/50",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-lg border text-[11px] font-semibold",
                      showCorrect
                        ? "border-success bg-success text-white"
                        : showWrong
                          ? "border-danger bg-danger text-white"
                          : selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {showCorrect ? (
                      <Check className="size-3.5" />
                    ) : showWrong ? (
                      <XCircle className="size-3.5" />
                    ) : (
                      optionLabel(option)
                    )}
                  </span>
                  <MathText
                    text={option.text}
                    className="question-text min-w-0 flex-1 pt-0.5 text-sm"
                  />
                </button>
              );
            })}
          </div>

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 font-mono text-xs tabular-nums",
                overTarget
                  ? "border-danger/40 bg-danger/10 text-danger"
                  : "border-border bg-background text-foreground",
              )}
            >
              <Timer className="size-3.5" />
              {formatClock(timer.seconds)}
            </span>
            <button
              type="button"
              onClick={timer.togglePause}
              disabled={!timerActive}
              className={buttonClass({ variant: "ghost", size: "sm" })}
              title={timer.paused ? "Resume timer" : "Pause timer"}
            >
              {timer.paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              <span className="hidden sm:inline">{timer.paused ? "Resume" : "Pause"}</span>
            </button>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {phase === "answering" || phase === "awaiting" ? (
              <button
                type="button"
                onClick={skip}
                className={buttonClass({ variant: "ghost", size: "sm" })}
              >
                <Flag className="size-3.5" /> Skip
              </button>
            ) : null}

            {phase === "awaiting" ? (
              <button
                type="button"
                onClick={() => setShowKeyDialog(true)}
                className={buttonClass({ variant: "secondary", size: "md" })}
              >
                Enter key
              </button>
            ) : phase === "graded" ? (
              <button
                type="button"
                onClick={() => {
                  if (isLast) {
                    setLeaving(true);
                    void finishSessionAction(session.id).finally(() =>
                      router.push(`/practice/session/${session.id}/summary`),
                    );
                  } else {
                    void advance(question.id);
                  }
                }}
                disabled={leaving}
                className={buttonClass({ size: "md" })}
              >
                {leaving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : isLast ? (
                  <>
                    Finish session <CheckCircle2 className="size-4" />
                  </>
                ) : (
                  <>
                    Next <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={selectedOrd == null || phase === "submitting"}
                className={buttonClass({ size: "md" })}
              >
                {phase === "submitting" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Submit answer <ArrowRight className="size-4" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </Card>

      {phase === "awaiting" ? (
        <Card className="animate-fade-up overflow-hidden">
          <div className="border-b border-warning/20 bg-warning/5 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4 text-warning" />
              No stored answer key
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Look it up outside the app, then self-mark or save the real option. Lookup time is
              included in this question&apos;s timing.
            </p>
          </div>
          <div className="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap gap-2">
              <a
                href={googleSearchUrl(prompt)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                <Search className="size-3.5" /> Search on Google
                <ExternalLink className="size-3" />
              </a>
              <a
                href={geminiUrl(prompt)}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                <Sparkles className="size-3.5" /> Ask Gemini
                <ExternalLink className="size-3" />
              </a>
              <button
                type="button"
                onClick={copyPrompt}
                className={buttonClass({ variant: "ghost", size: "sm" })}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy prompt"}
              </button>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => selfGrade(true)}
                disabled={phase !== "awaiting"}
                className={buttonClass({ variant: "success", size: "lg" })}
              >
                <CheckCircle2 className="size-4" /> I was right
              </button>
              <button
                type="button"
                onClick={() => selfGrade(false)}
                disabled={phase !== "awaiting"}
                className={buttonClass({ variant: "danger", size: "lg" })}
              >
                <XCircle className="size-4" /> I was wrong
              </button>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or save the key once
              <span className="h-px flex-1 bg-border" />
            </div>
            <button
              type="button"
              onClick={() => setShowKeyDialog(true)}
              className={buttonClass({ variant: "secondary", className: "w-full" })}
            >
              Enter the correct option
            </button>
          </div>
        </Card>
      ) : null}

      {phase === "graded" && result ? (
        <Card
          className={cn(
            "animate-fade-up overflow-hidden border-l-4",
            result.isCorrect ? "border-l-success" : "border-l-danger",
          )}
        >
          <div className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "grid size-10 shrink-0 place-items-center rounded-2xl",
                  result.isCorrect ? "bg-success/10 text-success" : "bg-danger/10 text-danger",
                )}
              >
                {result.isCorrect ? (
                  <CheckCircle2 className="size-5" />
                ) : (
                  <XCircle className="size-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold">
                    {result.source === "self"
                      ? result.isCorrect
                        ? "Self-marked correct"
                        : "Self-marked incorrect"
                      : result.isCorrect
                        ? "Correct"
                        : "Incorrect"}
                  </h2>
                  <Badge tone={result.source === "key" ? "success" : "warning"}>
                    {result.source === "key" ? "Key graded" : "Self reported"}
                  </Badge>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatClock(timer.seconds)}
                  </span>
                </div>

                {result.correctOrds.length > 0 ? (
                  <div className="mt-3 rounded-xl bg-success/8 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-success">
                      Correct answer
                    </p>
                    <MathText
                      text={question.options
                        .filter((option) => result.correctOrds.includes(option.ord))
                        .map((option) => `${optionLabel(option)}. ${option.text}`)
                        .join("\n")}
                      className="question-text mt-1 text-sm font-medium"
                    />
                  </div>
                ) : null}

                {result.feedback ? (
                  <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Option feedback
                    </p>
                    <MathText text={result.feedback} className="question-text mt-1 text-xs leading-relaxed" />
                  </div>
                ) : null}

                {result.solution ? (
                  <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Solution
                    </p>
                    <MathText text={result.solution} className="question-text mt-1 text-xs leading-relaxed" />
                  </div>
                ) : null}

                {result.source === "self" ? (
                  <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                    This attempt is stored as self-reported. Open the key editor to grade future
                    attempts automatically.
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <a
                    href={googleSearchUrl(prompt)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    <Search className="size-3.5" /> Google
                  </a>
                  <a
                    href={geminiUrl(prompt)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClass({ variant: "secondary", size: "sm" })}
                  >
                    <Sparkles className="size-3.5" /> Gemini
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowKeyDialog(true)}
                    className={buttonClass({ variant: "ghost", size: "sm" })}
                  >
                    {result.source === "self" ? "Set answer key" : "Edit answer key"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (isLast) {
                        setLeaving(true);
                        void finishSessionAction(session.id).finally(() =>
                          router.push(`/practice/session/${session.id}/summary`),
                        );
                      } else {
                        void advance(question.id);
                      }
                    }}
                    className={buttonClass({ size: "sm", className: "ml-auto" })}
                  >
                    {isLast ? "Finish" : "Next"} <ArrowRight className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-[10px] text-muted-foreground">
        <span>
          Started {formatDate(session.started_at)} · {session.total} questions
        </span>
        <span className="inline-flex items-center gap-2">
          <kbd className="rounded border border-border bg-card px-1.5 py-0.5">A–E</kbd> select
          <kbd className="rounded border border-border bg-card px-1.5 py-0.5">Enter</kbd> submit
          <kbd className="rounded border border-border bg-card px-1.5 py-0.5">S</kbd> skip
        </span>
      </div>

      <SetKeyDialog
        open={showKeyDialog}
        options={question.options}
        pending={keyPending}
        onClose={() => setShowKeyDialog(false)}
        onConfirm={saveKey}
      />
    </div>
  );
}
