"use client";

import katex from "katex";
import { Fragment, type ReactNode } from "react";

function renderMath(source: string, displayMode: boolean): string {
  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
  } catch {
    return source;
  }
}

function renderPlain(text: string): ReactNode[] {
  const parts = text.split(/(\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$)/g);
  return parts.map((part, index) => {
    if (part.startsWith("\\[") && part.endsWith("\\]")) {
      const html = renderMath(part.slice(2, -2), true);
      return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    if (part.startsWith("\\(") && part.endsWith("\\)")) {
      const html = renderMath(part.slice(2, -2), false);
      return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    if (part.startsWith("$$") && part.endsWith("$$")) {
      const html = renderMath(part.slice(2, -2), true);
      return <span key={index} dangerouslySetInnerHTML={{ __html: html }} />;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

export function MathText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;

  const blocks = text.split(/(```[\s\S]*?```)/g);
  return (
    <div className={className ?? "question-text"}>
      {blocks.map((block, index) => {
        if (block.startsWith("```") && block.endsWith("```")) {
          const body = block.slice(3, -3).replace(/^[a-zA-Z0-9_-]+\n/, "");
          return (
            <pre key={index}>
              <code>{body.trim()}</code>
            </pre>
          );
        }
        return <Fragment key={index}>{renderPlain(block)}</Fragment>;
      })}
    </div>
  );
}
