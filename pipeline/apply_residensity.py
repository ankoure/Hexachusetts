"""Replace the grid's baseline housing units with MHP Residensity parcel counts.

Run build_grid.py first; this rewrites public/data/grid.json in place.

Each parcel's units are assigned to the H3 hex containing its representative
point (parcels are almost always far smaller than a ~26-acre hex).

Usage:
  uv run python apply_residensity.py PATH --units-field UNITS [--layer NAME]
      [--lat-field LAT --lon-field LON] [--release "July 2025"]

PATH can be anything GDAL reads (GeoPackage, shapefile/zip, FileGDB, GeoJSON),
or a CSV with lat/lon columns. If --units-field is omitted, a few likely column
names are tried.
"""

import argparse
import math

import geopandas as gpd
import h3
import pandas as pd

from pathlib import Path

from common import (
    ACRES_PER_KM2,
    GRID_PATH,
    H3_RES,
    WALKSHED_M,
    WGS84,
    greenfield_flags,
    read_grid,
    write_grid,
)

LIKELY_UNIT_FIELDS = ["units", "res_units", "est_units", "unit_count", "housing_units", "UNITS", "Units"]


def load_parcels(args) -> gpd.GeoDataFrame:
    if args.lat_field and args.lon_field:
        df = pd.read_csv(args.path)
        return gpd.GeoDataFrame(
            df, geometry=gpd.points_from_xy(df[args.lon_field], df[args.lat_field]), crs=WGS84
        )
    kw = {"layer": args.layer} if args.layer else {}
    return gpd.read_file(args.path, engine="pyogrio", **kw)


def pick_units_field(parcels: gpd.GeoDataFrame, requested: str | None) -> str:
    if requested:
        if requested not in parcels.columns:
            raise SystemExit(f"--units-field {requested!r} not found; columns: {list(parcels.columns)}")
        return requested
    for name in LIKELY_UNIT_FIELDS:
        if name in parcels.columns:
            print(f"using units field {name!r}")
            return name
    raise SystemExit(f"pass --units-field; columns: {list(parcels.columns)}")


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371008.8 * 2 * math.asin(math.sqrt(a))


def nearest_station(cell: str, stations: list[dict], modes: set[str]) -> int:
    lat, lon = h3.cell_to_latlng(cell)
    best, best_d = -1, WALKSHED_M
    for i, s in enumerate(stations):
        if s["mode"] in modes:
            d = haversine_m(lat, lon, s["lat"], s["lon"])
            if d <= best_d:
                best, best_d = i, d
    return best


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--units-field")
    ap.add_argument("--layer")
    ap.add_argument("--lat-field")
    ap.add_argument("--lon-field")
    ap.add_argument("--release", help='Residensity release label shown in the app, e.g. "July 2025"')
    ap.add_argument("--grid", type=Path, default=GRID_PATH, help="grid.json to update in place")
    args = ap.parse_args()

    parcels = load_parcels(args)
    field = pick_units_field(parcels, args.units_field)
    parcels[field] = pd.to_numeric(parcels[field], errors="coerce").fillna(0)
    parcels = parcels[(parcels[field] > 0) & parcels.geometry.notna() & ~parcels.geometry.is_empty]
    if parcels.crs is None:
        raise SystemExit("input has no CRS; reproject to a known CRS first")
    pts = parcels.geometry.representative_point().to_crs(WGS84)
    parcels = parcels.assign(
        h3=[h3.latlng_to_cell(p.y, p.x, H3_RES) for p in pts],
    )
    by_hex = parcels.groupby("h3")[field].sum()
    print(f"{len(parcels):,} residential parcels, {by_hex.sum():,.0f} units in {len(by_hex):,} hexes")

    grid = read_grid(args.grid)
    hexes = pd.DataFrame(grid["hexes"]).drop(columns="gf", errors="ignore")
    old_total = hexes.units.sum()
    hexes["units"] = hexes.h3.map(by_hex).fillna(0.0)

    # Parcels in hexes the Census land grid missed (piers, tiny islands): add them.
    missing = by_hex.index.difference(hexes.h3)
    if len(missing):
        known = dict(zip(hexes.h3, hexes.town))
        rows = []
        for cell in missing:
            town = next(
                (known[n] for k in range(1, 6) for n in h3.grid_ring(cell, k) if n in known), 0
            )
            rows.append(
                {
                    "h3": cell,
                    "units": by_hex[cell],
                    "acres": h3.cell_area(cell, "km^2") * ACRES_PER_KM2 / 7,
                    "town": town,
                    "rt": nearest_station(cell, grid["stations"], {"rapid"}),
                    "cr": nearest_station(cell, grid["stations"], {"rail", "ferry"}),
                }
            )
        hexes = pd.concat([hexes, pd.DataFrame(rows)]).sort_values("h3").reset_index(drop=True)
        print(f"added {len(missing)} hexes outside the Census land grid")

    print(f"baseline units: {old_total:,.0f} -> {hexes.units.sum():,.0f}")
    release = f", {args.release}" if args.release else ""
    grid["meta"]["unitsSource"] = f"MHP Center for Housing Data, Residensity{release} (parcel-level)"
    grid["meta"]["unitsSourceShort"] = "Residensity"
    grid["hexes"] = {
        "h3": hexes.h3.tolist(),
        "units": hexes.units.round(1).tolist(),
        "acres": hexes.acres.round(1).tolist(),
        "town": hexes.town.astype(int).tolist(),
        "rt": hexes.rt.astype(int).tolist(),
        "cr": hexes.cr.astype(int).tolist(),
        "gf": greenfield_flags(hexes.h3.tolist(), hexes.units.tolist(), hexes.acres.tolist()),
    }
    write_grid(grid, args.grid)


if __name__ == "__main__":
    main()
