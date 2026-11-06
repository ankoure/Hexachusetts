export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export const fmtSigned = (n: number) => {
  const r = Math.round(n);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toLocaleString("en-US")}`;
};

export const fmtPct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

export const fmtSignedPct = (n: number) => {
  const p = n * 100;
  const digits = Math.abs(p) < 10 ? 1 : 0;
  return `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p).toFixed(digits)}%`;
};

/** Compact count for tight spaces: 1.2k, 222k, 1.4M. */
export const fmtCompact = (n: number) =>
  Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Math.round(n));

export const fmtDensity = (d: number) => (d >= 10 ? d.toFixed(0) : d >= 1 ? d.toFixed(1) : d.toFixed(2));

export function distanceMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}
