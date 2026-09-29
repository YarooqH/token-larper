import React from "react";
import { LOGO_PATHS, LOGO_VIEWBOX } from "../logoMark.ts";

/** The logo in the current text color, so it follows the dashboard theme. */
export function Logo({ className, label }: { className?: string; label?: string }) {
  return (
    <svg
      className={className}
      viewBox={LOGO_VIEWBOX}
      fill="currentColor"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={LOGO_PATHS.t} />
      <path d={LOGO_PATHS.flame} fillRule="evenodd" />
    </svg>
  );
}
