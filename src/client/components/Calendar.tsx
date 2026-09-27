import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { localDateKey } from "../utils.ts";
import { parseDay, todayKey } from "../lib/range.ts";

interface CalendarProps {
  startDate: string;
  endDate: string;
  minDate?: string;
  maxDate?: string;
  onRangeSelect: (start: string, end: string) => void;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function Calendar({
  startDate,
  endDate,
  minDate,
  maxDate = todayKey(),
  onRangeSelect,
}: CalendarProps) {
  const initialDate = useMemo(() => {
    try {
      return parseDay(endDate || todayKey());
    } catch {
      return new Date();
    }
  }, [endDate]);

  const [viewDate, setViewDate] = useState<Date>(
    new Date(initialDate.getFullYear(), initialDate.getMonth(), 1)
  );
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  function prevMonth() {
    setViewDate(new Date(year, month - 1, 1));
  }

  function nextMonth() {
    const next = new Date(year, month + 1, 1);
    if (!maxDate || localDateKey(next).slice(0, 7) <= maxDate.slice(0, 7)) {
      setViewDate(next);
    }
  }

  // Days in month grid calculation
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(year, month, 1).getDay();
    const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const days: { key: string; dayNum: number; isCurrentMonth: boolean }[] = [];

    // Leading days from previous month
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = daysInPrevMonth - i;
      const prevDate = new Date(year, month - 1, d);
      days.push({
        key: localDateKey(prevDate),
        dayNum: d,
        isCurrentMonth: false,
      });
    }

    // Days in current month
    for (let d = 1; d <= daysInCurrentMonth; d++) {
      const curDate = new Date(year, month, d);
      days.push({
        key: localDateKey(curDate),
        dayNum: d,
        isCurrentMonth: true,
      });
    }

    // Trailing days from next month to complete row grid (multiples of 7)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      const nextDate = new Date(year, month + 1, d);
      days.push({
        key: localDateKey(nextDate),
        dayNum: d,
        isCurrentMonth: false,
      });
    }

    return days;
  }, [year, month]);

  // Determine active start/end for display (including hover preview)
  const effectiveStart = rangeStart || startDate;
  const effectiveEnd = rangeStart
    ? (hoverDate && hoverDate >= rangeStart ? hoverDate : rangeStart)
    : endDate;

  const [activeStart, activeEnd] =
    effectiveStart <= effectiveEnd
      ? [effectiveStart, effectiveEnd]
      : [effectiveEnd, effectiveStart];

  function handleDayClick(key: string, isDisabled: boolean) {
    if (isDisabled) return;

    if (!rangeStart) {
      // First click: start picking
      setRangeStart(key);
      setHoverDate(null);
    } else {
      // Second click: finish picking
      if (key < rangeStart) {
        onRangeSelect(key, rangeStart);
      } else {
        onRangeSelect(rangeStart, key);
      }
      setRangeStart(null);
      setHoverDate(null);
    }
  }

  const today = todayKey();
  const canGoNext = !maxDate || localDateKey(new Date(year, month + 1, 1)).slice(0, 7) <= maxDate.slice(0, 7);

  return (
    <div className="cal-container">
      {/* Calendar Header: Month + Navigation */}
      <div className="cal-header">
        <span className="cal-title">
          {MONTH_NAMES[month]} {year}
        </span>
        <div className="cal-nav">
          <button
            type="button"
            className="cal-nav-btn"
            onClick={prevMonth}
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            className="cal-nav-btn"
            onClick={nextMonth}
            disabled={!canGoNext}
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Weekday Row */}
      <div className="cal-weekdays">
        {WEEKDAYS.map((w) => (
          <span key={w} className="cal-weekday">
            {w}
          </span>
        ))}
      </div>

      {/* Day Cells Grid */}
      <div className="cal-grid">
        {calendarDays.map(({ key, dayNum, isCurrentMonth }) => {
          const isToday = key === today;
          const isDisabled =
            Boolean(maxDate && key > maxDate) ||
            Boolean(minDate && key < minDate);

          const isSelectedStart = key === activeStart;
          const isSelectedEnd = key === activeEnd;
          const isInRange = key >= activeStart && key <= activeEnd;
          const isSingle = activeStart === activeEnd && isSelectedStart;

          let cellClass = "cal-day";
          if (!isCurrentMonth) cellClass += " is-other-month";
          if (isDisabled) cellClass += " is-disabled";
          if (isToday) cellClass += " is-today";
          if (isInRange) cellClass += " is-in-range";
          if (isSelectedStart) cellClass += " is-range-start";
          if (isSelectedEnd) cellClass += " is-range-end";
          if (isSingle) cellClass += " is-single";

          return (
            <button
              key={key}
              type="button"
              className={cellClass}
              disabled={isDisabled}
              onClick={() => handleDayClick(key, isDisabled)}
              onMouseEnter={() => rangeStart && setHoverDate(key)}
              title={key}
            >
              <span>{dayNum}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
