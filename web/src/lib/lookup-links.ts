import type { SessionQuestion } from "@/lib/types";

const LETTERS = "ABCDEFGHIJ";

export function optionLabel(option: { ord: number; label?: string | null }): string {
  return option.label || LETTERS[option.ord] || String(option.ord + 1);
}

export function buildLookupPrompt(question: SessionQuestion): string {
  const options = question.options
    .map((option) => `${optionLabel(option)}. ${option.text}`)
    .join("\n");

  const context = [question.exam_name, question.year, question.topic_title]
    .filter(Boolean)
    .join(" · ");

  return [
    "Solve this multiple-choice question. State the correct option and explain briefly.",
    context ? `Context: ${context}` : "",
    "",
    question.question_text,
    "",
    options,
  ]
    .filter((line) => line !== "")
    .join("\n")
    .slice(0, 1800);
}

export function googleSearchUrl(prompt: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(prompt.slice(0, 800))}`;
}

export function geminiUrl(prompt: string): string {
  return `https://gemini.google.com/app?q=${encodeURIComponent(prompt.slice(0, 1500))}`;
}
