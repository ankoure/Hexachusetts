import { cellToLatLng } from "h3-js";
import { useMemo, useState } from "react";
import { transitTier, type Grid } from "../game/grid";
import { getScenario } from "../game/scenarios";
import { computeStats, hexUnits, isGreenfield, type Stats } from "../game/stats";
import { useGame } from "../game/store";
import { ZONES } from "../game/zones";
import { stationLines } from "../map/GameMap";
import { distanceMiles, fmt, fmtCompact, fmtDensity, fmtPct, fmtSigned, fmtSignedPct } from "./format";

export function useStats(grid: Grid): Stats {
  const edits = useGame((s) => s.edits);
  const version = useGame((s) => s.version);
  return useMemo(() => computeStats(grid, edits), [grid, edits, version]);
}

export default function Sidebar({ grid }: { grid: Grid }) {
  const stats = useStats(grid);
  const scenarioId = useGame((s) => s.scenarioId);
  const selected = useGame((s) => s.selected);
  const scenario = getScenario(scenarioId);
  const goals = scenario.goals(stats, grid);
  const allDone = goals.length > 0 && goals.every((g) => g.done);

  return (
    <aside className="panel sidebar" aria-label="Scenario and stats">
      <section className={`scenario ${allDone ? "won" : ""}`}>
        <h2 className="scenario-name">{scenario.name}</h2>
        <p className="scenario-blurb">{scenario.blurb}</p>
        {goals.map((g) => (
          <div key={g.label} className={`goal ${g.done ? "done" : ""}`}>
            <div className="goal-head">
              <span className="goal-check" aria-hidden>
                {g.done ? "✓" : ""}
              </span>
              <span className="goal-label">{g.label}</span>
            </div>
            <div
              className="bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(g.progress * 100)}
              aria-label={g.label}
            >
              <div className="bar-fill" style={{ width: `${g.progress * 100}%` }} />
            </div>
            <div className="goal-detail">{g.detail}</div>
          </div>
        ))}
        {allDone && <p className="won-banner">Scenario complete. Share your map!</p>}
      </section>

      {selected !== null && <Inspector grid={grid} row={selected} />}

      <section className="stats">
        <div className="hero">
          <div className="hero-label">Net new homes</div>
          <div className={`hero-value ${stats.net < 0 ? "down" : ""}`}>{fmtSigned(stats.net)}</div>
          <div className="hero-sub">
            ≈ {fmtSigned(stats.newResidents)} residents · {fmtSignedPct(stats.net / grid.totalUnits)} statewide
          </div>
        </div>
        <dl className="tiles">
          <Tile label="Homes added" value={fmt(stats.added)} />
          <Tile label="Homes removed" value={fmt(stats.removed)} />
          <Tile
            label="Added near transit"
            value={stats.transitShare === null ? "—" : fmtPct(stats.transitShare)}
            sub={
              stats.added > 0
                ? `${fmtCompact(stats.addedNearRapid)} rapid · ${fmtCompact(stats.addedNearRegional)} rail/ferry`
                : "within ½ mile of a station"
            }
          />
          <Tile
            label="Added in rural areas"
            value={stats.added > 0 ? fmtPct(stats.addedGreenfield / stats.added) : "—"}
            sub={`areas under ${grid.meta.greenfield.density} home/acre today`}
          />
        </dl>
      </section>

      <Towns stats={stats} />

      <p className="source">
        Baseline homes: {grid.meta.unitsSource}. Stations: MBTA GTFS. Hexes: H3 res {grid.meta.resolution} (~26
        acres).
      </p>
    </aside>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <dt>{label}</dt>
      <dd>
        <span className="tile-value">{value}</span>
        {sub && <span className="tile-sub">{sub}</span>}
      </dd>
    </div>
  );
}

function Towns({ stats }: { stats: Stats }) {
  const [showAll, setShowAll] = useState(false);
  const towns = [...stats.towns.values()]
    .filter((t) => Math.round(t.net) !== 0)
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  if (towns.length === 0) return null;
  const shown = showAll ? towns : towns.slice(0, 8);
  const maxAbs = Math.max(...towns.map((t) => Math.abs(t.net)));

  return (
    <section className="towns">
      <h3 className="section-title">
        By municipality <span className="muted">{towns.length}</span>
      </h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Town</th>
            <th scope="col" className="num">
              Homes
            </th>
            <th scope="col" className="num">
              Growth
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.map((t) => (
            <tr key={t.town}>
              <td>
                <span className="town-name">{t.name}</span>
                <span
                  className={`town-bar ${t.net < 0 ? "down" : ""}`}
                  style={{ width: `${(Math.abs(t.net) / maxAbs) * 100}%` }}
                />
              </td>
              <td className="num">{fmtSigned(t.net)}</td>
              <td className="num">{fmtSignedPct(t.growth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {towns.length > 8 && (
        <button className="link" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${towns.length}`}
        </button>
      )}
    </section>
  );
}

function Inspector({ grid, row }: { grid: Grid; row: number }) {
  const edits = useGame((s) => s.edits);
  useGame((s) => s.version);
  const select = useGame((s) => s.select);
  const zone = edits.get(row);
  const acres = grid.acres[row];
  const base = grid.units[row];
  const now = hexUnits(grid, edits, row);
  const tier = transitTier(grid, row);
  const station = tier === 2 ? grid.stations[grid.rt[row]] : tier === 1 ? grid.stations[grid.cr[row]] : null;
  const [lat, lon] = cellToLatLng(grid.h3[row]);

  return (
    <section className="inspector">
      <div className="inspector-head">
        <h3 className="section-title">{grid.towns[grid.town[row]]}</h3>
        <button className="icon-btn" onClick={() => select(null)} aria-label="Close inspector">
          ×
        </button>
      </div>
      <dl className="kv">
        <dt>Land</dt>
        <dd>{acres.toFixed(1)} acres</dd>
        <dt>Homes today</dt>
        <dd>
          {fmt(base)} <span className="muted">({fmtDensity(acres ? base / acres : 0)}/acre)</span>
        </dd>
        {zone !== undefined && (
          <>
            <dt>Zoned</dt>
            <dd>{ZONES[zone].name}</dd>
            <dt>Homes planned</dt>
            <dd>
              {fmt(now)} <span className={now >= base ? "up" : "down"}>({fmtSigned(now - base)})</span>
            </dd>
          </>
        )}
        <dt>Transit</dt>
        <dd>
          {station
            ? `${distanceMiles(lat, lon, station.lat, station.lon).toFixed(2)} mi to ${station.name} (${stationLines(station)})`
            : "No station within ½ mile"}
        </dd>
        <dt>Area</dt>
        <dd>{isGreenfield(grid, row) ? "Rural / undeveloped" : "Built-up"}</dd>
      </dl>
    </section>
  );
}
