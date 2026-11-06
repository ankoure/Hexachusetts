/**
 * Saving and sharing maps.
 *
 * A map is the set of painted hexes per zone. Each zone's cells are H3-compacted
 * (a fully painted parent replaces its 7 children, recursively), so big painted
 * blobs stay small. URLs carry a binary form: sorted cells, delta + varint
 * encoded, deflated, base64url. Files carry the same thing as readable JSON.
 */

import { compactCells, uncompactCells } from "h3-js";
import type { Grid } from "./grid";
import { SCENARIOS } from "./scenarios";
import { ZONES } from "./zones";

export interface SavedMap {
  name: string;
  scenarioId: string;
  /** zone id -> compacted H3 cells */
  zones: Record<number, string[]>;
}

export function toSaved(grid: Grid, edits: Map<number, number>, scenarioId: string, name: string): SavedMap {
  const byZone = new Map<number, string[]>();
  for (const [row, zone] of edits) {
    let cells = byZone.get(zone);
    if (!cells) byZone.set(zone, (cells = []));
    cells.push(grid.h3[row]);
  }
  const zones: Record<number, string[]> = {};
  for (const [zone, cells] of byZone) zones[zone] = compactCells(cells).sort();
  return { name, scenarioId, zones };
}

export function fromSaved(grid: Grid, saved: SavedMap): { edits: Map<number, number>; skipped: number } {
  const edits = new Map<number, number>();
  let skipped = 0;
  for (const [zoneKey, cells] of Object.entries(saved.zones)) {
    const zone = Number(zoneKey);
    if (!ZONES[zone]) continue;
    for (const cell of uncompactCells(cells, grid.meta.resolution)) {
      const row = grid.rowOf.get(cell);
      // Compaction can pull in water cells that aren't in the grid; that's expected.
      if (row === undefined) skipped++;
      else edits.set(row, zone);
    }
  }
  return { edits, skipped };
}

// --- binary URL form ---

const FORMAT_VERSION = 1;

class Writer {
  bytes: number[] = [];
  u8(n: number) {
    this.bytes.push(n & 0xff);
  }
  varint(n: bigint) {
    do {
      let b = Number(n & 0x7fn);
      n >>= 7n;
      if (n > 0n) b |= 0x80;
      this.bytes.push(b);
    } while (n > 0n);
  }
  string(s: string) {
    const b = new TextEncoder().encode(s);
    this.varint(BigInt(b.length));
    for (const x of b) this.bytes.push(x);
  }
}

class Reader {
  i = 0;
  constructor(private b: Uint8Array) {}
  u8() {
    if (this.i >= this.b.length) throw new Error("truncated");
    return this.b[this.i++];
  }
  varint(): bigint {
    let n = 0n;
    let shift = 0n;
    for (;;) {
      const b = this.u8();
      n |= BigInt(b & 0x7f) << shift;
      if (!(b & 0x80)) return n;
      shift += 7n;
    }
  }
  string() {
    const len = Number(this.varint());
    const s = new TextDecoder().decode(this.b.subarray(this.i, this.i + len));
    this.i += len;
    return s;
  }
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const fromBase64Url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function encodeSaved(saved: SavedMap): Promise<string> {
  const w = new Writer();
  w.u8(FORMAT_VERSION);
  w.u8(Math.max(0, SCENARIOS.findIndex((s) => s.id === saved.scenarioId)));
  w.string(saved.name);
  const zones = Object.entries(saved.zones);
  w.u8(zones.length);
  for (const [zone, cells] of zones) {
    w.u8(Number(zone));
    w.varint(BigInt(cells.length));
    const ids = cells.map((c) => BigInt(`0x${c}`)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    let prev = 0n;
    for (const id of ids) {
      w.varint(id - prev);
      prev = id;
    }
  }
  const packed = await pipe(Uint8Array.from(w.bytes), new CompressionStream("deflate-raw"));
  return toBase64Url(packed);
}

export async function decodeSaved(encoded: string): Promise<SavedMap> {
  const r = new Reader(await pipe(fromBase64Url(encoded), new DecompressionStream("deflate-raw")));
  const version = r.u8();
  if (version !== FORMAT_VERSION) throw new Error(`Unknown map format v${version}`);
  const scenarioId = SCENARIOS[r.u8()]?.id ?? SCENARIOS[0].id;
  const name = r.string();
  const zones: Record<number, string[]> = {};
  const nZones = r.u8();
  for (let z = 0; z < nZones; z++) {
    const zone = r.u8();
    const count = Number(r.varint());
    const cells: string[] = [];
    let prev = 0n;
    for (let i = 0; i < count; i++) {
      prev += r.varint();
      cells.push(prev.toString(16));
    }
    zones[zone] = cells;
  }
  return { name, scenarioId, zones };
}

// --- URL hash & local autosave ---

const HASH_KEY = "map=";
const AUTOSAVE_KEY = "hexachusetts:autosave";
/** Key used before the rename from SimMass; moved to AUTOSAVE_KEY on first read. */
const LEGACY_AUTOSAVE_KEY = "simmass:autosave";

export async function shareUrl(saved: SavedMap): Promise<string> {
  const url = new URL(window.location.href);
  url.hash = HASH_KEY + (await encodeSaved(saved));
  return url.toString();
}

export function hashPayload(): string | null {
  const h = window.location.hash.slice(1);
  return h.startsWith(HASH_KEY) ? h.slice(HASH_KEY.length) : null;
}

export async function autosave(saved: SavedMap): Promise<void> {
  try {
    localStorage.setItem(AUTOSAVE_KEY, await encodeSaved(saved));
  } catch {
    // Storage can be unavailable (private mode, quota); autosave is best-effort.
  }
}

export function autosaved(): string | null {
  try {
    const current = localStorage.getItem(AUTOSAVE_KEY);
    if (current !== null) return current;
    const legacy = localStorage.getItem(LEGACY_AUTOSAVE_KEY);
    if (legacy !== null) {
      localStorage.setItem(AUTOSAVE_KEY, legacy);
      localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
    }
    return legacy;
  } catch {
    return null;
  }
}

export function downloadSaved(saved: SavedMap): void {
  const blob = new Blob([JSON.stringify({ hexachusetts: FORMAT_VERSION, ...saved }, null, 1)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(saved.name || "hexachusetts-map").replace(/[^\w-]+/g, "-").toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function readSavedFile(file: File): Promise<SavedMap> {
  const json = JSON.parse(await file.text());
  if (typeof json !== "object" || !json.zones) throw new Error("Not a Hexachusetts map file");
  return { name: json.name ?? "", scenarioId: json.scenarioId ?? SCENARIOS[0].id, zones: json.zones };
}
