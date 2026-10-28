import React from "react";
import type { LanguageStat } from "@nexus/developer-toolkit/types";
import { formatBytes, plural } from "./format";

// Six validated categorical slots (see developer.css), then a neutral "Other" fold. Never cycled.
const SLOTS = 6;
type Segment = { name: string; percent: number; bytes: number; files: number; color: string };

export default function LanguageBar({ languages }: { languages: LanguageStat[] }) {
  const [active, setActive] = React.useState<number | null>(null);
  if (!languages.length) return <div className="result-empty">No source code languages detected.</div>;
  const rest = languages.slice(SLOTS);
  const segments: Segment[] = languages.slice(0, SLOTS).map((l, i) => ({ name: l.name, percent: l.percent, bytes: l.bytes, files: l.files, color: `var(--series-${i + 1})` }));
  if (rest.length) {
    segments.push({
      name: `Other (${rest.length})`, color: "var(--series-other)",
      percent: Math.round(rest.reduce((sum, l) => sum + l.percent, 0) * 10) / 10,
      bytes: rest.reduce((sum, l) => sum + l.bytes, 0), files: rest.reduce((sum, l) => sum + l.files, 0)
    });
  }
  const total = segments.reduce((sum, s) => sum + s.percent, 0) || 1;
  const centre = (index: number) => (segments.slice(0, index).reduce((sum, s) => sum + s.percent, 0) + segments[index].percent / 2) / total * 100;
  const tip = active === null ? null : segments[active];
  return <div className="dev-languages dev-viz">
    <div className="dev-language-track" onMouseLeave={() => setActive(null)}>
      <div className="dev-language-bar" role="img" aria-label={"Language breakdown: " + segments.map(s => `${s.name} ${s.percent}%`).join(", ")}>
        {segments.map((s, i) => <span key={s.name} className={active === null ? "" : active === i ? "active" : "dimmed"} style={{ flexGrow: s.percent, background: s.color }} onMouseEnter={() => setActive(i)} />)}
      </div>
      {tip && active !== null && <div className="dev-tooltip" role="presentation" style={{ left: `clamp(70px, ${centre(active)}%, calc(100% - 70px))` }}>
        <strong>{tip.name}</strong><span>{tip.percent}% · {formatBytes(tip.bytes)} · {plural(tip.files, "file")}</span>
      </div>}
    </div>
    <ul className="dev-language-legend">
      {segments.map((s, i) => <li key={s.name} tabIndex={0} className={active === i ? "active" : ""} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
        <span className="dev-swatch" style={{ background: s.color }} /><strong>{s.name}</strong><span className="dev-legend-value">{s.percent}%</span>
        <small>{plural(s.files, "file")} · {formatBytes(s.bytes)}</small>
      </li>)}
    </ul>
  </div>;
}
