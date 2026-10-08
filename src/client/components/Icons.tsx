import React from "react";

// The icons the dashboard uses, copied from Lucide (https://lucide.dev, ISC license,
// see THIRD_PARTY_NOTICES.md). Keeping only these avoids installing lucide-react, which
// ships every icon and made up most of the install size. Names match Lucide's, so an
// icon can be added by copying its shapes from lucide.dev.

type Shape = [tag: "path" | "circle" | "rect" | "line" | "polyline" | "ellipse", attrs: Record<string, string>];

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export type Icon = (props: IconProps) => React.JSX.Element;

function icon(shapes: Shape[]): Icon {
  return ({ size = 24, strokeWidth = 2, children, ...rest }) => {
    // Decorative unless the caller labels it, as Lucide does.
    const labelled = Object.keys(rest).some((key) => key.startsWith("aria-") || key === "role" || key === "title");
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={labelled ? undefined : true}
        {...rest}
      >
        {shapes.map(([Tag, attrs], i) => <Tag key={i} {...attrs} />)}
        {children}
      </svg>
    );
  };
}

export const AlertTriangle = icon([["path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }], ["path", { d: "M12 9v4" }], ["path", { d: "M12 17h.01" }]]);
export const ArrowDownRight = icon([["path", { d: "m7 7 10 10" }], ["path", { d: "M17 7v10H7" }]]);
export const ArrowUpCircle = icon([["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "m16 12-4-4-4 4" }], ["path", { d: "M12 16V8" }]]);
export const ArrowUpRight = icon([["path", { d: "M7 7h10v10" }], ["path", { d: "M7 17 17 7" }]]);
export const Banknote = icon([["rect", { width: "20", height: "12", x: "2", y: "6", rx: "2" }], ["circle", { cx: "12", cy: "12", r: "2" }], ["path", { d: "M6 12h.01M18 12h.01" }]]);
export const Boxes = icon([["path", { d: "M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" }], ["path", { d: "m7 16.5-4.74-2.85" }], ["path", { d: "m7 16.5 5-3" }], ["path", { d: "M7 16.5v5.17" }], ["path", { d: "M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" }], ["path", { d: "m17 16.5-5-3" }], ["path", { d: "m17 16.5 4.74-2.85" }], ["path", { d: "M17 16.5v5.17" }], ["path", { d: "M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" }], ["path", { d: "M12 8 7.26 5.15" }], ["path", { d: "m12 8 4.74-2.85" }], ["path", { d: "M12 13.5V8" }]]);
export const Calendar = icon([["path", { d: "M8 2v3" }], ["path", { d: "M16 2v3" }], ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }], ["path", { d: "M3 9h18" }]]);
export const CalendarDays = icon([["path", { d: "M8 2v3" }], ["path", { d: "M16 2v3" }], ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }], ["path", { d: "M3 9h18" }], ["path", { d: "M8 13h.01" }], ["path", { d: "M12 13h.01" }], ["path", { d: "M16 13h.01" }], ["path", { d: "M8 17h.01" }], ["path", { d: "M12 17h.01" }], ["path", { d: "M16 17h.01" }]]);
export const Check = icon([["path", { d: "M20 6 9 17l-5-5" }]]);
export const ChevronDown = icon([["path", { d: "m6 9 6 6 6-6" }]]);
export const ChevronLeft = icon([["path", { d: "m15 18-6-6 6-6" }]]);
export const ChevronRight = icon([["path", { d: "m9 18 6-6-6-6" }]]);
export const Coins = icon([["path", { d: "M13.744 17.736a6 6 0 1 1-7.48-7.48" }], ["path", { d: "M15 6h1v4" }], ["path", { d: "m6.134 14.768.866-.5 2 3.464" }], ["circle", { cx: "16", cy: "8", r: "6" }]]);
export const Copy = icon([["rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }], ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]]);
export const Crown = icon([["path", { d: "M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z" }], ["path", { d: "M5 21h14" }]]);
export const Database = icon([["ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }], ["path", { d: "M3 5V19A9 3 0 0 0 21 19V5" }], ["path", { d: "M3 12A9 3 0 0 0 21 12" }]]);
export const Download = icon([["path", { d: "M12 15V3" }], ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }], ["path", { d: "m7 10 5 5 5-5" }]]);
export const Fish = icon([["path", { d: "M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z" }], ["path", { d: "M18 12v.5" }], ["path", { d: "M16 17.93a9.77 9.77 0 0 1 0-11.86" }], ["path", { d: "M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33" }], ["path", { d: "M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4" }], ["path", { d: "m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98" }]]);
export const Flame = icon([["path", { d: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" }]]);
export const FolderGit2 = icon([["path", { d: "M18 19a5 5 0 0 1-5-5v8" }], ["path", { d: "M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" }], ["circle", { cx: "13", cy: "12", r: "2" }], ["circle", { cx: "20", cy: "19", r: "2" }]]);
export const Heart = icon([["path", { d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" }]]);
export const Languages = icon([["path", { d: "m5 8 6 6" }], ["path", { d: "m4 14 6-6 2-3" }], ["path", { d: "M2 5h12" }], ["path", { d: "M7 2h1" }], ["path", { d: "m22 22-5-10-5 10" }], ["path", { d: "M14 18h6" }]]);
export const Maximize2 = icon([["polyline", { points: "15 3 21 3 21 9" }], ["polyline", { points: "9 21 3 21 3 15" }], ["line", { x1: "21", x2: "14", y1: "3", y2: "10" }], ["line", { x1: "3", x2: "10", y1: "21", y2: "14" }]]);
export const Minimize2 = icon([["polyline", { points: "4 14 10 14 10 20" }], ["polyline", { points: "20 10 14 10 14 4" }], ["line", { x1: "14", x2: "21", y1: "10", y2: "3" }], ["line", { x1: "3", x2: "10", y1: "21", y2: "14" }]]);
export const Minus = icon([["path", { d: "M5 12h14" }]]);
export const Moon = icon([["path", { d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" }]]);
export const Pipette = icon([["path", { d: "m12 9-8.414 8.414A2 2 0 0 0 3 18.828v1.344a2 2 0 0 1-.586 1.414A2 2 0 0 1 3.828 21h1.344a2 2 0 0 0 1.414-.586L15 12" }], ["path", { d: "m18 9 .4.4a1 1 0 1 1-3 3l-3.8-3.8a1 1 0 1 1 3-3l.4.4 3.4-3.4a1 1 0 1 1 3 3z" }], ["path", { d: "m2 22 .414-.414" }]]);
export const Power = icon([["path", { d: "M12 2v10" }], ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04" }]]);
export const Radio = icon([["path", { d: "M16.247 7.761a6 6 0 0 1 0 8.478" }], ["path", { d: "M19.075 4.933a10 10 0 0 1 0 14.134" }], ["path", { d: "M4.925 19.067a10 10 0 0 1 0-14.134" }], ["path", { d: "M7.753 16.239a6 6 0 0 1 0-8.478" }], ["circle", { cx: "12", cy: "12", r: "2" }]]);
export const RefreshCw = icon([["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }], ["path", { d: "M21 3v5h-5" }], ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }], ["path", { d: "M8 16H3v5" }]]);
export const Search = icon([["path", { d: "m21 21-4.34-4.34" }], ["circle", { cx: "11", cy: "11", r: "8" }]]);
export const Settings = icon([["path", { d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" }], ["circle", { cx: "12", cy: "12", r: "3" }]]);
export const Share2 = icon([["circle", { cx: "18", cy: "5", r: "3" }], ["circle", { cx: "6", cy: "12", r: "3" }], ["circle", { cx: "18", cy: "19", r: "3" }], ["line", { x1: "8.59", x2: "15.42", y1: "13.51", y2: "17.49" }], ["line", { x1: "15.41", x2: "8.59", y1: "6.51", y2: "10.49" }]]);
export const Shield = icon([["path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }]]);
export const Sparkles = icon([["path", { d: "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" }], ["path", { d: "M20 2v4" }], ["path", { d: "M22 4h-4" }], ["circle", { cx: "4", cy: "20", r: "2" }]]);
export const Sun = icon([["circle", { cx: "12", cy: "12", r: "4" }], ["path", { d: "M12 2v2" }], ["path", { d: "M12 20v2" }], ["path", { d: "m4.93 4.93 1.41 1.41" }], ["path", { d: "m17.66 17.66 1.41 1.41" }], ["path", { d: "M2 12h2" }], ["path", { d: "M20 12h2" }], ["path", { d: "m6.34 17.66-1.41 1.41" }], ["path", { d: "m19.07 4.93-1.41 1.41" }]]);
export const Trophy = icon([["path", { d: "M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" }], ["path", { d: "M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" }], ["path", { d: "M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" }], ["path", { d: "M4 22h16" }], ["path", { d: "M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" }], ["path", { d: "M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" }]]);
export const Waves = icon([["path", { d: "M2 12q2.5 2 5 0t5 0 5 0 5 0" }], ["path", { d: "M2 19q2.5 2 5 0t5 0 5 0 5 0" }], ["path", { d: "M2 5q2.5 2 5 0t5 0 5 0 5 0" }]]);
export const X = icon([["path", { d: "M18 6 6 18" }], ["path", { d: "m6 6 12 12" }]]);
