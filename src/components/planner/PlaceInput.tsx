"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchPlaces, type Place } from "@/lib/osm/geocode";
import { loadPlaces, searchLocal } from "@/lib/osm/places";
import { warmDemoData } from "@/lib/osm/load";
import type { LngLat } from "@/lib/routing/geo";

type Props = {
  label: string;
  placeholder: string;
  value: string;
  near: LngLat;
  marker: "start" | "end";
  active: boolean;
  onFocus: () => void;
  onPick: (p: Place) => void;
  onClear: () => void;
};

export function PlaceInput({ label, placeholder, value, near, marker, active, onFocus, onPick, onClear }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState(value);
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [loading, setLoading] = useState(false);
  const [lastValue, setLastValue] = useState(value);
  const nearRef = useRef(near);
  useEffect(() => {
    nearRef.current = near;
  });

  // Mirror external changes (map click, demo) into the field.
  if (value !== lastValue) {
    setLastValue(value);
    setText(value);
  }

  // Warm up the instant local index and the bundled map data as soon as the field exists.
  useEffect(() => {
    loadPlaces();
    warmDemoData();
  }, []);

  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === value) return;
    const ctrl = new AbortController();
    // Instant: local street & place names (central Helsinki).
    let local = searchLocal(q);
    const showLocal = () => {
      setResults(local);
      setHi(0);
    };
    if (local.length) showLocal();
    else loadPlaces().then(() => {
      if (ctrl.signal.aborted) return;
      local = searchLocal(q);
      if (local.length) showLocal();
    });
    // Then: Photon for everything else, merged after the local hits.
    const t = setTimeout(async () => {
      if (q.length < 3) return;
      setLoading(true);
      try {
        const remote = await searchPlaces(q, nearRef.current, ctrl.signal);
        const names = new Set(local.map((p) => p.name.toLowerCase()));
        setResults([...local.slice(0, 3), ...remote.filter((p) => !names.has(p.name.toLowerCase()))].slice(0, 7));
      } catch {
        // Keep whatever local results we have.
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
      setLoading(false);
    };
  }, [text, open, value]);

  // Enter before suggestions arrive: take the best match (local first, then Photon).
  const searchAndPickFirst = async () => {
    const q = text.trim();
    if (q.length < 2) return;
    await loadPlaces();
    const local = searchLocal(q, 1);
    if (local[0]) return pick(local[0]);
    setLoading(true);
    try {
      const r = await searchPlaces(q, nearRef.current);
      if (r[0]) pick(r[0]);
    } catch {
      // Keep the typed text; the user can retry or tap the map.
    } finally {
      setLoading(false);
    }
  };

  const pick = (p: Place) => {
    setText(p.name);
    setOpen(false);
    setResults([]);
    onPick(p);
  };

  const showList = open && results.length > 0 && text.trim().length >= 2 && text !== value;

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 flex items-center gap-2 text-xs font-semibold tracking-wide text-[var(--ink-soft)] uppercase">
        <span
          aria-hidden
          className={
            marker === "start"
              ? "size-2.5 rounded-full border-[2.5px] border-[var(--sea-deep)] bg-white"
              : "size-2.5 rounded-sm bg-[var(--coral)]"
          }
        />
        {label}
      </label>
      <div
        className={`flex items-center rounded-xl border bg-white/90 transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--sea)] focus-within:shadow-[0_0_0_3px_var(--focus-ring)] ${
          active ? "border-[var(--sea)]/70" : "border-[var(--line)]"
        }`}
      >
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${hi}` : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={placeholder}
          value={text}
          onFocus={() => {
            setOpen(true);
            onFocus();
          }}
          onBlur={() =>
            setTimeout(() => {
              setOpen(false);
              // Typed but not picked: resolve the text, so the trip never silently uses the old place.
              if (text.trim() && text.trim() !== value) searchAndPickFirst();
            }, 120)
          }
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!showList) {
              if (e.key === "Enter" && text.trim() !== value) {
                e.preventDefault();
                searchAndPickFirst();
              }
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHi((h) => (h + 1) % results.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHi((h) => (h - 1 + results.length) % results.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(results[hi]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          className="h-11 min-w-0 flex-1 rounded-xl bg-transparent px-3 text-base text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
        />
        {loading && (
          <span aria-hidden className="mr-2 size-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--sea)]" />
        )}
        {text && (
          <button
            type="button"
            onClick={() => {
              setText("");
              setResults([]);
              onClear();
            }}
            aria-label={`Tyhjennä ${label.toLowerCase()}`}
            className="mr-1 grid size-9 place-items-center rounded-lg text-[var(--ink-faint)] hover:bg-[var(--sand)] hover:text-[var(--ink)]"
          >
            <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} – hakutulokset`}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-[var(--line)] bg-white p-1 shadow-[0_1px_2px_rgba(15,42,58,.08),0_12px_32px_-8px_rgba(15,42,58,.25)]"
        >
          {results.map((r, i) => (
            <li
              key={r.id + i}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === hi}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
              onMouseEnter={() => setHi(i)}
              className={`cursor-pointer rounded-lg px-3 py-2 ${i === hi ? "bg-[var(--sand)]" : ""}`}
            >
              <div className="text-sm font-medium text-[var(--ink)]">{r.name}</div>
              {r.context && <div className="text-xs text-[var(--ink-soft)]">{r.context}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
