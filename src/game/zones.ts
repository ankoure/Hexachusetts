/**
 * The "zones" a player paints. Each sets a hex to a target gross density:
 * homes per acre of land across the whole hex, streets and all. For scale, the
 * densest hexes in the state today (Back Bay, the West End) are ~60–90.
 */
export interface Zone {
  id: number;
  name: string;
  /** Target gross density, homes per acre. */
  density: number;
  blurb: string;
}

export const ZONES: Zone[] = [
  { id: 0, name: "Open space", density: 0, blurb: "Parks, conservation land, farms" },
  { id: 1, name: "Rural", density: 0.5, blurb: "Homes on 2+ acre lots" },
  { id: 2, name: "Suburban", density: 3, blurb: "Single-family homes on ¼-acre lots" },
  { id: 3, name: "Streetcar suburb", density: 10, blurb: "Small-lot singles and two-families" },
  { id: 4, name: "Triple-decker", density: 25, blurb: "Triple-deckers, rowhouses, small apartments" },
  { id: 5, name: "Mid-rise", density: 50, blurb: "4–6 story apartment blocks" },
  { id: 6, name: "High-rise", density: 100, blurb: "Towers, downtown" },
];

/** Housing units a hex holds when painted with `zone`. */
export function zoneUnits(zone: number, acres: number): number {
  return Math.round(ZONES[zone].density * acres);
}

/** Rough people per home (Massachusetts' average household is ~2.4). */
export const PEOPLE_PER_HOME = 2.4;
