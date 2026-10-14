// How the screen changes when Live mode turns on or off. Each style is a view transition; its
// CSS lives under "Switching in and out of Live mode" in styles.css, keyed on html[data-vt-style].
//
// - pulse (the one in use): Live opens as a circle out of the Live button behind a glowing ring,
//   its chart draws in up to now, and leaving folds the screen back into the button.
// - morph (kept for later, not wired to anything): Overview's Cost or Tokens number grows into
//   Live's big number while the rest of Live rises in block by block.

export type LiveSwitch = "pulse" | "morph";

type Point = { x: number; y: number };

// The top bar glides on the same timing (styles.css), so the wave stays centered on the Live
// button while the button moves to its place on the other screen.
const PULSE_EASING = "cubic-bezier(0.65, 0, 0.35, 1)";
const PULSE_OPEN = { duration: 720, easing: PULSE_EASING };
const PULSE_CLOSE = { duration: 520, easing: PULSE_EASING };
// How far the ring's soft band trails its bright edge, in pixels.
const HAZE_LAG = 18;

let introTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Runs `apply`, which swaps the screens, inside a view transition in the given style, and
 * resolves once the switch is over. Reduced motion and browsers without view transitions just
 * swap. `lead` is what Live's big number shows, so Morph can pick the matching dashboard number.
 */
export async function playLiveSwitch(toLive: boolean, apply: () => void, lead: string, style: LiveSwitch = "pulse"): Promise<void> {
  const root = document.documentElement;
  if (typeof document.startViewTransition !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    apply();
    return;
  }
  root.dataset.vt = toLive ? "to-live" : "from-live";
  root.dataset.vtStyle = style;
  root.dataset.vtLead = lead;
  const wave = { from: style === "pulse" ? toggleCenter() : null, to: null as Point | null, ring: null as SVGSVGElement | null };
  let updated = false;
  const update = () => {
    if (updated) return;
    updated = true;
    apply();
    if (toLive && style === "pulse") drawCharts();
    if (wave.from) {
      wave.to = toggleCenter();
      wave.ring = addRing();
    }
  };

  const transition = document.startViewTransition(update);
  // A transition only starts on a painted frame. If the browser isn't painting (a throttled or
  // covered window), switch anyway rather than leave the click hanging.
  const stalled = setTimeout(() => {
    if (updated) return;
    updated = true;
    transition.skipTransition();
    apply();
  }, 1000);
  transition.ready
    .then(() => {
      if (wave.from && wave.to && wave.ring) runWave(wave.from, wave.to, wave.ring, toLive);
    })
    .catch(() => {});
  await Promise.race([transition.finished.catch(() => {}), new Promise((done) => setTimeout(done, 3000))]);
  clearTimeout(stalled);
  update();
  wave.ring?.remove();
  delete root.dataset.vt;
  delete root.dataset.vtStyle;
  delete root.dataset.vtLead;
  if (style === "pulse" && !toLive) landOnToggle();
}

function toggleCenter(): Point | null {
  const box = document.querySelector(".live-toggle")?.getBoundingClientRect();
  return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
}

/** Live's chart and tape draw in from the left, up to now; styles.css animates while this is set. */
function drawCharts() {
  const root = document.documentElement;
  root.dataset.lmIntro = "";
  clearTimeout(introTimer);
  introTimer = setTimeout(() => delete root.dataset.lmIntro, 1800);
}

/**
 * The ring that rides the wave's edge. It only exists in the new state and has its own
 * view-transition name, so it draws above both screens; a view transition shows a new-state
 * element live, so animating it here moves it on screen.
 */
function addRing(): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.classList.add("vt-ring");
  svg.setAttribute("aria-hidden", "true");
  for (const part of ["vt-ring-haze", "vt-ring-edge"]) {
    const circle = document.createElementNS(ns, "circle");
    circle.classList.add(part);
    circle.setAttribute("r", "1");
    svg.append(circle);
  }
  document.body.append(svg);
  return svg;
}

/** Opens (or closes) the new screen as a circle around the Live button, with the ring on its edge. */
function runWave(from: Point, to: Point, ring: SVGSVGElement, toLive: boolean) {
  const root = document.documentElement;
  const timing = { ...(toLive ? PULSE_OPEN : PULSE_CLOSE), fill: "both" as const };
  // Far enough from the button to clear every corner, glow included.
  const reach = (p: Point) => Math.hypot(Math.max(p.x, window.innerWidth - p.x), Math.max(p.y, window.innerHeight - p.y)) + 60;
  const [start, end] = toLive ? [{ ...from, r: 0 }, { ...to, r: reach(to) }] : [{ ...from, r: reach(from) }, { ...to, r: 0 }];
  const circle = (s: typeof start) => `circle(${s.r}px at ${s.x}px ${s.y}px)`;
  const place = (s: typeof start, lag = 0) => `translate(${s.x}px, ${s.y}px) scale(${Math.max(0.001, s.r - lag)})`;

  root.animate(
    { clipPath: [circle(start), circle(end)] },
    { ...timing, pseudoElement: toLive ? "::view-transition-new(root)" : "::view-transition-old(root)" },
  );
  const [haze, edge] = Array.from(ring.querySelectorAll("circle"));
  edge?.animate({ transform: [place(start), place(end)] }, timing);
  // The haze trails behind the edge: inside it while the wave opens, outside while it closes.
  haze?.animate({ transform: toLive ? [place(start), place(end, HAZE_LAG)] : [place(start, -HAZE_LAG), place(end)] }, timing);
  ring.animate(
    toLive
      ? [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.72 }, { opacity: 0 }]
      : [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1, offset: 0.86 }, { opacity: 0 }],
    timing,
  );
}

/** A last ripple off the Live button once the screen has folded back into it. */
function landOnToggle() {
  document.querySelector(".live-toggle")?.animate(
    [
      { boxShadow: "0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent)" },
      { boxShadow: "0 0 0 12px color-mix(in srgb, var(--accent) 0%, transparent)" },
    ],
    { duration: 620, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  );
}
