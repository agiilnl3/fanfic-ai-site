import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";

type Props = {
  /** Estimated total reading time, in minutes. */
  totalMinutes: number;
  /** Total word count, for screen-reader and tooltip context. */
  wordCount: number;
};

const MIN_PCT = 0;
const MAX_PCT = 100;

/**
 * Sticky bar that sits below the global header on /story/:id and shows:
 *   - a thin progress fill that follows window scroll, and
 *   - a "X min left of Y min" reading-time hint based on the document's
 *     total scrollable height vs. words/200wpm.
 *
 * Pure window-scroll math; intentionally separate from the analytics
 * scroll-throttle in story.tsx (which writes /reading-progress at most
 * every 1.5s) so this bar can update at full rAF cadence without
 * spamming the API.
 */
export function ReadingProgressBar({ totalMinutes, wordCount }: Props) {
  const { t } = useTranslation();
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) {
        setPct(0);
        return;
      }
      const next = Math.max(
        MIN_PCT,
        Math.min(MAX_PCT, (window.scrollY / max) * 100),
      );
      setPct(next);
    };
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(tick);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const minutesLeft = Math.max(0, Math.ceil(totalMinutes * (1 - pct / 100)));
  const safeTotal = Math.max(1, Math.round(totalMinutes));

  return (
    <div
      className="sticky top-16 z-40 -mx-4 px-4 py-1.5 bg-background/85 backdrop-blur-md border-b border-border/40"
      data-testid="reading-progress-bar"
    >
      <div className="container mx-auto max-w-4xl flex items-center gap-3">
        <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span
          className="text-xs text-muted-foreground tabular-nums shrink-0"
          title={t("reading.wordsTooltip", "{{count}} words", {
            count: wordCount,
          })}
          aria-live="polite"
          aria-atomic="true"
        >
          {pct >= 99
            ? t("reading.done", "Finished")
            : t("reading.minutesLeft", "{{minutes}} min left of {{total}} min", {
                minutes: minutesLeft,
                total: safeTotal,
              })}
        </span>
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(pct)}
            aria-label={t("reading.progress", "Reading progress")}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-8 text-right">
          {Math.round(pct)}%
        </span>
      </div>
    </div>
  );
}
