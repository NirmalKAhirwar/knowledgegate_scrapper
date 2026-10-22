import {
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
  Clock3,
  Flame,
  Layers3,
  Play,
  Target,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

import { ActivityChart } from "@/components/charts/activity-chart";
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  ProgressBar,
  SectionHeading,
  StatCard,
  buttonClass,
} from "@/components/ui";
import { formatDate, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import {
  getDailySeries,
  getOverallStats,
  getQuestionCounts,
  getRecentSessions,
  getSubjectPerformance,
  getWeakTopics,
} from "@/lib/queries";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const stats = getOverallStats();
  const counts = getQuestionCounts();
  const daily = getDailySeries(30);
  const recent = getRecentSessions(5);
  const subjects = getSubjectPerformance(6);
  const weakTopics = getWeakTopics(5, 3);
  const hasAnswers = counts.answers > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Your local question bank, practice history and performance at a glance."
        actions={
          <Link href="/practice" className={buttonClass({ size: "md" })}>
            <Play className="size-4" />
            Start practice
          </Link>
        }
      />

      {!hasAnswers ? (
        <div className="flex items-start gap-3 rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3.5">
          <CircleHelp className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">No stored answer keys yet.</span>{" "}
            Every scraped question is still available. Use the Google/Gemini lookup links, then
            self-mark or enter the correct option to build accuracy metrics.
          </div>
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Questions covered"
          value={formatPercent(stats.coverage, 1)}
          hint={`${formatNumber(stats.covered)} of ${formatNumber(stats.totalQuestions)} questions`}
          icon={Layers3}
          tone="primary"
        />
        <StatCard
          label="Accuracy"
          value={stats.graded > 0 ? formatPercent(stats.accuracy, 1) : "—"}
          hint={
            stats.graded > 0
              ? `${formatNumber(stats.correct)} correct · ${formatNumber(stats.graded)} graded`
              : "Grade your first answer to begin"
          }
          icon={Target}
          tone="success"
        />
        <StatCard
          label="Study time"
          value={formatDuration(stats.seconds)}
          hint={`${formatNumber(stats.attempts)} recorded attempts`}
          icon={Clock3}
          tone="info"
        />
        <StatCard
          label="Study streak"
          value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`}
          hint={`${stats.studyDays} active days so far`}
          icon={Flame}
          tone="warning"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.65fr_1fr]">
        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Last 30 days"
            description="Practice volume and graded accuracy over time."
            action={
              <Link
                href="/analytics"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Full analytics <ArrowRight className="size-3" />
              </Link>
            }
          />
          <div className="mt-4">
            <ActivityChart data={daily} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-primary" /> Minutes practised
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-success" /> Accuracy
            </span>
            <span className="ml-auto">
              {stats.keyGraded > 0
                ? `${formatNumber(stats.keyGraded)} key-graded`
                : `${formatNumber(stats.selfGraded)} self-graded`}
            </span>
          </div>
        </Card>

        <Card className="flex flex-col p-4 sm:p-5">
          <SectionHeading
            title="Weak topics"
            description="Where extra practice will pay off most."
          />
          <div className="mt-4 flex-1 space-y-3">
            {weakTopics.length === 0 ? (
              <EmptyState
                icon={TrendingUp}
                title="No weak spots yet"
                description="Complete a few graded questions and topics that need attention will appear here."
              />
            ) : (
              weakTopics.map((topic) => (
                <div key={topic.id}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{topic.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatPercent(topic.accuracy, 0)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <ProgressBar
                      value={topic.accuracy}
                      tone={topic.accuracy < 50 ? "danger" : "warning"}
                      className="h-1.5"
                    />
                    <span className="w-14 shrink-0 text-right text-[10px] text-muted-foreground">
                      {topic.attempts} tries
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
          {weakTopics.length > 0 ? (
            <Link
              href="/analytics"
              className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Inspect all topics <ArrowRight className="size-3" />
            </Link>
          ) : null}
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Recent sessions"
            description="Resume or review what you have already done."
            action={
              <Link
                href="/history"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                History <ArrowRight className="size-3" />
              </Link>
            }
          />
          <div className="mt-4 space-y-2">
            {recent.length === 0 ? (
              <EmptyState
                icon={BookOpenCheck}
                title="No sessions yet"
                description="Pick a subject or topic and start your first timed practice session."
                action={
                  <Link href="/practice" className={buttonClass({ size: "sm" })}>
                    <Play className="size-3.5" /> Start now
                  </Link>
                }
              />
            ) : (
              recent.map((session) => {
                const graded = session.correct + session.incorrect;
                const accuracy = graded > 0 ? (session.correct / graded) * 100 : 0;
                const label =
                  session.kind === "pyq"
                    ? "PYQ session"
                    : session.kind === "practice"
                      ? "Practice session"
                      : "Mixed session";
                const duration = (session.ended_at ?? Date.now() / 1000) - session.started_at;
                return (
                  <Link
                    key={session.id}
                    href={`/practice/session/${session.id}/summary`}
                    className="flex items-center gap-3 rounded-xl border border-transparent px-2 py-2.5 transition hover:border-border hover:bg-muted/60"
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-xl ${
                        graded === 0
                          ? "bg-muted text-muted-foreground"
                          : accuracy >= 70
                            ? "bg-success/10 text-success"
                            : "bg-danger/10 text-danger"
                      }`}
                    >
                      {graded === 0 ? (
                        <CircleHelp className="size-4" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-medium">{label}</p>
                        <Badge tone="default">{session.total} Qs</Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDate(session.started_at)} · {formatDuration(duration)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold">
                      {graded > 0 ? formatPercent(accuracy) : "—"}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Subject performance"
            description="Your most-practised subjects."
            action={
              <Link
                href="/analytics"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Compare <BarChart3 className="size-3" />
              </Link>
            }
          />
          <div className="mt-4 space-y-3.5">
            {subjects.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="Performance appears here"
                description="Subject accuracy and speed are calculated as soon as you record graded attempts."
              />
            ) : (
              subjects.map((subject) => (
                <div key={subject.id}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{subject.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatPercent(subject.accuracy, 0)} · {formatDuration(subject.seconds)}
                    </span>
                  </div>
                  <ProgressBar
                    value={subject.accuracy}
                    tone={subject.accuracy >= 70 ? "success" : subject.accuracy >= 45 ? "warning" : "danger"}
                    className="mt-1.5 h-1.5"
                  />
                </div>
              ))
            )}
          </div>
        </Card>
      </section>

      <Card className="flex flex-col items-start justify-between gap-4 overflow-hidden bg-gradient-to-br from-primary/15 via-card to-card p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <BookOpenCheck className="size-5" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">
              {formatNumber(counts.questions)} questions are ready offline
            </h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              {formatNumber(counts.pyq)} PYQs and {formatNumber(counts.practice)} practice questions
              across every subject, chapter and topic. No network required.
            </p>
          </div>
        </div>
        <Link href="/practice" className={buttonClass({ variant: "secondary", size: "md" })}>
          Build a session <ArrowRight className="size-4" />
        </Link>
      </Card>
    </div>
  );
}
