import { notFound, redirect } from "next/navigation";

import { QuestionRunner } from "@/components/question-runner";
import {
  getAttemptsForSession,
  getSession,
  getSessionQuestions,
} from "@/lib/queries";

export const metadata = { title: "Practice session" };

export default async function PracticeSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();

  const attempts = getAttemptsForSession(id);
  if (session.ended_at || attempts.length >= session.total) {
    redirect(`/practice/session/${id}/summary`);
  }

  const questions = getSessionQuestions(session);
  return <QuestionRunner session={session} questions={questions} initialAttempts={attempts} />;
}
