"use client";

import { useEffect, useRef, useState } from "react";

type Mode = "live" | "demo";

const OPTIONS: { id: Mode; title: string; text: string }[] = [
  {
    id: "live",
    title: "Live-testi",
    text: "Kävele itse ja seuraa mihin päädyt.",
  },
  {
    id: "demo",
    title: "Demotila",
    text: "Pieni tutkija kävelee puolestasi.",
  },
];

const TRAVEL: { id: "walk" | "car"; label: string; icon: React.ReactNode }[] = [
  {
    id: "walk",
    label: "Kävellen",
    icon: (
      <>
        <circle cx="17" cy="5.5" r="2.6" fill="currentColor" stroke="none" />
        <path d="M14.5 11.5 11 14v5M14.5 11.5l3 1 2.5 4h3.5M14.5 11.5 13 19l-3.5 8M13 19l4.5 3 1.5 5.5" />
      </>
    ),
  },
  {
    id: "car",
    label: "Autolla",
    icon: (
      <>
        <path d="M4 21v-4.5c0-1.2.8-2.2 2-2.5l3-.8 3.2-4.6c.6-.8 1.5-1.3 2.5-1.3h5.6c1 0 1.9.4 2.5 1.2l3.5 4.6 1.8.5c1.2.3 1.9 1.3 1.9 2.5V21z" />
        <circle cx="10" cy="22" r="2.6" fill="currentColor" />
        <circle cx="22.5" cy="22" r="2.6" fill="currentColor" />
        <path d="M13 13.2h12" />
      </>
    ),
  },
];

const HELP: { title: string; text: string; tip?: string }[] = [
  { title: "Valitse lähtö ja määränpää", text: "Hae paikkaa tai napauta karttaa." },
  {
    title: "Valitse tyyli",
    text: "Maisema kulkee puistojen ja rantojen kautta, Historia muistomerkkien ja vanhojen rakennusten, Yllätys kummallisuuksien.",
    tip: "Historiaretkellä: zoomaa karttaa lähemmäs, niin reitin varren yli 80 vuotta vanhat rakennukset hehkuvat ja niiden rakennusvuodet tulevat näkyviin.",
  },
  { title: "Säädä harhailua", text: "1 on pieni mutka, 5 kunnon kierros ja 11 on täysin sekaisin." },
  { title: "Tutki pysähdyksiä", text: "Reitti kulkee jokaisen pysähdyksen kautta. Kortit kertovat kohteiden tarinat ja näyttävät kuvat." },
  { title: "Lähde kävelemään", text: "Live-testissä GPS seuraa sinua ja kertoo, kun saavut. Demotilassa pieni tutkija kävelee puolestasi." },
  { title: "Jaa retki", text: "Jaa retki -linkillä kaverisi pääsee samalle reitille." },
];

/**
 * First screen: a paper panel over the live map, where an example trip through Helsinki is drawn
 * (by AdventureFlow). Choose how to try the app; `last` (the previous choice) is pre-highlighted.
 */
export function WelcomeScreen({
  last,
  onChoose,
  onPick,
  travel,
  onTravel,
}: {
  last: Mode | null;
  onChoose: (m: Mode) => void;
  /** Called synchronously inside the tap (before the exit animation), e.g. to ask for GPS permission. */
  onPick?: (m: Mode) => void;
  travel: "walk" | "car";
  onTravel: (t: "walk" | "car") => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  // Play the exit animation, then hand over to the app.
  const [leaving, setLeaving] = useState(false);
  const [help, setHelp] = useState(false);
  const choose = (m: Mode) => {
    if (leaving) return;
    // Browsers only reliably show the location prompt for requests made directly in a user gesture.
    onPick?.(m);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onChoose(m);
    setLeaving(true);
    window.setTimeout(() => onChoose(m), 480);
  };
  useEffect(() => {
    firstRef.current?.focus({ preventScroll: true });
  }, [last]);
  // Escape keeps the previous choice (or demo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (help) setHelp(false);
      else choose(last ?? "demo");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // choose is stable enough for a keydown listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, onChoose, leaving, help]);

  return (
    <div className={`wl ${leaving ? "is-leaving" : ""}`} role="dialog" aria-modal="true" aria-labelledby="wl-title">

      <div className="wl-content">
        <h1 id="wl-title" className="wl-title">
          Eksy
          <br />
          <em>tarkoituksella.</em>
        </h1>
        <p className="wl-lede">Navigaattori, joka vie perille mutkan kautta.</p>

        {help ? (
          <section className="wl-help" aria-labelledby="wl-help-title">
            <h2 id="wl-help-title" className="wl-ask">
              Miten Harharetki toimii?
            </h2>
            <ol className="wl-help-list">
              {HELP.map((h, i) => (
                <li key={h.title}>
                  <span className="wl-num" aria-hidden>
                    0{i + 1}
                  </span>
                  <span>
                    <span className="wl-help-title">{h.title}</span>
                    <span className="wl-option-text">{h.text}</span>
                    {h.tip && <strong className="wl-tip">{h.tip}</strong>}
                  </span>
                </li>
              ))}
            </ol>
            <p className="wl-help-note">Kartta ja kohteet: OpenStreetMap · tarinat: Wikipedia.</p>
            <button type="button" className="wl-help-btn" onClick={() => setHelp(false)}>
              ← Takaisin
            </button>
          </section>
        ) : (
          <>
        <div className="wl-travel" role="radiogroup" aria-label="Kulkutapa">
          {TRAVEL.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={travel === t.id}
              className={`wl-travel-tile ${travel === t.id ? "is-on" : ""}`}
              onClick={() => onTravel(t.id)}
            >
              <svg aria-hidden viewBox="0 0 32 32" className="wl-travel-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {t.icon}
              </svg>
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <p className="wl-ask">Miten lähdet matkaan?</p>
          <ul className="wl-options">
            {OPTIONS.map((o, i) => (
              <li key={o.id}>
                <button
                  ref={(last ? last === o.id : i === 0) ? firstRef : undefined}
                  type="button"
                  className={`wl-option ${last === o.id ? "is-last" : ""}`}
                  onClick={() => choose(o.id)}
                  style={{ animationDelay: `${350 + i * 120}ms` }}
                >
                  <span className="wl-option-body">
                    <span className="wl-option-title">
                      {o.title}
                      {last === o.id && <span className="wl-last">viimeksi</span>}
                    </span>
                    <span className="wl-option-text">{o.text}</span>
                  </span>
                  <span className="wl-arrow" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
            <button type="button" className="wl-help-btn" onClick={() => setHelp(true)}>
              <span className="wl-help-icon" aria-hidden>?</span> Miten tämä toimii?
            </button>
          </>
        )}


      </div>
    </div>
  );
}
