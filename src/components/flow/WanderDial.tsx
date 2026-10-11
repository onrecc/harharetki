"use client";

import { useId, type KeyboardEvent } from "react";
import { WANDER_LABELS, type Wander } from "@/lib/routing/adventure";

export const WANDER_LEVELS: Wander[] = [1, 2, 3, 4, 5, 11];

const WANDER_TEXT: Record<Wander, string> = {
  1: "Yksi pysähdys, lähes suoraan perille.",
  2: "Pari kiinnostavaa kohdetta matkan varrelta.",
  3: "Muutama pysähdys ja vähän sivupolkuja.",
  4: "Useita kohteita, reilu lenkki.",
  5: "Kunnon kierros kaikkien parhaiden kautta.",
  11: "Tämä menee yhteentoista. Varaa eväät.",
};

/** Radio-style 1–5 dial with an extra "11" for the crazy option. Arrow keys move the selection. */
export function WanderDial({ value, onChange }: { value: Wander; onChange: (w: Wander) => void }) {
  const id = useId();
  const idx = WANDER_LEVELS.indexOf(value);

  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = WANDER_LEVELS[Math.min(WANDER_LEVELS.length - 1, Math.max(0, idx + d))];
    onChange(next);
    document.getElementById(`${id}-${next}`)?.focus();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span id={`${id}-label`} className="text-xs font-semibold tracking-wide text-[var(--ink-soft)] uppercase">
          Harhailun määrä
        </span>
        <span className={`text-sm font-semibold ${value === 11 ? "text-[var(--coral)]" : "text-[var(--ink)]"}`}>
          {WANDER_LABELS[value]}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-label`} className="flow-dial" onKeyDown={onKey}>
        {WANDER_LEVELS.map((w, i) => {
          const on = w === value;
          return (
            <button
              key={w}
              id={`${id}-${w}`}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${w}: ${WANDER_LABELS[w]}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(w)}
              className={`flow-dial-step ${w === 11 ? "flow-dial-step--eleven" : ""} ${on ? "is-on" : ""} ${
                i <= idx ? "is-filled" : ""
              }`}
            >
              {w}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-[var(--ink-soft)]">{WANDER_TEXT[value]}</p>
    </div>
  );
}

/** Compact level indicator for the result card: rising bars, and a hot animated pill at 11. */
export function WanderBadge({ level }: { level: Wander }) {
  const idx = WANDER_LEVELS.indexOf(level);
  return (
    <span
      className={`flow-wander-badge ${level === 11 ? "flow-wander-badge--eleven" : ""}`}
      aria-label={`Harhailu ${level}: ${WANDER_LABELS[level]}`}
    >
      <span className="flow-wander-bars" aria-hidden>
        {WANDER_LEVELS.slice(0, 5).map((w, i) => (
          <span key={w} className={i <= idx ? "is-on" : ""} style={{ height: `${6 + i * 3}px` }} />
        ))}
      </span>
      <span aria-hidden className="flex flex-col leading-none">
        <span className="flow-wander-num">{level}</span>
        <span className="flow-wander-label">{WANDER_LABELS[level]}</span>
      </span>
    </span>
  );
}
