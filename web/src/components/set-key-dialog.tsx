"use client";

import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { buttonClass } from "@/components/ui";
import { optionLabel } from "@/lib/lookup-links";
import type { AnswerOption } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SetKeyDialog({
  open,
  options,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  options: AnswerOption[];
  pending: boolean;
  onClose: () => void;
  onConfirm: (ord: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="set-key-title"
        className="w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="set-key-title" className="text-sm font-semibold">
              Set the correct answer
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              This key is saved to your local database and grades every future attempt.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {options.map((option) => (
            <button
              key={option.ord}
              type="button"
              onClick={() => setSelected(option.ord)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left text-xs transition",
                selected === option.ord
                  ? "border-primary bg-primary/10"
                  : "border-border bg-background hover:bg-muted",
              )}
            >
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-lg border text-[10px] font-semibold",
                  selected === option.ord
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {selected === option.ord ? <Check className="size-3" /> : optionLabel(option)}
              </span>
              <span className="pt-0.5 leading-relaxed">{option.text}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className={buttonClass({ variant: "secondary", className: "flex-1" })}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={selected == null || pending}
            onClick={() => {
              if (selected != null) onConfirm(selected);
            }}
            className={buttonClass({ className: "flex-1" })}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save key
          </button>
        </div>
      </div>
    </div>
  );
}
