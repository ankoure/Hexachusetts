import { H3HexagonLayer } from "@deck.gl/geo-layers";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { cellsToMultiPolygon, gridDisk, gridPathCells, latLngToCell } from "h3-js";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Grid, Station, TransitLine } from "../game/grid";
import { previewDelta } from "../game/stats";
import { useGame } from "../game/store";
import { ZONES, zoneUnits } from "../game/zones";
import { changeColor, densityColor, openSpaceColor, setRGBA, type RGBA } from "./colors";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
/** Below this zoom a hex is a few pixels wide; painting would be guesswork. */
export const MIN_PAINT_ZOOM = 10;
/** Painted-area outlines fade in between these zooms; zoomed out they'd bury the hexes. */
const OUTLINE_FADE_ZOOM: [number, number] = [10, 12];
/** Meters of extrusion per home/acre in 3D view. */
const ELEVATION_PER_DENSITY = 8;
const HEX_MATERIAL = { ambient: 0.55, diffuse: 0.55, shininess: 8 };
const ALWAYS_ON_TOP = { depthCompare: "always" } as const;

type Ring = [number, number][];

/** Outer boundaries (and holes) of a set of cells, as [lng, lat] rings. */
function outlineRings(cells: string[]): Ring[] {
  return cells.length ? (cellsToMultiPolygon(cells, true).flat() as Ring[]) : [];
}

function fade(zoom: number, [from, to]: [number, number]): number {
  return Math.max(0, Math.min(1, (zoom - from) / (to - from)));
}

interface LinePath {
  line: TransitLine;
  path: [number, number][];
}

const MODE_ORDER = { ferry: 0, rail: 1, rapid: 2 } as const;
const LINE_WIDTH = { ferry: 1.5, rail: 2, rapid: 3 } as const;

interface Hover {
  x: number;
  y: number;
  rows: number[];
}

const fmtDelta = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

export default function GameMap({ grid }: { grid: Grid }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const [labelLayer, setLabelLayer] = useState<string | undefined>();
  const [hover, setHover] = useState<Hover | null>(null);
  const [zoom, setZoom] = useState(11);
  const [panHeld, setPanHeld] = useState(false);

  const edits = useGame((s) => s.edits);
  const version = useGame((s) => s.version);
  const view = useGame((s) => s.view);
  const extruded = useGame((s) => s.extruded);
  const showStations = useGame((s) => s.showStations);
  const showLines = useGame((s) => s.showLines);
  const tool = useGame((s) => s.tool);
  const selected = useGame((s) => s.selected);

  const painting = (tool.kind === "zone" || tool.kind === "erase") && !panHeld;

  // --- map + overlay setup (once) ---
  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: STYLE_URL,
      center: [-71.08, 42.355],
      zoom: 11,
      minZoom: 7,
      maxZoom: 16,
      maxBounds: [
        [-74.5, 40.8],
        [-68.8, 43.6],
      ],
      dragRotate: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);
    map.on("style.load", () => {
      // Draw hexes under the basemap's labels.
      setLabelLayer(map.getStyle().layers.find((l) => l.type === "symbol")?.id);
    });
    // Track zoom continuously (not just on zoomend) so outlines fade smoothly.
    map.on("zoom", () => setZoom(map.getZoom()));
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  // --- tilt the camera with the 3D toggle ---
  useEffect(() => {
    mapRef.current?.easeTo({ pitch: extruded ? 50 : 0, duration: 600 });
  }, [extruded]);

  // --- hold space to pan while a brush is active ---
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => (e.target as HTMLElement).closest("input, textarea, select");
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e)) {
        e.preventDefault();
        setPanHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setPanHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (painting) map.dragPan.disable();
    else map.dragPan.enable();
    map.getCanvas().style.cursor = painting ? "crosshair" : tool.kind === "inspect" ? "pointer" : "";
  }, [painting, tool.kind]);

  // --- painting / inspecting ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let lastCell: string | null = null;
    let stroking = false;

    const footprint = (lngLat: maplibregl.LngLat, from: string | null): { cell: string; rows: number[] } => {
      const { brushSize } = useGame.getState();
      const cell = latLngToCell(lngLat.lat, lngLat.lng, grid.meta.resolution);
      // Fill in cells between pointer events so fast strokes don't leave gaps.
      let path = [cell];
      if (from && from !== cell) {
        try {
          path = gridPathCells(from, cell);
        } catch {
          // No path across a pentagon / too far apart; just paint the endpoint.
        }
      }
      const rows = new Set<number>();
      for (const c of path) {
        for (const d of gridDisk(c, brushSize)) {
          const row = grid.rowOf.get(d);
          if (row !== undefined) rows.add(row);
        }
      }
      return { cell, rows: [...rows] };
    };

    const canPaint = () => painting && map.getZoom() >= MIN_PAINT_ZOOM;

    const onDown = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if ("originalEvent" in e && e.originalEvent instanceof MouseEvent && e.originalEvent.button !== 0) return;
      if (e.type === "touchstart" && (e as maplibregl.MapTouchEvent).points.length !== 1) return;
      const { tool, select, beginStroke, paint } = useGame.getState();
      if (tool.kind === "inspect") {
        const row = grid.rowOf.get(latLngToCell(e.lngLat.lat, e.lngLat.lng, grid.meta.resolution));
        select(row ?? null);
        return;
      }
      if (!canPaint()) return;
      e.preventDefault();
      stroking = true;
      beginStroke();
      const { cell, rows } = footprint(e.lngLat, null);
      lastCell = cell;
      paint(rows);
    };

    const onMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (e.type === "touchmove" && (e as maplibregl.MapTouchEvent).points.length !== 1) {
        endStroke();
        return;
      }
      if (!painting) {
        setHover(null);
        return;
      }
      const { cell, rows } = footprint(e.lngLat, stroking ? lastCell : null);
      if (stroking) {
        lastCell = cell;
        useGame.getState().paint(rows);
      }
      const hoverRows = stroking ? footprint(e.lngLat, null).rows : rows;
      setHover({ x: e.point.x, y: e.point.y, rows: hoverRows });
    };

    const endStroke = () => {
      if (!stroking) return;
      stroking = false;
      lastCell = null;
      useGame.getState().endStroke();
    };

    const onLeave = () => setHover(null);

    map.on("mousedown", onDown);
    map.on("touchstart", onDown);
    map.on("mousemove", onMove);
    map.on("touchmove", onMove);
    map.on("mouseout", onLeave);
    map.on("touchend", endStroke);
    window.addEventListener("mouseup", endStroke);
    return () => {
      map.off("mousedown", onDown);
      map.off("touchstart", onDown);
      map.off("mousemove", onMove);
      map.off("touchmove", onMove);
      map.off("mouseout", onLeave);
      map.off("touchend", endStroke);
      window.removeEventListener("mouseup", endStroke);
      endStroke();
    };
  }, [grid, painting]);

  // --- layers ---
  const allHexes = useMemo(() => ({ length: grid.n }), [grid]);
  const stations = grid.stations;
  // One entry per path; commuter rail drawn first so rapid transit sits on top.
  const linePaths = useMemo(
    () =>
      grid.lines
        .flatMap((line) => line.paths.map((path) => ({ line, path })))
        .sort((a, b) => MODE_ORDER[a.line.mode] - MODE_ORDER[b.line.mode]),
    [grid],
  );
  const onlyAdd = useGame((s) => s.onlyAdd);
  const stroking = useGame((s) => s.stroke !== null);

  // Outline of everything painted. Merging thousands of cells isn't free, so hold
  // the last outline while a stroke is in progress.
  const outlineRef = useRef<Ring[]>([]);
  const paintedOutline = useMemo(() => {
    if (stroking) return outlineRef.current;
    return (outlineRef.current = outlineRings([...edits.keys()].map((r) => grid.h3[r])));
  }, [grid, edits, version, stroking]);
  const brushOutline = useMemo(() => (hover ? outlineRings(hover.rows.map((r) => grid.h3[r])) : []), [grid, hover]);
  const selectedOutline = useMemo(
    () => (selected === null ? [] : outlineRings([grid.h3[selected]])),
    [grid, selected],
  );

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay || !labelLayer) return;
    const opacity = extruded ? 0.95 : 0.72;

    const fillColor = (_: unknown, { index, target }: { index: number; target: number[] }) => {
      const zone = edits.get(index);
      const acres = grid.acres[index];
      if (view === "change") {
        if (zone === undefined) return setRGBA(target, 0, 0, 0, 0);
        return changeColor(zoneUnits(zone, acres) - grid.units[index], opacity, target);
      }
      if (zone === 0) return openSpaceColor(opacity, target);
      const units = zone === undefined ? grid.units[index] : zoneUnits(zone, acres);
      return densityColor(acres > 0 ? units / acres : 0, opacity, target);
    };

    const elevation = (_: unknown, { index }: { index: number }) => {
      const zone = edits.get(index);
      const acres = grid.acres[index];
      const units = zone === undefined ? grid.units[index] : zoneUnits(zone, acres);
      return acres > 0 ? (units / acres) * ELEVATION_PER_DENSITY : 0;
    };

    const hexOf = (_: unknown, { index }: { index: number }) => grid.h3[index];
    // Interleaved MapboxOverlay prop (not in deck's layer typings): draw under the basemap labels.
    const underLabels = { beforeId: labelLayer } as object;
    const outline = (id: string, data: Ring[], color: RGBA, width: number, under = false, opacity = 1) =>
      new PathLayer<Ring>({
        id,
        ...(under ? underLabels : {}),
        data,
        opacity,
        visible: opacity > 0,
        getPath: (r) => r,
        getColor: color,
        getWidth: width,
        widthUnits: "pixels",
        jointRounded: true,
        parameters: ALWAYS_ON_TOP,
      });

    const layers = [
      new H3HexagonLayer({
        id: "hexes",
        ...underLabels,
        data: allHexes,
        highPrecision: false,
        getHexagon: hexOf,
        getFillColor: fillColor,
        extruded,
        getElevation: elevation,
        material: HEX_MATERIAL,
        // H3HexagonLayer strokes every hex in black by default; no borders.
        stroked: false,
        updateTriggers: {
          getFillColor: [version, view, extruded],
          // Heights only matter in 3D; skip recomputing them while flat.
          getElevation: extruded ? version : -1,
        },
      }),
      !extruded && outline("painted-outline", paintedOutline, [11, 11, 11, 150], 1.25, true, fade(zoom, OUTLINE_FADE_ZOOM)),
      showStations && zoom >= 12 && !extruded && outline("walksheds", grid.walksheds, [11, 11, 11, 110], 3),
      showLines &&
        new PathLayer<LinePath>({
          id: "line-casing",
          ...underLabels,
          data: linePaths,
          getPath: (d) => d.path,
          getColor: [255, 255, 255, 230],
          getWidth: (d) => LINE_WIDTH[d.line.mode] + 2,
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          parameters: ALWAYS_ON_TOP,
        }),
      showLines &&
        new PathLayer<LinePath>({
          id: "lines",
          ...underLabels,
          data: linePaths,
          // Line-name tooltips would pop up constantly while painting along a corridor.
          pickable: !painting,
          getPath: (d) => d.path,
          getColor: (d) => hexRGB(d.line.color),
          getWidth: (d) => LINE_WIDTH[d.line.mode],
          widthUnits: "pixels",
          capRounded: true,
          jointRounded: true,
          parameters: ALWAYS_ON_TOP,
        }),
      painting &&
        hover &&
        new H3HexagonLayer<number>({
          id: "brush",
          data: hover.rows,
          highPrecision: false,
          getHexagon: (row) => grid.h3[row],
          getFillColor: [255, 255, 255, 70],
          parameters: ALWAYS_ON_TOP,
        }),
      painting && outline("brush-outline", brushOutline, [11, 11, 11, 230], 2),
      outline("selected", selectedOutline, [11, 11, 11, 255], 3),
      showStations &&
        new ScatterplotLayer<Station>({
          id: "stations",
          data: stations,
          pickable: true,
          getPosition: (s) => [s.lon, s.lat],
          getRadius: (s) => (s.mode === "rapid" ? 5 : 4),
          radiusUnits: "pixels",
          getFillColor: (s) => [...hexRGB(s.color), 255],
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthUnits: "pixels",
          getLineWidth: 1.5,
          parameters: ALWAYS_ON_TOP,
        }),
    ];
    overlay.setProps({
      layers,
      getTooltip: ({ object }) => {
        if (object && "lines" in object) {
          const s = object as Station;
          return { text: `${s.name}\n${stationLines(s)}`, className: "deck-tooltip" };
        }
        if (object && "path" in object) return { text: (object as LinePath).line.name, className: "deck-tooltip" };
        return null;
      },
    });
  }, [
    grid,
    labelLayer,
    edits,
    version,
    view,
    extruded,
    showStations,
    showLines,
    linePaths,
    hover,
    painting,
    zoom,
    allHexes,
    stations,
    paintedOutline,
    brushOutline,
    selectedOutline,
  ]);

  // --- brush readout ---
  let readout: { text: string; note?: string; tone: "up" | "down" | "flat" } | null = null;
  if (hover && painting) {
    if (zoom < MIN_PAINT_ZOOM) readout = { text: "Zoom in to paint", tone: "flat" };
    else {
      const zone = tool.kind === "zone" ? tool.zone : undefined;
      const { delta, skipped } = previewDelta(grid, edits, hover.rows, zone, onlyAdd);
      readout = {
        text: `${fmtDelta(delta)} homes`,
        note:
          zone === undefined
            ? "Restore to today"
            : `${ZONES[zone].name}${skipped ? ` · skips ${skipped} denser hex${skipped > 1 ? "es" : ""}` : ""}`,
        tone: delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat",
      };
    }
  }

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />
      {readout && hover && (
        <div className={`brush-readout ${readout.tone}`} style={{ left: hover.x + 16, top: hover.y + 16 }}>
          {readout.text}
          {readout.note && <span className="brush-readout-zone">{readout.note}</span>}
        </div>
      )}
    </div>
  );
}

function hexRGB(color: string): [number, number, number] {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
}

const LINE_NAMES: Record<string, string> = {
  SLWaterfront: "Silver Line",
  Mattapan: "Mattapan Trolley",
};

export function stationLines(s: Station): string {
  const mode = s.mode === "rail" ? "Commuter Rail" : s.mode === "ferry" ? "Ferry" : null;
  const names = s.lines.map((l) => {
    if (LINE_NAMES[l]) return LINE_NAMES[l];
    if (["Red", "Orange", "Blue", "Green"].includes(l)) return `${l} Line`;
    return null;
  });
  const rapid = [...new Set(names.filter(Boolean))];
  if (rapid.length && mode) return `${rapid.join(", ")} · ${mode}`;
  if (rapid.length) return rapid.join(", ");
  return mode ?? "";
}
