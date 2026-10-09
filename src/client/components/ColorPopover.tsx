import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 8;
const MARGIN = 8;

interface Props {
  /** The button that opened it; the popover sits next to it. */
  anchor: React.RefObject<HTMLElement | null>;
  id: string;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Floats beside its anchor, below it when there is room and above it otherwise. It is
 * rendered inside the open dialog, so the dialog's scrolling never clips it and keyboard
 * focus stays in the dialog, and it follows the anchor while the dialog scrolls.
 */
export function ColorPopover({ anchor, id, label, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useLayoutEffect(() => {
    const place = () => {
      const button = anchor.current;
      const box = ref.current;
      if (!button || !box) return;
      const a = button.getBoundingClientRect();
      const scroller = button.closest(".modal")?.getBoundingClientRect();
      // The button scrolled out of sight, so the popover has nothing to point at.
      if (scroller && (a.bottom < scroller.top || a.top > scroller.bottom)) {
        close.current();
        return;
      }
      const { width, height } = box.getBoundingClientRect();
      const below = a.bottom + GAP;
      const above = a.top - GAP - height;
      const fitsBelow = below + height <= window.innerHeight - MARGIN;
      const top = fitsBelow || above < MARGIN ? Math.min(below, Math.max(MARGIN, window.innerHeight - MARGIN - height)) : above;
      const left = Math.min(Math.max(MARGIN, a.left), Math.max(MARGIN, window.innerWidth - MARGIN - width));
      setPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    };
    place();
    window.addEventListener("resize", place);
    // Capture, because scroll events don't bubble up from the dialog.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  // Hidden elements can't take focus, so wait until the popover has been placed.
  const placed = pos !== null;
  useEffect(() => {
    if (placed) ref.current?.querySelector<HTMLElement>("input")?.focus({ preventScroll: true });
  }, [placed]);

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) close.current();
    };
    // Capture on window, so this runs before the dialog's own Escape handler closes everything.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      event.preventDefault();
      close.current();
      anchor.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor]);

  const host = anchor.current?.closest<HTMLElement>(".modal") ?? document.body;
  return createPortal(
    <div
      ref={ref}
      id={id}
      className="color-popover"
      role="dialog"
      aria-label={`${label} color picker`}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
    >
      {children}
    </div>,
    host
  );
}
