import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  History,
  Play,
  Target,
} from "lucide-react";
import Link from "next/link";

import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  SectionHeading,
  StatCard,
  buttonClass,
} from "@/components/ui";
import { formatDate, formatDuration, formatPercent } from "@/lib/format";
import { getSessionHistory, parseScope } from "@/lib/queries";

export const metadata = { title: "History" };

export default function HistoryPage() {
  const sessions = getSessionHistory(80);
  const completed = sessions.filter((session) => session.ended_at != null).length;
  const totalSeconds = sessions.reduce((sum, session) => {
    const end = session.ended_at ?? Date.now() / 1000;
    return sum + Math.max(0, end - session.started_at);
  }, 0);
  const graded = sessions.reduce((sum, session) => sum + session.correct + session.incorrect, 0);
  const correct = sessions.reduce((sum, session) => sum + session.correct, 0);
  const accuracy = graded > 0 ? (correct / graded) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Session history"
        description="Every practice session, with time, completion and accuracy."
        actions={
          <Link href="/practice" className={buttonClass({ size: "md" })}>
            <Play className="size-4" /> New session
          </Link>
        }
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Sessions"
          value={sessions.length}
          hint={`${completed} completed`}
          icon={History}
          tone="primary"
        />
        <StatCard
          label="Time practised"
          value={formatDuration(totalSeconds)}
          hint="Across this history view"
          icon={Clock3}
          tone="info"
        />
        <StatCard
          label="Accuracy"
          value={graded > 0 ? formatPercent(accuracy, 1) : "—"}
          hint={`${graded} graded attempts`}
          icon={Target}
          tone="success"
        />
      </section>

      <Card className="p-4 sm:p-5">
        <SectionHeading
          title="All sessions"
          description="Open any session to review questions, timings and answers."
          action={
            <Link
              href="/analytics"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Analytics <BarChart3 className="size-3" />
            </Link>
          }
        />

        <div className="mt-4">
          {sessions.length === 0 ? (
            <EmptyState
              icon={History}
              title="No sessions recorded"
              description="Your first practice session will appear here with its accuracy and timing."
              action={
                <Link href="/practice" className={buttonClass({ size: "sm" })}>
                  <Play className="size-3.5" /> Start practising
                </Link>
              }
            />
          ) : (
            <>
              <div className="hidden grid-cols-[minmax(0,1.5fr)_100px_90px_110px_100px_40px] gap-3 border-b border-border px-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <span>Session</span>
                <span>Date</span>
                <span>Questions</span>
                <span>Accuracy</span>
                <span>Time</span>
                <span />
              </div>
              <div className="divide-y divide-border">
                {sessions.map((session) => {
                  const scope = parseScope(session.scope_json);
                  const label =
                    scope?.label ??
                    (session.kind === "pyq"
                      ? "PYQ session"
                      : session.kind === "practice"
                        ? "Practice session"
                        : "Mixed session");
                  const gradedCount = session.correct + session.incorrect;
                  const sessionAccuracy =
                    gradedCount > 0 ? (session.correct / gradedCount) * 100 : 0;
                  const duration =
                    (session.ended_at ?? Date.now() / 1000) - session.started_at;
                  return (
                    <Link
                      key={session.id}
                      href={`/practice/session/${session.id}/summary`}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-2 py-3 transition hover:bg-muted/40 md:grid-cols-[minmax(0,1.5fr)_100px_90px_110px_100px_40px] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-medium">{label}</span>
                          {session.ended_at ? (
                            <Badge tone="success">
                              <CheckCircle2 className="size-3" /> Done
                            </Badge>
                          ) : (
                            <Badge tone="warning">In progress</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {session.kind === "pyq"
                            ? "Previous year"
                            : session.kind === "practice"
                              ? "Practice"
                              : "Mixed"}{" "}
                          · {session.mode === "timed" ? "Timed" : "Study"} ·{" "}
                          {session.skipped} skipped
                        </p>
                      </div>
                      <span className="hidden text-[11px] text-muted-foreground md:block">
                        {formatDate(session.started_at)}
                      </span>
                      <span className="text-right text-xs md:text-left">
                        <span className="font-medium">{session.total}</span>
                        <span className="text-muted-foreground"> Qs</span>
                      </span>
                      <span className="hidden md:block">
                        {gradedCount > 0 ? (
                          <Badge tone={sessionAccuracy >= 70 ? "success" : "warning"}>
                            {formatPercent(sessionAccuracy)}
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">Not graded</span>
                        )}
                      </span>
                      <span className="hidden text-[11px] text-muted-foreground md:block">
                        {formatDuration(duration)}
                      </span>
                      <ArrowRight className="hidden size-4 text-muted-foreground md:block" />
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
