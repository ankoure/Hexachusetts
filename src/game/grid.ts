/** The statewide hex grid produced by pipeline/build_grid.py. */

export type StationMode = "rapid" | "rail" | "ferry";

export interface Station {
  name: string;
  mode: StationMode;
  lines: string[];
  color: string;
  lat: number;
  lon: number;
}

export interface TransitLine {
  name: string;
  mode: StationMode;
  color: string;
  /** Track geometry as [lon, lat] paths. */
  paths: [number, number][][];
}

export interface GridMeta {
  resolution: number;
  walkshedMeters: number;
  unitsSource: string;
  unitsSourceShort: string;
  built: string;
  greenfield: { rings: number; density: number };
}

export interface Grid {
  meta: GridMeta;
  towns: string[];
  stations: Station[];
  /** Outline of all stations' walksheds merged, as [lon, lat] rings. */
  walksheds: [number, number][][];
  lines: TransitLine[];
  /** Number of hexes; every per-hex array below is indexed by row 0..n-1. */
  n: number;
  h3: string[];
  /** Baseline housing units. */
  units: Float32Array;
  /** Land acres in the hex. */
  acres: Float32Array;
  town: Uint16Array;
  /** Nearest rapid transit station within the walkshed, or -1. */
  rt: Int16Array;
  /** Nearest commuter rail / ferry station within the walkshed, or -1. */
  cr: Int16Array;
  /** 1 if the hex's surroundings are rural / undeveloped today. */
  gf: Uint8Array;
  rowOf: Map<string, number>;
  /** Baseline units per town, indexed like `towns`. */
  townUnits: Float64Array;
  totalUnits: number;
}

interface GridFile {
  meta: GridMeta;
  towns: string[];
  stations: Station[];
  walksheds: [number, number][][];
  lines: TransitLine[];
  hexes: { h3: string[]; units: number[]; acres: number[]; town: number[]; rt: number[]; cr: number[]; gf: number[] };
}

export async function loadGrid(url = `${import.meta.env.BASE_URL}data/grid.json`): Promise<Grid> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load ${url} (${res.status}). Run \`npm run data\` first.`);
  const file: GridFile = await res.json();
  const h = file.hexes;
  const n = h.h3.length;
  const grid: Grid = {
    meta: file.meta,
    towns: file.towns,
    stations: file.stations,
    walksheds: file.walksheds ?? [],
    lines: file.lines ?? [],
    n,
    h3: h.h3,
    units: Float32Array.from(h.units),
    acres: Float32Array.from(h.acres),
    town: Uint16Array.from(h.town),
    rt: Int16Array.from(h.rt),
    cr: Int16Array.from(h.cr),
    gf: Uint8Array.from(h.gf),
    rowOf: new Map(h.h3.map((cell, i) => [cell, i])),
    townUnits: new Float64Array(file.towns.length),
    totalUnits: 0,
  };
  for (let i = 0; i < n; i++) {
    grid.townUnits[grid.town[i]] += grid.units[i];
    grid.totalUnits += grid.units[i];
  }
  return grid;
}

/** 0 = no station within the walkshed, 1 = commuter rail / ferry, 2 = rapid transit. */
export function transitTier(grid: Grid, row: number): 0 | 1 | 2 {
  if (grid.rt[row] >= 0) return 2;
  if (grid.cr[row] >= 0) return 1;
  return 0;
}
