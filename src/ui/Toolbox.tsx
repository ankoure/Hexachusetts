import type React from "react";
import { MAX_BRUSH, useGame, type Tool } from "../game/store";
import { ZONES } from "../game/zones";
import { zoneSwatch } from "../map/colors";
import { fmtDensity } from "./format";

const sameTool = (a: Tool, b: Tool) =>
  a.kind === b.kind && (a.kind !== "zone" || (b.kind === "zone" && a.zone === b.zone));

/** Hexes in an H3 disk of radius k. */
const diskSize = (k: number) => 1 + 3 * k * (k + 1);

export default function Toolbox() {
  const tool = useGame((s) => s.tool);
  const setTool = useGame((s) => s.setTool);
  const brushSize = useGame((s) => s.brushSize);
  const setBrushSize = useGame((s) => s.setBrushSize);
  const canUndo = useGame((s) => s.undoStack.length > 0);
  const canRedo = useGame((s) => s.redoStack.length > 0);
  const undo = useGame((s) => s.undo);
  const redo = useGame((s) => s.redo);

  const onlyAdd = useGame((s) => s.onlyAdd);
  const toggleOnlyAdd = useGame((s) => s.toggleOnlyAdd);

  const toolButton = (t: Tool, label: string, key: string, icon: React.ReactNode, help: string) => (
    <button
      className={`tool ${sameTool(tool, t) ? "active" : ""}`}
      onClick={() => setTool(t)}
      title={`${help} (${key})`}
      aria-pressed={sameTool(tool, t)}
    >
      {icon}
      <span className="tool-name">{label}</span>
    </button>
  );

  return (
    <aside className="panel toolbox" aria-label="Tools">
      <h2 className="panel-title">
        Zone <span className="muted">homes/acre</span>
      </h2>
      <div className="zones">
        {ZONES.map((z, i) => {
          const t: Tool = { kind: "zone", zone: z.id };
          const active = sameTool(tool, t);
          return (
            <button
              key={z.id}
              className={`zone ${active ? "active" : ""}`}
              onClick={() => setTool(t)}
              aria-pressed={active}
              title={`${z.name}: ${z.blurb} (${i + 1})`}
            >
              <span className="swatch" style={{ background: zoneSwatch(z.density) }} />
              <span className="zone-name">{z.name}</span>
              <span className="zone-density">{z.density === 0 ? "0" : fmtDensity(z.density)}</span>
            </button>
          );
        })}
      </div>

      <div className="tools">
        {toolButton({ kind: "erase" }, "Restore", "E", <RestoreIcon />, "Restore hexes to today")}
        {toolButton({ kind: "inspect" }, "Inspect", "I", <InspectIcon />, "Click a hex for details")}
        {toolButton({ kind: "pan" }, "Pan", "H", <PanIcon />, "Drag to move the map")}
      </div>

      <label className="brush">
        <span className="brush-label">
          Brush <span className="muted">{diskSize(brushSize)} hex{brushSize ? "es" : ""}</span>
        </span>
        <input
          type="range"
          min={0}
          max={MAX_BRUSH}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          aria-label="Brush size"
        />
      </label>

      <label className="check" title="When on, a zone never lowers a hex below the homes it has today">
        <input type="checkbox" checked={onlyAdd} onChange={toggleOnlyAdd} /> Only add homes
      </label>

      <div className="undo-row">
        <button className="btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button className="btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
      </div>
      <p className="hint">
        Drag to paint. Hold <kbd>Space</kbd> to pan. <kbd>1</kbd>–<kbd>7</kbd> zones, <kbd>[</kbd> <kbd>]</kbd>{" "}
        brush.
      </p>
    </aside>
  );
}

const iconProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function RestoreIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 8a5 5 0 1 0 1.5-3.5" />
      <path d="M3 2.5V5h2.5" />
    </svg>
  );
}

function InspectIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6" />
      <circle cx="8" cy="5" r="0.4" fill="currentColor" />
    </svg>
  );
}

function PanIcon() {
  return (
    <svg {...iconProps}>
      <path d="M8 1.5v13M1.5 8h13M8 1.5 6.3 3.2M8 1.5l1.7 1.7M8 14.5l-1.7-1.7M8 14.5l1.7-1.7M1.5 8l1.7-1.7M1.5 8l1.7 1.7M14.5 8l-1.7-1.7M14.5 8l-1.7 1.7" />
    </svg>
  );
}
