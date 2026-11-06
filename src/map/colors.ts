/**
 * Map color scales. Density is one sequential blue ramp, light -> dark.
 * Change is diverging: blue for homes added, red for homes removed, gray for
 * painted hexes whose count didn't move.
 */

export type RGBA = [number, number, number, number];

const hex = (h: string, a = 255): RGBA => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
  a,
];

export interface Step {
  /** Lower bound (inclusive). */
  min: number;
  color: string;
  label: string;
}

/** Homes per acre. */
export const DENSITY_STEPS: Step[] = [
  { min: 0.05, color: "#cde2fb", label: "<½" },
  { min: 0.5, color: "#9ec5f4", label: "½" },
  { min: 2, color: "#6da7ec", label: "2" },
  { min: 5, color: "#3987e5", label: "5" },
  { min: 10, color: "#256abf", label: "10" },
  { min: 20, color: "#184f95", label: "20" },
  { min: 40, color: "#104281", label: "40" },
  { min: 80, color: "#0a2a55", label: "80+" },
];

/** Homes gained (positive) or lost (negative) per hex. */
export const CHANGE_STEPS: Step[] = [
  { min: -Infinity, color: "#b42f2f", label: "−1k" },
  { min: -1000, color: "#e34948", label: "−250" },
  { min: -250, color: "#f2a3a2", label: "<0" },
  { min: -0.5, color: "#c3c2b7", label: "0" },
  { min: 0.5, color: "#9ec5f4", label: ">0" },
  { min: 250, color: "#3987e5", label: "+250" },
  { min: 1000, color: "#184f95", label: "+1k" },
];

export const OPEN_SPACE_COLOR = "#1e9e5a";

const densityRGBA = DENSITY_STEPS.map((s) => hex(s.color));
const changeRGBA = CHANGE_STEPS.map((s) => hex(s.color));
const openSpaceRGBA = hex(OPEN_SPACE_COLOR);

function stepIndex(steps: Step[], v: number): number {
  let i = -1;
  while (i + 1 < steps.length && v >= steps[i + 1].min) i++;
  return i;
}

/**
 * The color functions below write into `out` (deck.gl's per-row `target`) so
 * recoloring ~200k hexes doesn't allocate ~200k arrays.
 */
export function setRGBA(out: number[], r: number, g: number, b: number, a: number): RGBA {
  out[0] = r;
  out[1] = g;
  out[2] = b;
  out[3] = a;
  return out as RGBA;
}

export function densityColor(density: number, opacity: number, out: number[]): RGBA {
  const i = stepIndex(DENSITY_STEPS, density);
  if (i < 0) return setRGBA(out, 0, 0, 0, 0);
  const c = densityRGBA[i];
  return setRGBA(out, c[0], c[1], c[2], opacity * 255);
}

export function openSpaceColor(opacity: number, out: number[]): RGBA {
  const c = openSpaceRGBA;
  return setRGBA(out, c[0], c[1], c[2], opacity * 170);
}

export function changeColor(delta: number, opacity: number, out: number[]): RGBA {
  const c = changeRGBA[stepIndex(CHANGE_STEPS, delta)];
  return setRGBA(out, c[0], c[1], c[2], opacity * 255);
}

/** Swatch for a zone in the toolbar: the color a hex painted with it will show. */
export function zoneSwatch(density: number): string {
  if (density === 0) return OPEN_SPACE_COLOR;
  const i = stepIndex(DENSITY_STEPS, density);
  return DENSITY_STEPS[Math.max(0, i)].color;
}
