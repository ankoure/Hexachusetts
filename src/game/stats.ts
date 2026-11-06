import { transitTier, type Grid } from "./grid";
import { PEOPLE_PER_HOME, zoneUnits } from "./zones";

export interface TownChange {
  town: number;
  name: string;
  baseline: number;
  net: number;
  /** net / baseline */
  growth: number;
}

export interface Stats {
  hexesPainted: number;
  /** Sum of positive per-hex changes. */
  added: number;
  /** Sum of negative per-hex changes, as a positive number. */
  removed: number;
  net: number;
  newResidents: number;
  /** Homes added (gross) within the walkshed of rapid transit. */
  addedNearRapid: number;
  /** Homes added (gross) within the walkshed of commuter rail / ferry only. */
  addedNearRegional: number;
  /** Share of gross additions within the walkshed of any station; null if nothing added. */
  transitShare: number | null;
  /** Homes added in areas that are rural / undeveloped today. */
  addedGreenfield: number;
  total: number;
  towns: Map<number, TownChange>;
}

/** Units in a hex after edits. */
export function hexUnits(grid: Grid, edits: Map<number, number>, row: number): number {
  const zone = edits.get(row);
  return zone === undefined ? grid.units[row] : zoneUnits(zone, grid.acres[row]);
}

export function isGreenfield(grid: Grid, row: number): boolean {
  return grid.gf[row] === 1;
}

export function computeStats(grid: Grid, edits: Map<number, number>): Stats {
  let added = 0;
  let removed = 0;
  let addedNearRapid = 0;
  let addedNearRegional = 0;
  let addedGreenfield = 0;
  const towns = new Map<number, TownChange>();

  for (const [row, zone] of edits) {
    const delta = zoneUnits(zone, grid.acres[row]) - grid.units[row];
    if (delta > 0) {
      added += delta;
      const tier = transitTier(grid, row);
      if (tier === 2) addedNearRapid += delta;
      else if (tier === 1) addedNearRegional += delta;
      if (isGreenfield(grid, row)) addedGreenfield += delta;
    } else {
      removed -= delta;
    }
    const t = grid.town[row];
    let tc = towns.get(t);
    if (!tc) {
      tc = { town: t, name: grid.towns[t], baseline: grid.townUnits[t], net: 0, growth: 0 };
      towns.set(t, tc);
    }
    tc.net += delta;
  }
  for (const tc of towns.values()) tc.growth = tc.baseline > 0 ? tc.net / tc.baseline : 0;

  const net = added - removed;
  return {
    hexesPainted: edits.size,
    added,
    removed,
    net,
    newResidents: net * PEOPLE_PER_HOME,
    addedNearRapid,
    addedNearRegional,
    transitShare: added > 0 ? (addedNearRapid + addedNearRegional) / added : null,
    addedGreenfield,
    total: grid.totalUnits + net,
    towns,
  };
}

/** Whether painting `zone` on `row` is allowed when only adding homes. */
export function addsHomes(grid: Grid, row: number, zone: number): boolean {
  return zoneUnits(zone, grid.acres[row]) >= grid.units[row];
}

/** Change in units if `rows` were painted with `zone` (undefined = erase). */
export function previewDelta(
  grid: Grid,
  edits: Map<number, number>,
  rows: number[],
  zone: number | undefined,
  onlyAdd: boolean,
): { delta: number; skipped: number } {
  let delta = 0;
  let skipped = 0;
  for (const row of rows) {
    if (zone !== undefined && onlyAdd && !addsHomes(grid, row, zone)) {
      skipped++;
      continue;
    }
    const next = zone === undefined ? grid.units[row] : zoneUnits(zone, grid.acres[row]);
    delta += next - hexUnits(grid, edits, row);
  }
  return { delta, skipped };
}
