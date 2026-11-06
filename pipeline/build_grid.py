"""Build the statewide H3 hex grid for Hexachusetts.

Each land hex gets:
  - acres: land area in the hex (from Census 2020 block land/water split)
  - units: baseline housing units (Census 2020 blocks, apportioned by area).
           Replace these with Residensity counts via apply_residensity.py.
  - town:  index into `towns` (municipality containing the hex center)
  - rt/cr: index into `stations` of the nearest rapid transit / regional
           (commuter rail, ferry) station within half a mile, or -1
  - gf:    1 if the surrounding area is rural/undeveloped (see common.greenfield_flags)

Inputs (downloaded by `make data` into .cache/):
  tl_2020_25_tabblock20.zip  Census 2020 tabulation blocks (has HOUSING20)
  tl_2020_25_cousub.zip      Census county subdivisions (= MA's 351 municipalities)
  MBTA_GTFS.zip              MBTA GTFS feed
"""

import zipfile
from collections import defaultdict
from datetime import date

import geopandas as gpd
import h3
import pandas as pd
from shapely.geometry import LineString, Polygon
from shapely.ops import linemerge, unary_union

from common import (
    ACRES_PER_KM2,
    CACHE,
    GREENFIELD_DENSITY,
    GREENFIELD_RINGS,
    H3_FINE_RES,
    H3_RES,
    MA_CRS,
    WALKSHED_M,
    WGS84,
    greenfield_flags,
    write_grid,
)

# Stations come from routes in these MBTA fare classes. Silver Line Waterfront and
# Chelsea (SL1/2/3/W) are "Rapid Transit"; SL4/5 are "Local Bus" and excluded.
RAPID_FARE_CLASSES = {"Rapid Transit"}
REGIONAL_FARE_CLASSES = {"Commuter Rail", "Ferry"}


def load_blocks() -> gpd.GeoDataFrame:
    blocks = gpd.read_file(f"zip://{CACHE / 'tl_2020_25_tabblock20.zip'}", engine="pyogrio")
    blocks = blocks[["GEOID20", "ALAND20", "HOUSING20", "geometry"]].to_crs(WGS84)
    return blocks[(blocks.ALAND20 > 0) | (blocks.HOUSING20 > 0)].reset_index(drop=True)


def apportion_blocks(blocks: gpd.GeoDataFrame) -> pd.DataFrame:
    """Spread each block's housing units evenly over the fine cells it covers,
    then roll up to H3_RES. Land fraction = share of fine children that are land."""
    units: dict[str, float] = defaultdict(float)
    land_children: dict[str, set] = defaultdict(set)

    for geoid, aland, housing, geom in blocks.itertuples(index=False):
        cells = h3.geo_to_cells(geom, H3_FINE_RES)
        if not cells:
            p = geom.representative_point()
            cells = [h3.latlng_to_cell(p.y, p.x, H3_FINE_RES)]
        share = housing / len(cells)
        for c in cells:
            parent = h3.cell_to_parent(c, H3_RES)
            if housing:
                units[parent] += share
            if aland > 0:
                land_children[parent].add(c)

    n_children = 7  # aperture-7: every res-9 hex has 7 res-10 children
    rows = []
    for cell in set(units) | set(land_children):
        frac = min(1.0, max(len(land_children.get(cell, ())), 1) / n_children)
        acres = h3.cell_area(cell, "km^2") * ACRES_PER_KM2 * frac
        rows.append((cell, units.get(cell, 0.0), acres))
    df = pd.DataFrame(rows, columns=["h3", "units", "acres"])
    print(f"apportioned {len(blocks)} blocks into {len(df)} hexes, {df.units.sum():,.0f} units")
    return df


def hex_points(df: pd.DataFrame) -> gpd.GeoDataFrame:
    latlng = [h3.cell_to_latlng(c) for c in df.h3]
    return gpd.GeoDataFrame(
        df[["h3"]],
        geometry=gpd.points_from_xy([p[1] for p in latlng], [p[0] for p in latlng]),
        crs=WGS84,
    ).to_crs(MA_CRS)


def assign_towns(points: gpd.GeoDataFrame) -> tuple[list[str], pd.Series]:
    towns = gpd.read_file(f"zip://{CACHE / 'tl_2020_25_cousub.zip'}", engine="pyogrio")
    towns = towns[towns.COUSUBFP != "00000"][["NAME", "geometry"]].to_crs(MA_CRS)
    # A few cities are styled "<Name> Town" in TIGER (e.g. "Watertown Town").
    towns["NAME"] = towns.NAME.str.removesuffix(" Town")
    # Hex centers that fall in water snap to the nearest municipality.
    joined = gpd.sjoin_nearest(points, towns, how="left")
    joined = joined[~joined.index.duplicated()]
    names = sorted(towns.NAME.unique())
    index = {n: i for i, n in enumerate(names)}
    return names, joined.NAME.map(index)


def load_stations() -> gpd.GeoDataFrame:
    with zipfile.ZipFile(CACHE / "MBTA_GTFS.zip") as z:
        read = lambda name, **kw: pd.read_csv(z.open(name), dtype=str, **kw)  # noqa: E731
        routes = read("routes.txt")
        trips = read("trips.txt", usecols=["route_id", "trip_id"])
        stops = read("stops.txt")
        routes = routes[routes.route_fare_class.isin(RAPID_FARE_CLASSES | REGIONAL_FARE_CLASSES)]
        trips = trips[trips.route_id.isin(routes.route_id)]
        stop_times = read("stop_times.txt", usecols=["trip_id", "stop_id"])

    served = stop_times.merge(trips, on="trip_id")[["stop_id", "route_id"]].drop_duplicates()
    stops = stops.set_index("stop_id")
    # Roll platforms up to their parent station.
    served["station_id"] = served.stop_id.map(
        lambda s: stops.at[s, "parent_station"] if pd.notna(stops.at[s, "parent_station"]) else s
    )
    served = served.merge(
        routes[["route_id", "route_type", "route_fare_class", "route_color", "route_sort_order", "line_id"]],
        on="route_id",
    )
    # Bus rapid transit (Silver Line) also serves curbside stops; only keep real stations.
    is_station = served.station_id.map(lambda s: stops.at[s, "location_type"] == "1")
    served = served[(served.route_type != "3") | is_station]
    served["route_sort_order"] = served.route_sort_order.astype(int)
    served = served.sort_values("route_sort_order")

    rows = []
    for station_id, g in served.groupby("station_id", sort=False):
        mode = "rapid" if g.route_fare_class.isin(RAPID_FARE_CLASSES).any() else (
            "rail" if (g.route_fare_class == "Commuter Rail").any() else "ferry"
        )
        lines = list(dict.fromkeys(g.line_id.str.removeprefix("line-")))
        s = stops.loc[station_id]
        rows.append(
            {
                "id": station_id,
                # Long Wharf has one stop per gate; collapse them.
                "name": s.stop_name.split(" - Gate")[0],
                "mode": mode,
                "lines": lines,
                "color": "#" + g.route_color.iloc[0],
                "lat": round(float(s.stop_lat), 5),
                "lon": round(float(s.stop_lon), 5),
            }
        )
    st = pd.DataFrame(rows).drop_duplicates(["mode", "name"])
    st = st.sort_values(["mode", "name"]).reset_index(drop=True)
    gdf = gpd.GeoDataFrame(st, geometry=gpd.points_from_xy(st.lon, st.lat), crs=WGS84)
    print(f"loaded {len(gdf)} stations: {gdf['mode'].value_counts().to_dict()}")
    return gdf


def nearest_station(points: gpd.GeoDataFrame, stations: gpd.GeoDataFrame) -> pd.Series:
    """Index (into the full station table) of the nearest station within the walkshed, else -1."""
    if stations.empty:
        return pd.Series(-1, index=points.index)
    st = stations.to_crs(MA_CRS)[["geometry"]].assign(station=stations.index)
    joined = gpd.sjoin_nearest(points, st, how="left", max_distance=WALKSHED_M)
    joined = joined[~joined.index.duplicated()]
    return joined.station.fillna(-1).astype(int)


def load_lines() -> list[dict]:
    """Track geometry for each rapid transit / commuter rail / ferry line, from the
    shapes of each route's typical service patterns."""
    with zipfile.ZipFile(CACHE / "MBTA_GTFS.zip") as z:
        read = lambda name, **kw: pd.read_csv(z.open(name), dtype=str, **kw)  # noqa: E731
        routes = read("routes.txt")
        patterns = read("route_patterns.txt")
        trips = read("trips.txt", usecols=["trip_id", "shape_id"])
        shapes = read("shapes.txt")
        line_names = read("lines.txt").set_index("line_id").line_long_name

    routes = routes[routes.route_fare_class.isin(RAPID_FARE_CLASSES | REGIONAL_FARE_CLASSES)]
    patterns = patterns[patterns.route_id.isin(routes.route_id)].copy()
    patterns["typicality"] = patterns.route_pattern_typicality.astype(int)
    # Typical patterns per route (1 = regular service), falling back to the most typical.
    patterns = patterns[patterns.typicality == patterns.groupby("route_id").typicality.transform("min")]
    # One direction is enough: inbound and outbound shapes trace the same track.
    patterns = patterns[patterns.direction_id == patterns.groupby("route_id").direction_id.transform("min")]
    patterns = patterns.merge(trips, left_on="representative_trip_id", right_on="trip_id")
    patterns = patterns.merge(routes[["route_id", "route_fare_class", "route_color", "line_id", "route_sort_order"]])

    shapes["shape_pt_sequence"] = shapes.shape_pt_sequence.astype(int)
    shapes = shapes[shapes.shape_id.isin(patterns.shape_id)].sort_values(["shape_id", "shape_pt_sequence"])
    geoms = {
        sid: LineString(zip(g.shape_pt_lon.astype(float), g.shape_pt_lat.astype(float)))
        for sid, g in shapes.groupby("shape_id")
    }

    lines = []
    for line_id, g in patterns.sort_values("route_sort_order").groupby("line_id", sort=False):
        fare = g.route_fare_class.iloc[0]
        mode = "rapid" if fare in RAPID_FARE_CLASSES else ("rail" if fare == "Commuter Rail" else "ferry")
        # Merging drops track shared by several patterns (e.g. the Red Line trunk).
        merged = unary_union([geoms[sid] for sid in g.shape_id.unique() if sid in geoms])
        merged = gpd.GeoSeries([merged], crs=WGS84).to_crs(MA_CRS).simplify(10).to_crs(WGS84).iloc[0]
        merged = linemerge(merged) if merged.geom_type == "MultiLineString" else merged
        paths = [
            [[round(x, 5), round(y, 5)] for x, y in part.coords]
            for part in getattr(merged, "geoms", [merged])
        ]
        lines.append(
            {
                "name": line_names.get(line_id, line_id.removeprefix("line-")),
                "mode": mode,
                "color": "#" + g.route_color.iloc[0],
                "paths": paths,
            }
        )
    print(f"loaded {len(lines)} lines, {sum(len(p) for l in lines for p in l['paths'])} vertices")
    return lines


# Gaps between three or more nearly-touching circles leave sliver holes in the
# merged walkshed; drop holes smaller than this (1 hectare, ~2.5 acres).
MIN_WALKSHED_HOLE_M2 = 10_000


def walkshed_outline(stations: gpd.GeoDataFrame) -> list[list[list[float]]]:
    """Union of every station's half-mile circle, as [lon, lat] rings (outer edges and
    holes), so overlapping walksheds draw as one boundary."""
    merged = stations.to_crs(MA_CRS).buffer(WALKSHED_M, quad_segs=16).union_all().simplify(5)
    polys = [
        Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area >= MIN_WALKSHED_HOLE_M2])
        for p in getattr(merged, "geoms", [merged])
    ]
    merged = gpd.GeoSeries(polys, crs=MA_CRS).to_crs(WGS84)
    rings = []
    for poly in merged:
        for ring in [poly.exterior, *poly.interiors]:
            rings.append([[round(x, 5), round(y, 5)] for x, y in ring.coords])
    return rings


def main() -> None:
    blocks = load_blocks()
    df = apportion_blocks(blocks).sort_values("h3").reset_index(drop=True)
    points = hex_points(df)
    town_names, town_idx = assign_towns(points)
    stations = load_stations()
    rt = nearest_station(points, stations[stations["mode"] == "rapid"])
    cr = nearest_station(points, stations[stations["mode"] != "rapid"])

    grid = {
        "meta": {
            "resolution": H3_RES,
            "walkshedMeters": WALKSHED_M,
            "unitsSource": "U.S. Census 2020 housing units (block-level, apportioned by area)",
            "unitsSourceShort": "Census 2020",
            "built": date.today().isoformat(),
            "greenfield": {"rings": GREENFIELD_RINGS, "density": GREENFIELD_DENSITY},
        },
        "towns": town_names,
        "stations": stations.drop(columns="geometry").drop(columns="id").to_dict("records"),
        "walksheds": walkshed_outline(stations),
        "lines": load_lines(),
        "hexes": {
            "h3": df.h3.tolist(),
            "units": df.units.round(1).tolist(),
            "acres": df.acres.round(1).tolist(),
            "town": town_idx.tolist(),
            "rt": rt.tolist(),
            "cr": cr.tolist(),
            "gf": greenfield_flags(df.h3.tolist(), df.units.tolist(), df.acres.tolist()),
        },
    }
    write_grid(grid)


if __name__ == "__main__":
    main()
