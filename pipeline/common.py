"""Shared constants and helpers for the Hexachusetts data pipeline."""

import json
from pathlib import Path

import h3

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
GRID_PATH = ROOT.parent / "public" / "data" / "grid.json"

# H3 resolution 9: ~0.1 km² (~26 acres) per hex, ~175 m edge.
H3_RES = 9
# Fine resolution used to apportion Census blocks across hexes (7 children per res-9 hex).
H3_FINE_RES = 10

# Mass State Plane (meters), used for distance math.
MA_CRS = "EPSG:26986"
WGS84 = "EPSG:4326"

# Half a mile, the usual transit-oriented-development walkshed.
WALKSHED_M = 804.672

ACRES_PER_KM2 = 247.105

# A hex is "greenfield" when its surroundings (the hex plus GREENFIELD_RINGS rings,
# ~0.6 mi radius) average fewer than GREENFIELD_DENSITY homes/acre. Looking at the
# neighborhood rather than the hex itself keeps job centers, rail yards and parks
# inside cities (Kendall, the Seaport) from counting as sprawl.
GREENFIELD_RINGS = 3
GREENFIELD_DENSITY = 1.0


def greenfield_flags(cells: list[str], units: list[float], acres: list[float]) -> list[int]:
    index = {c: i for i, c in enumerate(cells)}
    flags = []
    for c in cells:
        u = a = 0.0
        for n in h3.grid_disk(c, GREENFIELD_RINGS):
            i = index.get(n)
            if i is not None:
                u += units[i]
                a += acres[i]
        flags.append(int(a == 0 or u / a < GREENFIELD_DENSITY))
    return flags


def write_grid(grid: dict, path: Path = GRID_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(grid, f, separators=(",", ":"))
    print(f"wrote {path} ({path.stat().st_size / 1e6:.1f} MB, {len(grid['hexes']['h3'])} hexes)")


def read_grid(path: Path = GRID_PATH) -> dict:
    with open(path) as f:
        return json.load(f)
