import React, { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, Check, ChevronDown } from "lucide-react";
import {
  RANGE_PRESETS,
  formatSpan,
  presetRange,
  rangeLabel,
  todayKey,
  type DateRange,
} from "../lib/range.ts";
import { Calendar } from "./Calendar.tsx";

interface Props {
  range: DateRange;
  firstDay: string | undefined;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ range, firstDay, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedStart, setSelectedStart] = useState(range.start);
  const [selectedEnd, setSelectedEnd] = useState(range.end);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const today = todayKey();

  useEffect(() => {
    if (!open) return;
    setSelectedStart(range.start);
    setSelectedEnd(range.end);
    rootRef.current?.querySelector<HTMLButtonElement>(".range-option[aria-pressed='true']")?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, range.start, range.end]);

  function choose(next: DateRange) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleCalendarRangeSelect(start: string, end: string) {
    setSelectedStart(start);
    setSelectedEnd(end);
  }

  function applyCustomRange() {
    choose({ preset: "custom", start: selectedStart, end: selectedEnd });
  }

  return (
    <div className="range-picker" ref={rootRef}>
      <span className="field-label" id="range-label">Date range</span>
      <button
        ref={triggerRef}
        type="button"
        className="range-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby="range-label range-value"
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarIcon size={15} aria-hidden="true" />
        <span id="range-value" className="range-value">
          <strong>{rangeLabel(range)}</strong>
          <span className="range-subspan">{formatSpan(range.start, range.end)}</span>
        </span>
        <ChevronDown size={14} className="range-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="range-popover" role="dialog" aria-label="Choose a date range">
          <div className="range-options">
            <span className="range-presets-title">Presets</span>
            {RANGE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="range-option"
                aria-pressed={range.preset === p.id}
                onClick={() => choose(presetRange(p.id, firstDay))}
              >
                <span className="range-check">
                  {range.preset === p.id && <Check size={14} strokeWidth={3} />}
                </span>
                {p.label}
              </button>
            ))}
          </div>

          <div className="range-custom">
            <Calendar
              startDate={selectedStart}
              endDate={selectedEnd}
              minDate={firstDay}
              maxDate={today}
              onRangeSelect={handleCalendarRangeSelect}
            />
            <div className="range-custom-footer">
              <div className="range-custom-summary">
                <span className="range-custom-span-text">
                  {formatSpan(selectedStart, selectedEnd)}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-primary range-apply-btn"
                onClick={applyCustomRange}
              >
                Apply Range
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
