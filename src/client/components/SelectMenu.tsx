import React, { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "./Icons.tsx";

export interface SelectMenuOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  visual?: React.ReactNode;
}

interface Props<T extends string> {
  label: string;
  value: T;
  options: SelectMenuOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  showDescriptionInTrigger?: boolean;
}

export function SelectMenu<T extends string>({ label, value, options, onChange, className = "", showDescriptionInTrigger = false }: Props<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
    rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']")[selectedIndex]?.focus();
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function moveFocus(direction: number) {
    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']");
    if (!items?.length) return;
    const current = Array.from(items).findIndex((item) => item === document.activeElement);
    const next = (current + direction + items.length) % items.length;
    items[next]?.focus();
  }

  function choose(next: T) {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={`select-menu ${className}`.trim()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) setOpen(true);
          else moveFocus(event.key === "ArrowDown" ? 1 : -1);
        } else if (open && (event.key === "Home" || event.key === "End")) {
          event.preventDefault();
          const items = rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='option']");
          items?.[event.key === "Home" ? 0 : items.length - 1]?.focus();
        }
      }}
    >
      <span className="field-label" id={labelId}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="select-menu-trigger"
        aria-label={`${label}: ${selected?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected?.visual}
        <span className="select-menu-copy">
          <strong>{selected?.label}</strong>
          {showDescriptionInTrigger && selected?.description && <small>{selected.description}</small>}
        </span>
        <ChevronDown size={15} className="select-menu-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="select-menu-list" role="listbox" aria-labelledby={labelId}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="select-menu-option"
              onClick={() => choose(option.value)}
            >
              {option.visual}
              <span className="select-menu-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
              {option.value === value && <Check size={15} className="select-menu-check" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
