import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pipette } from "./Icons.tsx";
import { debounce, hexToLch, lchToHex, normalizeHex, type Lch } from "../lib/color.ts";
import { contrast, inkFor } from "../themes.ts";

// The browser's own <input type="color"> reports every mouse move while you drag. Each
// report re-rendered the dashboard and rewrote the theme, which pegged the CPU. Here the
// sliders only touch this component while you drag; the theme gets the color once you
// pause for a moment or let go.

const SETTLE_MS = 200;
/** A prop change this soon after the last edit is our own color coming back, not an outside change. */
const ECHO_MS = 600;

interface Props {
  /** "#rrggbb" */
  value: string;
  label: string;
  /** Show how well text reads on this color, for colors used behind text. */
  showContrast?: boolean;
  onChange: (hex: string) => void;
}

const stops = (count: number, at: (t: number) => string) =>
  Array.from({ length: count }, (_, i) => at(i / (count - 1))).join(", ");

function verdict(ratio: number): string {
  return ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "Large text only" : "Low";
}

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };
const eyeDropper = (): EyeDropperCtor | undefined =>
  typeof window === "undefined" ? undefined : (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

export function ColorPicker({ value, label, showContrast = false, onChange }: Props) {
  const [lch, setLch] = useState<Lch>(() => hexToLch(value));
  const [hexText, setHexText] = useState(() => lchToHex(hexToLch(value)));
  const lchRef = useRef(lch);
  const lastEdit = useRef(-Infinity);
  const latestOnChange = useRef(onChange);
  latestOnChange.current = onChange;
  const commit = useMemo(() => debounce<string>((hex) => latestOnChange.current(hex), SETTLE_MS), []);
  useEffect(() => () => commit.flush(), [commit]);

  // Follow changes made elsewhere, such as clicking a preset swatch while this is open.
  useEffect(() => {
    if (performance.now() - lastEdit.current < ECHO_MS) return;
    const next = normalizeHex(value);
    if (!next || next === lchToHex(lchRef.current)) return;
    const parsed = hexToLch(next, lchRef.current.h);
    lchRef.current = parsed;
    setLch(parsed);
    setHexText(next);
  }, [value]);

  function update(next: Lch, { syncText = true }: { syncText?: boolean } = {}) {
    lchRef.current = next;
    lastEdit.current = performance.now();
    setLch(next);
    const hex = lchToHex(next);
    if (syncText) setHexText(hex);
    commit.push(hex);
  }

  async function pickFromScreen() {
    const EyeDropper = eyeDropper();
    if (!EyeDropper) return;
    try {
      const picked = normalizeHex((await new EyeDropper().open()).sRGBHex);
      if (!picked) return;
      update(hexToLch(picked, lchRef.current.h));
      commit.flush();
    } catch {
      // Escape or a click away from the picker cancels it.
    }
  }

  const hex = lchToHex(lch);
  const ink = inkFor(hex);
  const ratio = contrast(ink, hex);
  const tracks = {
    h: `linear-gradient(to right, ${stops(13, (t) => lchToHex({ ...lch, h: t * 360 }))})`,
    v: `linear-gradient(to right, ${stops(5, (t) => lchToHex({ ...lch, v: t * 100 }))})`,
    l: `linear-gradient(to right, ${stops(9, (t) => lchToHex({ ...lch, l: t * 100 }))})`,
  };
  const sliders = [
    { key: "h", name: "Hue", max: 360, text: `${Math.round(lch.h)}°` },
    { key: "v", name: "Vibrance", max: 100, text: String(Math.round(lch.v)) },
    { key: "l", name: "Lightness", max: 100, text: String(Math.round(lch.l)) },
  ] as const;

  return (
    <div className="color-picker" style={{ "--picked": hex } as React.CSSProperties}>
      <div className="color-preview" style={{ background: hex, color: ink }}>
        <span className="color-preview-sample" aria-hidden="true">Aa</span>
        <span className="color-preview-note">{showContrast ? `${ratio.toFixed(1)}:1 · ${verdict(ratio)}` : hex}</span>
      </div>

      {sliders.map(({ key, name, max, text }) => (
        <label className="color-slider" key={key}>
          <span className="color-slider-head">
            <span>{name}</span>
            <output>{text}</output>
          </span>
          <input
            type="range"
            min={0}
            max={max}
            step={1}
            value={Math.round(lch[key])}
            style={{ background: tracks[key] }}
            aria-label={`${label} ${name.toLowerCase()}`}
            onChange={(event) => update({ ...lchRef.current, [key]: Number(event.target.value) })}
            onPointerUp={commit.flush}
            onKeyUp={commit.flush}
            onBlur={commit.flush}
          />
        </label>
      ))}

      <div className="color-hex-row">
        <input
          className="color-hex"
          type="text"
          value={hexText}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={`${label} hex value`}
          aria-invalid={normalizeHex(hexText) ? undefined : true}
          onChange={(event) => {
            setHexText(event.target.value);
            const typed = normalizeHex(event.target.value);
            if (typed) update(hexToLch(typed, lchRef.current.h), { syncText: false });
          }}
          onKeyDown={(event) => event.key === "Enter" && commit.flush()}
          onBlur={() => {
            setHexText(lchToHex(lchRef.current));
            commit.flush();
          }}
        />
        {eyeDropper() && (
          <button
            type="button"
            className="color-dropper"
            onClick={pickFromScreen}
            title="Pick a color from the screen"
            aria-label={`Pick ${label.toLowerCase()} color from the screen`}
          >
            <Pipette size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
