# Hexachusetts

*Fantasy zoning for Massachusetts.*

A city-builder-style sandbox for Massachusetts housing. Paint zones onto a statewide
hex grid to add (or remove) homes, then see what it adds up to: net new homes,
how many are near transit, how much lands in rural areas, and which towns grow.
Maps can be shared as links or saved as files.

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

`public/data/grid.json` is checked in, so the app runs without the pipeline.
To rebuild it, see [Data](#data).

`npm run build` produces a static site in `dist/` (relative paths, so it can be
hosted under any prefix). `grid.json` is ~7.7 MB raw and ~0.8 MB gzipped, so
serve it with compression.

## How it plays

- **Zones** (keys `1`–`7`) set a hex to a target *gross* density, i.e. homes per
  acre of land across the whole hex, streets included: Open space 0, Rural 0.5,
  Suburban 3, Streetcar suburb 10, Triple-decker 25, Mid-rise 50, High-rise 100.
  For scale, the densest hexes today (Back Bay, the West End) are around 60–90.
- **Only add homes** (on by default) skips hexes that a zone would make *less*
  dense than today, so painting Mid-rise across Back Bay doesn't quietly
  demolish anything. Turn it off to downzone.
- **Restore** (`E`) returns hexes to today's count. **Inspect** (`I`) shows a
  hex's town, homes, density, and nearest station. Hold `Space` (or use Pan,
  `H`) to drag the map while a brush is active; `[` `]` resize the brush.
- **Views**: Density / Change (`V`), 3D extrusion (`B`), stations with their
  merged ½-mile walksheds (`S`), and rapid transit / commuter rail / ferry lines
  (`L`). Undo/redo with `Ctrl+Z` / `Ctrl+Shift+Z`.
- **Scenarios** add goals: *A Home for Everyone* (222,000 homes, the 2025 state
  housing plan's figure), *Transit First*, *No Sprawl*, *Rapid Transit
  Communities* (grow each of the 12 MBTA Communities Act rapid transit
  communities by 25%), and *Sandbox*. They live in `src/game/scenarios.ts`;
  each is just a function from stats to goal progress, so adding one is cheap.
- **Sharing**: "Share link" puts the whole map in the URL hash; opening a
  shared link loads it on top of your own map (Undo returns to yours). Large
  maps are better as files (Save / Open). Work also autosaves to
  `localStorage`.

### Definitions

- **Near transit**: hex center within ½ mile (straight line) of an MBTA rapid
  transit station (subway, light rail, Silver Line Waterfront/Chelsea stations)
  or a commuter rail / ferry stop. "Added near transit" is the share of *gross*
  homes added that land in such hexes.
- **Rural area**: the hex and the three rings around it (~0.6 mi radius)
  average under 1 home/acre today. Looking at the surroundings, not just the
  hex, keeps in-city job centers, rail yards and parks (Kendall, the Seaport)
  from counting as sprawl.
- **Residents** are estimated at 2.4 people per home.

## Data

Everything is precomputed into one file, `public/data/grid.json`: ~196k H3
resolution-9 hexes (~26 acres each) covering Massachusetts' land, each with
baseline homes, land acres, municipality, nearest stations, and the rural flag.

The pipeline is Python, managed with [uv](https://docs.astral.sh/uv/):

```bash
cd pipeline
make grid            # downloads inputs into pipeline/.cache, writes grid.json (~1 min)
make refresh-gtfs    # re-pull the MBTA feed and rebuild
```

Inputs:

| Source | Used for |
| --- | --- |
| Census 2020 TIGER/Line tabulation blocks (`HOUSING20`) | Baseline homes, land area |
| Census 2020 county subdivisions | Municipality per hex (351 cities and towns) |
| MBTA GTFS | Rapid transit, commuter rail and ferry stations and line shapes |

### Swapping in Residensity

The baseline currently comes from 2020 Census block counts, spread evenly
across each block's area. Once we have MHP's Residensity parcel export:

```bash
cd pipeline
make grid    # if grid.json isn't already the Census build
make residensity PARCELS=/path/to/residensity.gpkg UNITS=<units column> RELEASE="July 2025"
```

`apply_residensity.py` reads anything GDAL can open (GeoPackage, shapefile,
FileGDB, GeoJSON) or a CSV with `--lat-field/--lon-field`. Each parcel's units go
to the hex containing its representative point, replacing the Census counts.
It recomputes the rural flags, adds hexes for parcels outside the Census land
grid (piers, small islands), and updates the source credit shown in the app.
It was exercised against a synthetic parcel file built from Census blocks, not
the real export, so expect to adjust the column handling when the data arrives.

## Code map

```
pipeline/            build_grid.py, apply_residensity.py, common.py, Makefile
src/game/            grid loading, zones, edit store (undo/redo), stats, scenarios, share encoding
src/map/GameMap.tsx  MapLibre basemap (OpenFreeMap Positron) + deck.gl hex layers, painting input
src/ui/              top bar, toolbox, sidebar (goals, stats, towns, inspector), legend
```

## License

The code is [MIT licensed](LICENSE). That license doesn't cover the third-party
data in `public/data/grid.json`, which stays under its sources' terms:

- **Transit data** is provided by MassDOT/MBTA under the
  [MassDOT Developers License Agreement](https://www.mbta.com/developers/gtfs).
  Hexachusetts isn't affiliated with or endorsed by MassDOT or the MBTA.
- **Housing and boundary data** comes from the U.S. Census Bureau.
