"use client";

import { DEMO_VISUALS, VisualRenderer } from "@/components/show-me";

import { ThemeToggle } from "./theme-toggle";
import { UrlForm } from "./url-form";

export interface EmptyStateProps {
  onSubmit: (url: string) => void;
  busy?: boolean;
}

export function EmptyState({ onSubmit, busy = false }: EmptyStateProps) {
  // Two is enough to show the vocabulary without turning the hero into a gallery.
  const preview = DEMO_VISUALS.slice(0, 2);

  return (
    <main className="relative flex min-h-dvh flex-col">
      <ThemeToggle className="absolute top-3 right-3" />
      <section className="flex flex-1 flex-col items-center justify-center px-6 pt-24 pb-16">
        <div className="w-full max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Paste a pull request.</h1>
          <p className="mt-3 text-lg text-muted-foreground">Understand it in a minute. Ask anything.</p>
          <UrlForm onSubmit={onSubmit} busy={busy} autoFocus className="mt-8" />
        </div>
      </section>

      {preview.length > 0 && (
        <section aria-label="Preview" className="border-t border-border bg-muted/30 px-6 py-10">
          <div className="mx-auto w-full max-w-4xl">
            <p className="mb-4 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              What you&apos;ll get
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {preview.map((visual, i) => (
                <div key={`${visual.kind}-${i}`} className="min-w-0">
                  <VisualRenderer visual={visual} compact />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
