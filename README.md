# CZ-6A Launch Profiles

Interactive Earth-fixed launch trajectories, twilight illumination and observer sky charts, adapted from the [ZhuQue viewer](https://github.com/exoplanet5/ZhuQue) and SatObserver-MX / Starship IFT-14 presentation.

**First and default profile: retrograde, 142° inclination.** Its first mission is the conditional Yaogan-50 03 scenario for **2026-10-23, T0 10:15 UTC**, from Taiyuan LC-9A. This is **not an SSO mission**. The Zhuque SSO reconstruction is a visualization reference, not a source of CZ-6A engine, staging or orbital assumptions.

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
- Drag the globe to rotate and scroll to zoom. Camera presets and vehicle-follow mode are available. Hover the trajectory for MET/altitude; click to seek.
- Click city labels or open **Observer sky chart** and enter coordinates. It shows ascent and orbital passes, Sun/Moon, stars, and optional constellation/Milky Way layers.
- Toggle the sunlit-plume illustration, NOTAM polygons, ground tracks, city lights and solar contours. Turning off the plume does not hide the ascent.
- **Borders & regions** is enabled by default: country borders and first-level state/province/region lines, including China's provinces. Country borders are stronger than regional lines; source-classified disputed/control lines are dashed. The checkbox or `?borders=0` hides both administrative levels. These are generalized cartographic reference lines, not authoritative sovereignty boundaries.
- The **green 15° circle** is enabled by default and follows the vehicle's current position and altitude. Its checkbox or `?fp=0` can turn it off. The ascent visibility envelope and Twilight jellyfish information panel are no longer displayed or computed by the viewer.
- **Copy link** restores profile, mission, T0, numeric MET (including negative times), camera, speed, layer toggles and an open observer site. Height is fixed at true scale (×1). Panel visibility is a per-browser convenience; blocked storage is tolerated.
- Live clock operates only within the modeled time span; it does not extrapolate a flight outside the data.

Example:

```text
?profile=retrograde-142&mission=yaogan50-03&t0=10:15:00&met=300&sky=30.66,104.07
```

## Current configuration

| Quantity | Conditional value |
|---|---:|
| Insertion inclination | 142.0017° |
| Osculating perigee × apogee | 714.1 × 957.2 km |
| Insertion | T+779.98 s, about 10:28 UTC |
| Sunlight pickup | T+106.07 s, 40.55 km WGS84 altitude |
| Playback end | T+9926.32 s, about 13:00:26 UTC |
| Orbit coverage after insertion | 1.5 × 6097.5577 s |
| Hazard polygon | A5283/26, booster drop zone |
| Published hazard interval | 10:07–10:28 UTC |

“1.5 revolutions” means 1.5 times the insertion Keplerian period in elapsed time. The source orbit includes J2, so this does not claim an exact repeating ground track or true-anomaly recurrence. The 09:30–11:00 T0 slider range is for exploration; **it is not an announced launch window**.

### Scientific limitations

The current trajectory transfers a prior-flight template and orbit-family priors; it is not October telemetry and the fit residual is not a prediction confidence interval. The dogleg is attributed to **stage 1**, and the supplied NOTAM to **boosters**. The numerical surrogate has **not been refitted to that corrected physical staging sequence**. Consequently, no timed dogleg, staging, separation, debris trajectory or impact event is invented in the viewer. Older stage-specific column values in the archived source CSV are numerical-model decomposition, not validated physical event assignments.

The exporter resamples the existing solution; it does not fit or integrate a new launch. T0 shifts leave the Earth-fixed trajectory unchanged. The TLE is explicitly **PRELAUNCH MODEL — NOT OBSERVED**, with placeholder catalog number 00000; the page displays numerical samples rather than propagating that TLE.

### Illumination and visibility

- Sun vectors come from **JPL DE440s**, geometric Earth-to-Sun positions in ITRS/ECEF, at 30-second cadence. Linear interpolation covers all allowed T0/MET combinations, including the prelaunch interval; no extrapolation is allowed.
- Sunlight requires the vehicle-to-Sun-centre segment to miss the WGS84 ellipsoid. There is **no 34′ refraction adjustment**. The first pickup agrees with the source calculation to within 0.001 s; this is an export consistency check, not predictive timing accuracy.
- The instantaneous **15° circle** is a spherical minimum-elevation footprint, drawn dashed green (`#199e70`). It has no observer-night mask and is not an accumulated ascent envelope. The globe's **solid yellow Sun 0°** and **solid cyan Sun −12°** contours move with playback UTC.
- Source-model visibility-analysis helpers remain available for validation, but the viewer neither loads the visibility worker nor draws its fill, boundary or labels. The archived method unions sunlit-ascent samples with vehicle elevation ≥15° and observer Sun ≤0° at the same time, with an additional insertion-time darkness mask.
- Sky-chart pass badges count sampled time with a sunlit vehicle, elevation ≥15°, and observer Sun ≤0°. They include ascent and orbital passes and are independent of the instantaneous circle. AOS/LOS are drawn at a 1° elevation threshold.
- Glow is an illustration, not a prediction of plume size, persistence, brightness or detectability. No terrain, weather, extinction, refraction or finite-disc emergence is modeled.
- Physics and look angles use WGS84 km; the textured globe is spherical for drawing, with heights at true scale. Moon and star rendering use approximate astronomy.

## Files and reproducibility

- `docs/index.html`: static page and styling.
- `docs/js/app.js`: scene and controls; `profile.js`: validation, tracks and geometric sunlight; `astro.js`, `skychart.js`: astronomy and observer charts. `visibility*.js` are retained source-model analysis helpers, not loaded by the viewer.
- `docs/data/profiles.json`: profile/mission manifest, with explicit defaults.
- `docs/data/boundaries.json`: compact global Natural Earth country and first-level regional lines, drawn into the Earth texture below the trajectory and markers. `docs/js/boundaries.js` handles wrapping, validation and neutral line styling.
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

Tests, using Node 22+ and the astronomy environment:

```sh
npm test
~/.venvs/astro313/bin/python -I tests/test_exporter.py
# With the local HTTP server running and Chrome installed:
node tests/browser.mjs
```

Set `CHROME` to another Chrome executable and `VIEWER_URL` to another local server address if needed. Browser tests launch an isolated temporary profile, use Chrome's default graphics path, and write screenshots/results under ignored `.test-artifacts/`. They do not alter the user's Chrome profile.

## GitHub Pages

The viewer is published at **https://exoplanet5.github.io/CZ-6A/**. GitHub Pages serves `main` → `/docs`, including `.nojekyll`. Future updates deploy when changes reach `main`.

## Credits and sources

Illustration: Mickey. NASA Blue Marble Next Generation / Black Marble base textures. Administrative boundaries: [Natural Earth](https://www.naturalearthdata.com/), public domain; source revision and attribution are preserved in `docs/data/BOUNDARIES-LICENSE.txt` and `boundaries.json`. Three.js is vendored with its MIT license (`docs/vendor/three/LICENSE`). Star catalog and Milky Way data are from d3-celestial, BSD-3 (`docs/data/STARDATA-LICENSE.txt`). Sky-chart and viewer components are adapted from [ZhuQue](https://github.com/exoplanet5/ZhuQue) and [Starship IFT-14](https://github.com/exoplanet5/Starship-IFT14), with CZ-6A profile loading, geometric illumination, optional events/tracks and responsive controls added here. Code license: Apache-2.0, see `LICENSE`.

The initial scientific source is the local `launch_traj_6A_reverse` reconstruction and supplied NOTAM A5283/26, issued 2026-10-17. The Yaogan-50 02 launch-time reference is [Next Spaceflight's March 15 flight record](https://nextspaceflight.com/launches/details/8186), also documented by [SciNews/CCTV](https://www.youtube.com/watch?v=L0gIO7TAA4g). Derived precursor orbit-family parameters inform the model; raw catalog downloads are not redistributed. This is an independent visualization, not official launch guidance or an official ephemeris.
