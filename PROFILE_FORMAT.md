# Profile data contract

The **profile** describes a corridor/orbit family; a **mission** supplies one dated configuration and trajectory. The UI does not infer engine types, burns, drop zones or circularization from inclination. The existing first profile is 142° retrograde. Polar, SSO and low-inclination families are supported as additional data, not fabricated selectable examples.

## Register a profile and mission

1. Generate a validated mission JSON from the appropriate scientific builder, following the contract below. Keep source/provenance files in `profiles/<profile-id>/<mission-id>/`.
2. Put the browser JSON in `docs/data/<mission-id>.json`.
3. Append a profile to `docs/data/profiles.json`, or append a mission under an existing profile. Preserve `default_profile: "retrograde-142"` unless intentionally changing the landing selection. Each profile also specifies `default_mission`.
4. Run the runtime validation and browser tests. Verify the new model's own source/reference calculations, not only the existing mission's tests.

The manifest has `schema_version: 1`, `default_profile`, `supported_families` and a `profiles` array. Each profile has `id`, `label`, `family`, `default_mission` and `missions`. Each mission entry has `id`, `label` and a relative `file` such as `data/yaogan50-03.json`.

The selector remains visible with one profile. `?profile=<id>&mission=<id>` selects a configuration. Unknown IDs fall back to explicit defaults. Selection reloads the page, discarding mission-specific T0/MET/camera/site state while retaining layer preferences; this prevents stale worker results or cached sky-chart geometry from crossing missions.

## Mission object

Top level: `schema_version: 1`, `meta`, `tracks`, `zones`, `events`, `sun`, and optional `tle_ref`. The current mission is a complete working example. Runtime validation is in `docs/js/profile.js`.

### Metadata

- Identity: `title`, `vehicle`, `mission`, ISO `date`, `pad: [longitude, latitude]`, `pad_name`, optional `pad_alt` (km).
- T0 controls: `t0_default`, `t0_min`, `t0_max` as `HH:MM:SS`, with a same-UTC-date interval. `t0_presets` is an array of `{label,time}`. These are scenario bounds, not necessarily NOTAM bounds.
- Orbit context: `inc`, `perigee_km`, `apogee_km`, `period_s`, `insertion_met`, `orbit_revolutions`. The final flight endpoint must equal `insertion_met + period_s * orbit_revolutions` within numerical tolerance. Distinguish osculating versus mean elements in model notes.
- `flight_segments`: ordered track keys, for example `['ascent','orbit']`, or an ascent/coast/orbit sequence. No coast or second burn is required.
- `powered_intervals`: arrays `[start_MET,end_MET]`; drive vehicle illumination styling, not assumed staging events. Supply only justified intervals and qualify surrogate timing in notes.
- `phases`: increasing `{until,label}` entries. Prelaunch is normally `{until:0,label:'Pre-launch'}`; the final label persists to the end.
- `views`: arrays `[label,longitude,latitude,camera_distance]`. Distance is in Earth radii, valid 1.05–14; responsive framing adjusts it on narrow screens.
- `visibility`: `{extent:[west,east,south,north],grid_step_deg,time_step_s,levels:[15]}`. The extent is an explicit bounded analysis region. To cross the dateline, use increasing unwrapped longitudes such as 170–190, not 170 to −170. Longitude span must be ≤360°, latitude limits within ±90°, and grid size ≤200,000 cells. Choose coarser grids for wide polar/global domains; the worker does not make arbitrarily dense grids cheap.
- `notes`: plain-text model assumptions, source attribution, limitations and uncertainty distinctions. Notes are escaped before display.

### Uniform tracks

`tracks` is an object keyed by segment name. Each value has:

```text
met0 : first mission elapsed time, seconds
 dt  : uniform positive time step, seconds (fractional is allowed)
 lon : geodetic longitude array, degrees
 lat : geodetic latitude array, degrees
 alt : WGS84 ellipsoidal altitude array, km
color: #RRGGBB
label: plain display name
```

Each array has at least two finite values, with matching lengths. Adjacent flight segments share endpoint time and position. The first starts at MET zero. A required `ascent` track defines the sunlight-pickup and ascent-visibility interval. Optional additional tracks, such as justified debris trajectories, are drawn independently; do not put them in `flight_segments`. Optional `dashed: true` changes a track's style.

The browser creates separate arrays for geodetic spherical drawing and physical WGS84 Cartesian km. It interpolates the latter for look angles and shadow calculations, avoiding longitude interpolation across ±180°. The scene frame is `[x_ECEF,z_ECEF,-y_ECEF]`, with north along scene +Y. Do not export already-rotated vectors as ECEF.

### Events and zones

`events` is an array of `{met,label,major,kind:'ship'}`. `major` draws a labeled marker; every event appears in the timeline. Optional `track` identifies a supplied non-vehicle track for its marker. Do not manufacture staging or impact times simply to fill the UI. Liftoff uses the pad marker instead of a duplicate label.

`zones` may be empty. Each polygon has `key`, `id`, `role`, `color`, a closed `ring` of `[lon,lat]`, `centroid`, `t0`/`t1` in `HHMM` UTC, and descriptive provenance. `dist_km` and `bearing` may be retained for context. Optional `impact: {met,lon,lat}` is shown only when physically modeled; absence means **Not modeled**, not time zero. A next-day end earlier than the start follows the published UTC interval convention.

### Solar table

`sun` has `start_utc`, `dt` (seconds), `vectors` (geometric Earth-to-Sun **ECEF km**, not unit vectors), and a `model` description. Coverage must include `t0_min − 600 s` through `t0_max + final_MET`. The runtime rejects insufficient coverage; it never extrapolates. Current data uses DE440s at 30 s cadence.

Sunlight uses a finite segment from the WGS84 vehicle position to the solar centre. The visibility worker checks observer darkness and vehicle elevation at the same sample, and clips to darkness at `insertion_met`. This envelope is not a brightness forecast. The solar contours on the textured globe use geodetic normals on its spherical drawing and are visual references; the envelope uses finite-distance, ellipsoidal geometry.

### Optional synthetic TLE

`tle_ref` has reference launch `t0`, `raan_rate_deg_per_min`, and `sets: [{name,l1,l2}]`. Empty/missing sets are supported. Lines must be 69 characters with correct checksums. The epoch and RAAN are retimed for the same Earth-fixed launch geometry; this is not a general refit or independent TLE propagation. Synthetic identity and provisional labeling must remain explicit.

## Exporter scope

`tools/export_profile.py` reproduces **the archived Yaogan-50 03 model only**. Its existing numerical/source validation is mission-specific. Do not repurpose its constants by changing just inclination to pretend to create a polar/SSO mission. Write or adapt a scientific exporter for each new source model and output this common browser contract. Rebuilding the first mission merges its manifest entry while preserving other profiles, missions and defaults.
