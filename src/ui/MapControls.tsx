import { useGame } from "../game/store";
import { CHANGE_STEPS, DENSITY_STEPS, OPEN_SPACE_COLOR } from "../map/colors";

export default function MapControls() {
  const view = useGame((s) => s.view);
  const setView = useGame((s) => s.setView);
  const extruded = useGame((s) => s.extruded);
  const toggleExtruded = useGame((s) => s.toggleExtruded);
  const showStations = useGame((s) => s.showStations);
  const toggleStations = useGame((s) => s.toggleStations);
  const showLines = useGame((s) => s.showLines);
  const toggleLines = useGame((s) => s.toggleLines);

  return (
    <div className="panel map-controls">
      <div className="segmented" role="radiogroup" aria-label="Map view">
        {(["density", "change"] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={view === v}
            className={view === v ? "active" : ""}
            onClick={() => setView(v)}
            title={`${v === "density" ? "Density" : "Change"} view (V)`}
          >
            {v === "density" ? "Density" : "Change"}
          </button>
        ))}
      </div>

      {view === "density" ? (
        <div className="legend">
          <div className="legend-title">Homes per acre</div>
          <div className="legend-steps">
            {DENSITY_STEPS.map((s) => (
              <div key={s.label} className="legend-step">
                <span className="legend-chip" style={{ background: s.color }} />
                <span className="legend-label">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="legend-extra">
            <span className="legend-chip" style={{ background: OPEN_SPACE_COLOR }} /> Open space (painted)
          </div>
        </div>
      ) : (
        <div className="legend">
          <div className="legend-title">Homes gained or lost per hex</div>
          <div className="legend-steps">
            {CHANGE_STEPS.map((s) => (
              <div key={s.label} className="legend-step">
                <span className="legend-chip" style={{ background: s.color }} />
                <span className="legend-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="toggles">
        <label title="Extrude hexes by density (B)">
          <input type="checkbox" checked={extruded} onChange={toggleExtruded} /> 3D
        </label>
        <label title="Stations and ½-mile walksheds (S)">
          <input type="checkbox" checked={showStations} onChange={toggleStations} /> Stations
        </label>
        <label title="Rapid transit, commuter rail and ferry lines (L)">
          <input type="checkbox" checked={showLines} onChange={toggleLines} /> Lines
        </label>
      </div>
    </div>
  );
}
