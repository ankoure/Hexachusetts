import { useRef } from "react";
import type { Grid } from "../game/grid";
import { SCENARIOS } from "../game/scenarios";
import { downloadSaved, fromSaved, readSavedFile, shareUrl, toSaved } from "../game/share";
import { useGame } from "../game/store";

export default function TopBar({ grid, toast }: { grid: Grid; toast: (msg: string) => void }) {
  const mapName = useGame((s) => s.mapName);
  const setMapName = useGame((s) => s.setMapName);
  const scenarioId = useGame((s) => s.scenarioId);
  const setScenario = useGame((s) => s.setScenario);
  const hasEdits = useGame((s) => s.edits.size > 0);
  useGame((s) => s.version);
  const fileInput = useRef<HTMLInputElement>(null);

  const saved = () => {
    const s = useGame.getState();
    return toSaved(grid, s.edits, s.scenarioId, s.mapName);
  };

  const share = async () => {
    const url = await shareUrl(saved());
    try {
      await navigator.clipboard.writeText(url);
      toast(url.length > 8000 ? "Link copied (it's long; Save a file for big maps)" : "Link copied");
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  const open = async (file: File) => {
    try {
      const s = await readSavedFile(file);
      const { edits, skipped } = fromSaved(grid, s);
      useGame.getState().load(edits, { scenarioId: s.scenarioId, mapName: s.name, undoable: true });
      toast(`Opened ${s.name || file.name}${skipped ? ` (${skipped} hexes off the map skipped)` : ""}`);
    } catch (e) {
      toast(`Couldn't open ${file.name}: ${(e as Error).message}`);
    }
  };

  const reset = () => {
    useGame.getState().reset();
    toast("Map cleared. Undo to bring it back.");
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden>
          ⬢
        </span>
        <h1>Hexachusetts</h1>
      </div>
      <input
        className="map-name"
        value={mapName}
        onChange={(e) => setMapName(e.target.value)}
        placeholder="Name your plan"
        aria-label="Plan name"
        maxLength={80}
      />
      <label className="scenario-select">
        <span className="visually-hidden">Scenario</span>
        <select value={scenarioId} onChange={(e) => setScenario(e.target.value)}>
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="actions">
        <button className="btn primary" onClick={share} disabled={!hasEdits}>
          Share link
        </button>
        <button className="btn" onClick={() => downloadSaved(saved())} disabled={!hasEdits}>
          Save
        </button>
        <button className="btn" onClick={() => fileInput.current?.click()}>
          Open
        </button>
        <button className="btn" onClick={reset} disabled={!hasEdits}>
          Clear
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) open(f);
            e.target.value = "";
          }}
        />
      </div>
    </header>
  );
}
