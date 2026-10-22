import {
  BarChart3,
  Clock3,
  Filter,
  Gauge,
  Layers3,
  Target,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";

import { ActivityChart } from "@/components/charts/activity-chart";
import { SpeedAccuracyChart } from "@/components/charts/speed-accuracy-chart";
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
import { formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { getAnalytics, getCourses } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Analytics" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const selectClass =
  "h-9 rounded-xl border border-border bg-background px-2.5 text-xs text-foreground transition hover:bg-muted/50";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const courseId = first(params.course) ?? "";
  const kind = first(params.kind) ?? "all";
  const grading = first(params.grading) ?? "all";
  const days = Math.max(1, Math.min(3650, Number(first(params.days) ?? 90) || 90));

  const courses = getCourses();
  const analytics = getAnalytics({ courseId, kind, grading, days });
  const keyShare =
    analytics.keyGraded + analytics.selfGraded > 0
      ? (analytics.keyGraded / (analytics.keyGraded + analytics.selfGraded)) * 100
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance analytics"
        description="Accuracy, pace and coverage across your local practice history."
        actions={
          <Link href="/practice" className={buttonClass({ size: "md" })}>
            <TrendingUp className="size-4" /> Practise
          </Link>
        }
      />

      <Card className="p-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Course
            </span>
            <select name="course" defaultValue={courseId} className={selectClass}>
              <option value="">All courses</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Question type
            </span>
            <select name="kind" defaultValue={kind} className={selectClass}>
              <option value="all">PYQ + practice</option>
              <option value="pyq">PYQ only</option>
              <option value="practice">Practice only</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Grading
            </span>
            <select name="grading" defaultValue={grading} className={selectClass}>
              <option value="all">All attempts</option>
              <option value="key">Key graded</option>
              <option value="self">Self reported</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Period
            </span>
            <select name="days" defaultValue={String(days)} className={selectClass}>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
              <option value="3650">All time</option>
            </select>
          </label>
          <button type="submit" className={buttonClass({ size: "sm" })}>
            <Filter className="size-3.5" /> Apply
          </button>
          <Link
            href="/analytics"
            className={buttonClass({ variant: "ghost", size: "sm" })}
          >
            Reset
          </Link>
          <span className="ml-auto hidden text-[10px] text-muted-foreground sm:block">
            {formatNumber(analytics.attemptedQuestions)} distinct questions attempted in this view
          </span>
        </form>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Accuracy"
          value={analytics.graded > 0 ? formatPercent(analytics.accuracy, 1) : "—"}
          hint={
            analytics.graded > 0
              ? `${formatNumber(analytics.correct)} correct / ${formatNumber(analytics.graded)} graded`
              : "No graded attempts in this filter"
          }
          icon={Target}
          tone="success"
        />
        <StatCard
          label="Attempts"
          value={formatNumber(analytics.graded + analytics.skipped)}
          hint={`${formatNumber(analytics.skipped)} skipped · ${formatNumber(analytics.sessions)} sessions`}
          icon={BarChart3}
          tone="primary"
        />
        <StatCard
          label="Time on task"
          value={formatDuration(analytics.seconds)}
          hint={`${formatDuration(analytics.avgSeconds)} average per graded question`}
          icon={Clock3}
          tone="info"
        />
        <StatCard
          label="Coverage"
          value={formatPercent(analytics.coverage, 1)}
          hint={`${formatNumber(analytics.attemptedQuestions)} of ${formatNumber(analytics.totalQuestions)} questions`}
          icon={Layers3}
          tone="warning"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Activity and accuracy"
            description="Bars show practice minutes; the line shows graded accuracy."
          />
          <div className="mt-4">
            <ActivityChart data={analytics.daily} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-sm bg-primary" /> Minutes
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full bg-success" /> Accuracy
            </span>
            <span className="ml-auto">
              {formatNumber(analytics.keyGraded)} key · {formatNumber(analytics.selfGraded)} self
            </span>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Grading reliability"
            description="Key-graded attempts are stronger evidence than self-reports."
          />
          <div className="mt-5 flex items-end gap-3">
            <span className="text-3xl font-semibold tracking-tight">{formatPercent(keyShare, 0)}</span>
            <span className="pb-1 text-xs text-muted-foreground">key-graded</span>
          </div>
          <ProgressBar value={keyShare} tone={keyShare >= 70 ? "success" : "warning"} className="mt-3" />
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Key graded</p>
              <p className="mt-1 text-lg font-semibold">{formatNumber(analytics.keyGraded)}</p>
            </div>
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Self reported</p>
              <p className="mt-1 text-lg font-semibold">{formatNumber(analytics.selfGraded)}</p>
            </div>
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Use the key editor during review to raise the share of automatically graded attempts and
            make long-term trends more trustworthy.
          </p>
          {analytics.graded === 0 ? (
            <Link href="/practice" className={buttonClass({ size: "sm", className: "mt-4 w-full" })}>
              Start a graded session
            </Link>
          ) : null}
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Subject accuracy"
            description="Where your graded answers are strongest."
          />
          <div className="mt-4 space-y-3.5">
            {analytics.subjects.length === 0 ? (
              <EmptyState
                icon={BarChart3}
                title="No subject data"
                description="Record graded attempts to compare subjects."
              />
            ) : (
              analytics.subjects.map((subject) => (
                <div key={subject.id}>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-medium">{subject.title}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {formatPercent(subject.accuracy)} · {subject.attempts} attempts
                    </span>
                  </div>
                  <ProgressBar
                    value={subject.accuracy}
                    tone={subject.accuracy >= 70 ? "success" : subject.accuracy >= 45 ? "warning" : "danger"}
                    className="mt-1.5 h-1.5"
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {formatDuration(subject.seconds)} total ·{" "}
                    {formatDuration(subject.attempts > 0 ? subject.seconds / subject.attempts : 0)}{" "}
                    average
                  </p>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <SectionHeading
            title="Speed vs accuracy"
            description="Each bubble is a topic. Top-left is fast and accurate; bottom-right needs work."
          />
          <div className="mt-2">
            {analytics.speedAccuracy.length === 0 ? (
              <EmptyState
                icon={Gauge}
                title="Not enough timing data"
                description="Answer at least two questions in a topic to plot it here."
              />
            ) : (
              <SpeedAccuracyChart data={analytics.speedAccuracy} />
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            <span>Bubble size = attempts</span>
            <span>Green line = 70% accuracy</span>
            <span>Grey line = 60s average</span>
          </div>
        </Card>
      </section>

      <Card className="p-4 sm:p-5">
        <SectionHeading
          title="Weak topics"
          description="Ranked by attempts × error rate, so high-volume weak areas rise first."
          action={
            <Badge tone="warning">
              <Target className="size-3" /> {analytics.weakTopics.length} flagged
            </Badge>
          }
        />
        {analytics.weakTopics.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={TrendingUp}
              title="No weak topics yet"
              description="A topic is flagged after at least three graded attempts in this filtered view."
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-medium">Topic</th>
                  <th className="pb-2 font-medium">Subject</th>
                  <th className="pb-2 text-right font-medium">Attempts</th>
                  <th className="pb-2 text-right font-medium">Accuracy</th>
                  <th className="pb-2 text-right font-medium">Avg time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {analytics.weakTopics.map((topic) => (
                  <tr key={topic.id} className="hover:bg-muted/30">
                    <td className="max-w-[260px] truncate py-2.5 pr-3 font-medium">{topic.title}</td>
                    <td className="max-w-[180px] truncate py-2.5 pr-3 text-muted-foreground">
                      {topic.subject}
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{topic.attempts}</td>
                    <td className="py-2.5 text-right">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          topic.accuracy >= 70
                            ? "bg-success/10 text-success"
                            : topic.accuracy >= 45
                              ? "bg-warning/10 text-warning"
                              : "bg-danger/10 text-danger",
                        )}
                      >
                        {formatPercent(topic.accuracy)}
                      </span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {formatDuration(topic.avg_seconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
