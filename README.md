# CZ-6A Launch Profiles

Interactive Earth-fixed launch trajectories, twilight illumination and observer sky charts, adapted from the [ZhuQue viewer](https://github.com/exoplanet5/ZhuQue) and SatObserver-MX / Starship IFT-14 presentation.

**First and default profile: retrograde, 142° inclination.** Its first mission is the Yaogan-50 03 reconstruction for **2026-10-23, T0 10:15 UTC** (announced 18:15 Beijing time), from Taiyuan LC-9A. This is **not an SSO mission**. The Zhuque SSO reconstruction is a visualization reference, not a source of CZ-6A engine, staging or orbital assumptions.

## Run locally

No build or package installation is needed. All JavaScript, textures and catalog data are local.

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory docs
# Open http://127.0.0.1:8766/
```

Use an HTTP server, not a `file://` URL: the viewer loads ES modules, JSON and local assets.

- Select a **profile**, then a **mission configuration**. Defaults are explicit; adding a profile never silently changes the landing mission.
- Change **T0** to recompute Sun geometry, sunlight pickup and the synthetic TLE orientation. The supplied Earth-fixed track stays unchanged.
- Scrub MET, play at 1–300×, or click a timeline time. Space toggles playback; arrows seek 10 s, or 300 s with Shift, when a form control is not focused.
- **Drag** the globe to turn it; the grabbed ground follows the pointer. **Right-drag**, Ctrl/Shift-drag or a **two-finger drag** tilts and rotates the camera around the point at the centre of the view, Google Earth style, and a two-finger twist rotates too. Scroll or pinch to zoom toward that point. The camera stays at least 319 km above the surface and within 80° of vertical; camera presets reset to a north-up vertical view. Hover the trajectory for MET/altitude; click to seek.
- The city layer includes **110 China city centres**: all mainland provincial capitals, major regional/coastal cities and additional launch-corridor cities. Three zoom tiers reveal more cities as you move closer, with small neutral dots and collision-checked labels. City coordinates are approximate map/observer defaults; use a specific site coordinate for precise local viewing.
- **Click anywhere on the globe** (or tap on a phone), click a city label, or open **Observer sky chart** and enter coordinates. A cyan ring marks the selected observer site while the chart is open. Clicks on the trajectory seek instead, and drags, tilts and pinches never open a chart. It shows ascent and orbital passes, Sun/Moon, stars, and optional constellation/Milky Way layers.
- Toggle the sunlit-plume illustration, NOTAM polygons, ground tracks, city lights and solar contours. Turning off the plume does not hide the ascent.
- **Borders & regions** is enabled by default: country borders worldwide, with province/region lines **only in China**. Other countries have no internal state/province/region lines. Country borders are stronger than regional lines; remaining source-classified disputed/control lines are dashed. The selected land-boundary worldview is **China claims**, including the sourced southern Tibet claim; the footer identifies that view. The checkbox or `?borders=0` hides both administrative levels. These are generalized cartographic reference lines, not authoritative sovereignty boundaries.
- The **green 15° circle** is enabled by default and follows the vehicle's current position and altitude. Its checkbox or `?fp=0` can turn it off. The ascent visibility envelope and Twilight jellyfish information panel are no longer displayed or computed by the viewer.
- **Copy link** restores profile, mission, T0, numeric MET (including negative times), the camera view point, heading, tilt and range (`cam=lon,lat,dist,heading,tilt`), speed, layer toggles and an open observer site. Height is fixed at true scale (×1). Panel visibility is a per-browser convenience; blocked storage is tolerated.
- Live clock operates only within the modeled time span; it does not extrapolate a flight outside the data.

Example:

```text
?profile=retrograde-142&mission=yaogan50-03&t0=10:15:00&met=300&sky=30.66,104.07
```

## Adaptive map detail

Map imagery now refines automatically with zoom, viewport size and display pixel density. The permanent 4096 × 2048 globe is the fallback; only visible higher-detail tiles are requested. The local pyramid (672 tiles) provides equivalent world widths of 5400, 10800 and **21600 pixels**, capped at the native **21600 × 10800** NASA Blue Marble source. Zooming closer cannot reveal detail absent from that source.

- Tile selection uses projected pixels per radian, camera frustum and Earth-horizon culling. Twelve-percent hysteresis avoids switching repeatedly at a zoom threshold; selection updates at most every 160 ms. Four image requests may be in flight.
- A strict **32-entry LRU**, including in-flight entries, bounds tile residency (about **75 MiB** worst-case RGBA+mipmap tile allocation, additional to the base globe, night-light texture and vector data). If a view would exceed that count, the imagery level is reduced. Failed tiles are retried after a 30-second cooldown. Missing detail leaves the base map visible; no blank holes or external tile/API service is needed.
- Adjacent tiles include a wrapped/clamped one-pixel gutter. Tile shaders share the same illumination and city lights as the base globe. The former global 8K texture has been removed; local tiles supersede it.
- Administrative boundaries are **screen-space vector lines**, not pixels enlarged from a fixed 4K overlay. Coarse, medium and fine geometries load with zoom, at 0.10°, 0.02° and 0.0025° simplification tolerances. These are generalized **Natural Earth 1:10 million** sources, not survey boundaries. At most two parsed levels are retained, and only one vector geometry level is rendered.
- The 10° graticule and NOTAM zone fill are vector geometry, sharp at every zoom; no full-globe overlay image is kept. Day imagery refines; the global night-light texture keeps its existing resolution. Trajectory, sunlight calculations and mission data are unchanged.

### China-claims land-boundary view

Regional display is restricted by source administration identifiers to China in the selected viewpoint, including Hong Kong/Macau internal limits; source-classified unrecognized lines remain omitted. Country and disputed/control boundary geometry worldwide is unchanged by this display filter.

All three detail levels use the same pinned Natural Earth `FCLASS_CN` worldview and auxiliary claim-line geometry. For southern Tibet / Arunachal Pradesh, the sourced **Chinese claim** line (`ne_id=1746705431`) supplies the southern outline; the previous McMahon/de facto line (`1746705337`, source-classified unrecognized in this view) is omitted, not turned into a province border. Conflicting regional linework inside sourced China-assigned claim polygons is removed without inventing replacement province lines.

Arunachal Pradesh is administered by India and claimed by China. This is an explicitly selected cartographic viewpoint, not a statement that the dispute is resolved. It is generalized land linework, **not a complete official Chinese standard map**: maritime claims and island/coastal sovereignty outlines are not added. The data and [boundary attribution](docs/data/BOUNDARIES-LICENSE.txt) retain source IDs, hashes, classification decisions and limitations.

## Current configuration

| Quantity | Value (revision 2) |
|---|---:|
| Insertion inclination | 141.9815° |
| Osculating perigee × apogee | 695.4 × 952.9 km |
| Insertion | T+773.38 s, about 10:27:53 UTC |
| Cutoff state vs. catalog object 2026-240A | 3.4 km |
| Sunlight pickup | T+101.0 s, 43.18 km WGS84 altitude |
| Playback end | T+9897.8 s, about 12:59:58 UTC |
| Orbit coverage after insertion | 1.5 × 6082.94 s |
| Hazard polygon | A5283/26, booster drop zone |
| Published hazard interval | 10:07–10:28 UTC |

“1.5 revolutions” means 1.5 times the insertion Keplerian period in elapsed time. The source orbit includes J2, so this does not claim an exact repeating ground track or true-anomaly recurrence. The 09:30–11:00 T0 slider range is for exploration; **it is not an announced launch window**.

### Scientific limitations

Revision 2 (2026-10-24) replaces the kinematic lower ascent with a point-mass first-stage model. Its propulsion surrogate is calibrated on the triangulated December 2025 CZ-6A ascent. The model is fitted to two untimed ground reports. At N39.00 E110.12 the rocket crossed above the Moon at about 1.6 × its elevation; the model gives 1.58 ×. At N37.76 E110.93 the sunlit rising path looked nearly straight; the model gives a +1.3° great-circle offset. A ballistic booster range is also fitted to the NOTAM booster zone. The reports constrain **climb geometry, not timing**. The climb is much steeper than before, about 61 km altitude at 54 km ground range against 39 km, while altitude versus time changes little. The upper stage is fitted to the first catalog orbit of 2026-240A, assumed to be the payload; its identity is unconfirmed. This is not telemetry, and fit residuals are not confidence intervals.

The dogleg is attributed to **stage 1**, and the NOTAM to **boosters**. The plane change is still carried by the stage-2 steering surrogate. Modeled booster burnout/separation (T+88/134 s) and stage-2 ignition (T+230 s) are model quantities and are not shown as timeline events; no debris trajectory or impact time is shown. Full assumptions and sensitivity refits are in the source project README.

The exporter resamples the existing solution; it does not fit or integrate a new launch. T0 shifts leave the Earth-fixed trajectory unchanged. The model TLE keeps its **PRELAUNCH MODEL — NOT OBSERVED** label and placeholder catalog number 00000; it is fitted to the reconstructed orbit, not the catalog element set. The page displays numerical samples rather than propagating that TLE.

### Illumination and visibility

- Sun vectors come from **JPL DE440s**, geometric Earth-to-Sun positions in ITRS/ECEF, at 30-second cadence. Linear interpolation covers all allowed T0/MET combinations, including the prelaunch interval; no extrapolation is allowed.
- Sunlight requires the vehicle-to-Sun-centre segment to miss the WGS84 ellipsoid. There is **no 34′ refraction adjustment**. The first pickup agrees with the source calculation to within 0.001 s; this is an export consistency check, not predictive timing accuracy.
- The instantaneous **15° circle** is a spherical minimum-elevation footprint, drawn dashed green (`#199e70`). It has no observer-night mask and is not an accumulated ascent envelope. The globe's **solid yellow Sun 0°** and **solid cyan Sun −12°** contours move with playback UTC.
- The source-model visibility-analysis helper is kept outside the published site in `tools/visibility.js` for validation; the viewer does not compute or draw an envelope. The archived method unions sunlit-ascent samples with vehicle elevation ≥15° and observer Sun ≤0° at the same time, with an additional insertion-time darkness mask.
- Sky-chart pass badges count sampled time with a sunlit vehicle, elevation ≥15°, and observer Sun ≤0°. They include ascent and orbital passes and are independent of the instantaneous circle. AOS/LOS are drawn at a 1° elevation threshold.
- Glow is an illustration, not a prediction of plume size, persistence, brightness or detectability. No terrain, weather, extinction, refraction or finite-disc emergence is modeled.
- Physics and look angles use WGS84 km; the textured globe is spherical for drawing, with heights at true scale. Moon and star rendering use approximate astronomy.

## Files and reproducibility

- `docs/index.html`: static page and styling.
- `docs/js/app.js`: scene and controls; `globe-math.js`, `globe-camera.js`: the view-point/heading/tilt/range camera model and its pointer gestures; `profile.js`: validation, tracks and geometric sunlight; `astro.js`, `skychart.js`: astronomy and observer charts.
- `docs/js/cities.js`: curated city-centre catalog and zoom-tier thresholds, shared by the globe and city-label sky-chart links.
- `docs/data/profiles.json`: profile/mission manifest, with explicit defaults.
- `docs/data/boundaries{,-medium,-fine}.json`: three consistent detail levels for worldwide country borders and China-only regional lines. `boundaries.js` validates and tessellates independent lines; `boundary-layer.js` renders screen-space vectors with zoom-dependent detail.
- `docs/js/map-lod.js`, `map-tiles.js`: screen-space tile selection, native-detail cap, bounded request/cache management and patch rendering. `docs/tex/tiles/manifest.json` records every tile hash and the source image hash; image attribution is in `docs/tex/TILES-LICENSE.txt`.
- `tools/visibility.js`: archived source-model visibility analysis, used by the unit tests only and not published.
- `tools/export_map_tiles.py`: reproducible local JPEG pyramid generation from the shared 21600 × 10800 Blue Marble source.
- `tools/export_boundaries.py`: pinned, reproducible boundary-data simplification; see `docs/data/BOUNDARIES-LICENSE.txt` for source URLs, licenses and rebuild commands.
- `docs/data/yaogan50-03.json`: self-contained first mission, including tracks, solar vectors, zones, events and synthetic TLE.
- `profiles/retrograde-142/yaogan50-03/`: archived trajectory CSV, synthetic TLE, supplied KML and sanitized source metadata. No raw Space-Track records are included.
- `tools/export_profile.py`: reproducible exporter for this specific source model. It preserves other registered profiles and missions when updating the manifest; it is not a generic CZ-6A propulsion solver.
- `PROFILE_FORMAT.md`: data contract and adding future polar, SSO, retrograde or low-inclination configurations.

Rebuild the first mission (NumPy, SciPy, pyproj and Skyfield required):

```sh
~/.venvs/astro313/bin/python -I tools/export_profile.py
~/.venvs/astro313/bin/python -I tools/export_profile.py --check
```

The shared kernel is read from `~/JPLDE/de440s.bsp`; it is never copied or downloaded into this repository. The browser does not need the kernel or Python. Source hashes, interpolation details, dependencies and nine export checks are recorded in `tests/profile_validation.json`.

Rebuild/check imagery (Pillow required; the shared source image is read, not copied):

```sh
~/.venvs/astro313/bin/python -I tools/export_map_tiles.py
~/.venvs/astro313/bin/python -I tools/export_map_tiles.py --check
```

Boundary rebuild commands and all four pinned source URLs/hashes are in `docs/data/BOUNDARIES-LICENSE.txt`; use `--all-levels` to reproduce the three China-view exports together. Optional source-level geometry/rebuild tests use the `CZ6A_BOUNDARY_SOURCES` paths described in `tests/test_boundary_exporter.py`.

Tests, using Node 22+ and the astronomy environment:

```sh
npm test
~/.venvs/astro313/bin/python -I tests/test_exporter.py
~/.venvs/astro313/bin/python -I tests/test_boundary_exporter.py
# With the local HTTP server running and Chrome installed:
node tests/browser.mjs
```

Set `CHROME` to another Chrome executable and `VIEWER_URL` to another local server address if needed. Browser tests launch an isolated temporary profile, use Chrome's default graphics path, and write screenshots/results under ignored `.test-artifacts/`. They do not alter the user's Chrome profile.

## GitHub Pages

The viewer is published at **https://exoplanet5.github.io/CZ-6A/**. GitHub Pages serves `main` → `/docs`, including `.nojekyll`. Future updates deploy when changes reach `main`.

## Credits and sources

Illustration: Mickey. NASA Blue Marble Next Generation / Black Marble base textures. Administrative boundaries: [Natural Earth](https://www.naturalearthdata.com/), public domain; source revision and attribution are preserved in `docs/data/BOUNDARIES-LICENSE.txt` and `boundaries.json`. Three.js is vendored with its MIT license (`docs/vendor/three/LICENSE`). Star catalog and Milky Way data are from d3-celestial, BSD-3 (`docs/data/STARDATA-LICENSE.txt`). Sky-chart and viewer components are adapted from [ZhuQue](https://github.com/exoplanet5/ZhuQue) and [Starship IFT-14](https://github.com/exoplanet5/Starship-IFT14), with CZ-6A profile loading, geometric illumination, optional events/tracks and responsive controls added here. Code license: Apache-2.0, see `LICENSE`.

The scientific source is the local `launch_traj_6A_reverse` reconstruction (revision 2), the supplied NOTAM A5283/26 issued 2026-10-17, user-supplied ground reports, and the first Space-Track elements of 2026-240A. The Yaogan-50 02 launch-time reference is [Next Spaceflight's March 15 flight record](https://nextspaceflight.com/launches/details/8186), also documented by [SciNews/CCTV](https://www.youtube.com/watch?v=L0gIO7TAA4g). Derived precursor orbit-family parameters inform the model; raw catalog downloads are not redistributed. This is an independent visualization, not official launch guidance or an official ephemeris.
