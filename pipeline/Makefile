# Build public/data/grid.json from Census 2020 blocks + MBTA GTFS.
#   make grid                                   # Census baseline
#   make residensity PARCELS=path UNITS=field   # then swap in Residensity units

CACHE := .cache
TIGER := https://www2.census.gov/geo/tiger/TIGER2020

DOWNLOADS := $(CACHE)/tl_2020_25_tabblock20.zip $(CACHE)/tl_2020_25_cousub.zip $(CACHE)/MBTA_GTFS.zip

.PHONY: grid residensity clean refresh-gtfs

grid: $(DOWNLOADS)
	uv run python build_grid.py

residensity:
	@test -n "$(PARCELS)" || (echo "usage: make residensity PARCELS=path/to/parcels UNITS=field [RELEASE='July 2025']" && exit 1)
	uv run python apply_residensity.py "$(PARCELS)" $(if $(UNITS),--units-field "$(UNITS)") $(if $(RELEASE),--release "$(RELEASE)")

$(CACHE)/tl_2020_25_tabblock20.zip:
	mkdir -p $(CACHE) && curl -sSfL -o $@ $(TIGER)/TABBLOCK20/tl_2020_25_tabblock20.zip

$(CACHE)/tl_2020_25_cousub.zip:
	mkdir -p $(CACHE) && curl -sSfL -o $@ $(TIGER)/COUSUB/tl_2020_25_cousub.zip

$(CACHE)/MBTA_GTFS.zip:
	mkdir -p $(CACHE) && curl -sSfL -o $@ https://cdn.mbta.com/MBTA_GTFS.zip

refresh-gtfs:
	rm -f $(CACHE)/MBTA_GTFS.zip && $(MAKE) grid

clean:
	rm -rf $(CACHE)
