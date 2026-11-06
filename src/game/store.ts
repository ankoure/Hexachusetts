import { create } from "zustand";
import type { Grid } from "./grid";
import { addsHomes } from "./stats";

export type Tool =
  | { kind: "zone"; zone: number }
  | { kind: "erase" }
  | { kind: "inspect" }
  | { kind: "pan" };

export type View = "density" | "change";

/** row -> zone painted before the change (undefined = unpainted). */
type Diff = Map<number, number | undefined>;

export const MAX_BRUSH = 5;

interface GameState {
  grid: Grid | null;
  /** row -> painted zone id. Mutated in place; `version` bumps on every change. */
  edits: Map<number, number>;
  version: number;
  undoStack: Diff[];
  redoStack: Diff[];
  stroke: Diff | null;

  tool: Tool;
  brushSize: number;
  /** Skip hexes a zone would make less dense than today. */
  onlyAdd: boolean;
  scenarioId: string;
  mapName: string;
  view: View;
  extruded: boolean;
  showStations: boolean;
  showLines: boolean;
  selected: number | null;

  setGrid(grid: Grid): void;
  setTool(tool: Tool): void;
  setBrushSize(size: number): void;
  toggleOnlyAdd(): void;
  setScenario(id: string): void;
  setMapName(name: string): void;
  setView(view: View): void;
  toggleExtruded(): void;
  toggleStations(): void;
  toggleLines(): void;
  select(row: number | null): void;

  beginStroke(): void;
  paint(rows: Iterable<number>): void;
  endStroke(): void;
  undo(): void;
  redo(): void;
  reset(): void;
  /** Replace the whole map. With `undoable`, one undo restores the previous map. */
  load(edits: Map<number, number>, opts?: { scenarioId?: string; mapName?: string; undoable?: boolean }): void;
}

function applyDiff(edits: Map<number, number>, diff: Diff): Diff {
  const inverse: Diff = new Map();
  for (const [row, zone] of diff) {
    inverse.set(row, edits.get(row));
    if (zone === undefined) edits.delete(row);
    else edits.set(row, zone);
  }
  return inverse;
}

export const useGame = create<GameState>((set, get) => ({
  grid: null,
  edits: new Map(),
  version: 0,
  undoStack: [],
  redoStack: [],
  stroke: null,

  tool: { kind: "zone", zone: 4 },
  brushSize: 1,
  onlyAdd: true,
  scenarioId: "home-for-everyone",
  mapName: "",
  view: "density",
  extruded: false,
  showStations: true,
  showLines: true,
  selected: null,

  setGrid: (grid) => set({ grid }),
  setTool: (tool) => set({ tool }),
  setBrushSize: (size) => set({ brushSize: Math.max(0, Math.min(MAX_BRUSH, size)) }),
  toggleOnlyAdd: () => set((s) => ({ onlyAdd: !s.onlyAdd })),
  setScenario: (scenarioId) => set({ scenarioId }),
  setMapName: (mapName) => set({ mapName }),
  setView: (view) => set({ view }),
  toggleExtruded: () => set((s) => ({ extruded: !s.extruded })),
  toggleStations: () => set((s) => ({ showStations: !s.showStations })),
  toggleLines: () => set((s) => ({ showLines: !s.showLines })),
  select: (selected) => set({ selected }),

  beginStroke: () => set({ stroke: new Map() }),

  paint: (rows) => {
    const { tool, edits, stroke, grid, onlyAdd } = get();
    if (!grid || (tool.kind !== "zone" && tool.kind !== "erase")) return;
    const target = tool.kind === "zone" ? tool.zone : undefined;
    let changed = false;
    for (const row of rows) {
      if (target !== undefined && onlyAdd && !addsHomes(grid, row, target)) continue;
      const prev = edits.get(row);
      if (prev === target) continue;
      if (stroke && !stroke.has(row)) stroke.set(row, prev);
      if (target === undefined) edits.delete(row);
      else edits.set(row, target);
      changed = true;
    }
    if (changed) set((s) => ({ version: s.version + 1 }));
  },

  endStroke: () => {
    const { stroke } = get();
    if (!stroke) return;
    if (stroke.size === 0) set({ stroke: null });
    else set((s) => ({ stroke: null, undoStack: [...s.undoStack, stroke], redoStack: [] }));
  },

  undo: () => {
    const { undoStack, edits } = get();
    const diff = undoStack.at(-1);
    if (!diff) return;
    const inverse = applyDiff(edits, diff);
    set((s) => ({
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, inverse],
      version: s.version + 1,
    }));
  },

  redo: () => {
    const { redoStack, edits } = get();
    const diff = redoStack.at(-1);
    if (!diff) return;
    const inverse = applyDiff(edits, diff);
    set((s) => ({
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, inverse],
      version: s.version + 1,
    }));
  },

  reset: () => {
    const { edits } = get();
    if (edits.size === 0) return;
    const diff: Diff = new Map([...edits.keys()].map((row) => [row, undefined]));
    const inverse = applyDiff(edits, diff);
    set((s) => ({ undoStack: [...s.undoStack, inverse], redoStack: [], version: s.version + 1 }));
  },

  load: (next, opts = {}) => {
    const { edits } = get();
    const diff: Diff = new Map();
    for (const row of edits.keys()) if (!next.has(row)) diff.set(row, undefined);
    for (const [row, zone] of next) if (edits.get(row) !== zone) diff.set(row, zone);
    const inverse = applyDiff(edits, diff);
    set((s) => ({
      undoStack: opts.undoable ? [...s.undoStack, inverse] : [],
      redoStack: [],
      version: s.version + 1,
      scenarioId: opts.scenarioId ?? s.scenarioId,
      mapName: opts.mapName ?? s.mapName,
      selected: null,
    }));
  },
}));
