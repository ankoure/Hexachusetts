import { useCallback, useEffect, useRef, useState } from "react";
import { loadGrid, type Grid } from "./game/grid";
import { autosave, autosaved, decodeSaved, fromSaved, hashPayload, toSaved } from "./game/share";
import { useGame } from "./game/store";
import { ZONES } from "./game/zones";
import GameMap from "./map/GameMap";
import MapControls from "./ui/MapControls";
import Sidebar from "./ui/Sidebar";
import Toolbox from "./ui/Toolbox";
import TopBar from "./ui/TopBar";

/** Load + restore exactly once, even when StrictMode runs effects twice. */
let startup: Promise<void> | undefined;

export default function App() {
  const grid = useGame((s) => s.grid);
  const [error, setError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimer = useRef<number>(undefined);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 4000);
  }, []);

  useEffect(() => {
    startup ??= loadGrid().then(async (g) => {
      await restore(g, toast);
      useGame.getState().setGrid(g);
    });
    startup.catch((e: Error) => setError(e.message));
  }, [toast]);

  useShortcuts();
  useAutosave(grid);

  if (error) return <div className="splash error">{error}</div>;
  if (!grid) return <div className="splash">Loading Massachusetts…</div>;

  return (
    <div className="app">
      <GameMap grid={grid} />
      <TopBar grid={grid} toast={toast} />
      <Toolbox />
      <Sidebar grid={grid} />
      <MapControls />
      {toastMsg && (
        <div className="toast" role="status">
          {toastMsg}
        </div>
      )}
    </div>
  );
}

/** Load the last autosave, then a shared map from the URL on top of it (so Undo returns to your own). */
async function restore(grid: Grid, toast: (msg: string) => void) {
  const { load } = useGame.getState();
  const own = autosaved();
  if (own) {
    try {
      const s = await decodeSaved(own);
      load(fromSaved(grid, s).edits, { scenarioId: s.scenarioId, mapName: s.name });
    } catch {
      // A stale or corrupt autosave isn't worth surfacing.
    }
  }
  const shared = hashPayload();
  if (!shared) return;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    const s = await decodeSaved(shared);
    load(fromSaved(grid, s).edits, { scenarioId: s.scenarioId, mapName: s.name, undoable: Boolean(own) });
    toast(`Opened shared map${s.name ? ` “${s.name}”` : ""}${own ? ". Undo to return to yours." : ""}`);
  } catch {
    toast("That share link looks broken.");
  }
}

function useAutosave(grid: Grid | null) {
  const version = useGame((s) => s.version);
  const scenarioId = useGame((s) => s.scenarioId);
  const mapName = useGame((s) => s.mapName);
  useEffect(() => {
    if (!grid) return;
    const t = window.setTimeout(() => {
      autosave(toSaved(grid, useGame.getState().edits, scenarioId, mapName));
    }, 800);
    return () => window.clearTimeout(t);
  }, [grid, version, scenarioId, mapName]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const s = useGame.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      if (mod || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= ZONES.length) return s.setTool({ kind: "zone", zone: n - 1 });
      switch (e.key.toLowerCase()) {
        case "p":
          return s.setTool({ kind: "zone", zone: s.lastZone });
        case "e":
          return s.setTool({ kind: "erase" });
        case "i":
          return s.setTool({ kind: "inspect" });
        case "h":
          return s.setTool({ kind: "pan" });
        case "[":
          return s.setBrushSize(s.brushSize - 1);
        case "]":
          return s.setBrushSize(s.brushSize + 1);
        case "v":
          return s.setView(s.view === "density" ? "change" : "density");
        case "b":
          return s.toggleExtruded();
        case "s":
          return s.toggleStations();
        case "l":
          return s.toggleLines();
        case "escape":
          return s.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
