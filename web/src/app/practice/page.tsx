import { CircleHelp, Keyboard, Search, Timer } from "lucide-react";

import { PracticeSetupForm } from "@/components/practice-setup-form";
import { Card, PageHeader } from "@/components/ui";
import { formatNumber } from "@/lib/format";
import { getExamOptions, getQuestionCounts, getTaxonomy } from "@/lib/queries";

export const metadata = { title: "Practice" };

export default function PracticePage() {
  const taxonomy = getTaxonomy();
  const exams = getExamOptions();
  const counts = getQuestionCounts();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Build a practice session"
        description={`Choose a scope from ${formatNumber(counts.questions)} offline questions. Every attempt records time, accuracy and grading source.`}
      />

      {counts.answers === 0 ? (
        <Card className="flex items-start gap-3 border-warning/30 bg-warning/5 p-4">
          <CircleHelp className="mt-0.5 size-4 shrink-0 text-warning" />
          <div className="text-xs leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">Your question bank has no stored answer keys yet.</p>
            <p className="mt-1">
              After answering, use the Google or Gemini lookup links, then self-mark the question or
              enter the correct option. Entered keys are saved for every future attempt.
            </p>
          </div>
        </Card>
      ) : null}

      <PracticeSetupForm
        taxonomy={taxonomy}
        exams={exams}
        totalQuestions={counts.questions}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          {
            icon: Timer,
            title: "Automatic time tracking",
            text: "Per-question and total session time are stored with every attempt, including skipped questions.",
          },
          {
            icon: Search,
            title: "Look up what is missing",
            text: "Open Google or Gemini with the full question and options, or copy the prompt in one click.",
          },
          {
            icon: Keyboard,
            title: "Keyboard-first",
            text: "Use A–E or 1–5 to select, Enter to submit, S to skip, and N for the next question.",
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className="p-4">
              <span className="grid size-8 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <h3 className="mt-3 text-xs font-semibold">{item.title}</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.text}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
