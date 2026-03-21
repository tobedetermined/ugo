# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test          # run tests once (vitest)
npm run test:watch  # watch mode
```

No build step — the app is vanilla HTML/CSS/JS served directly. Run locally with any static file server (e.g. `npx serve .` or VS Code Live Server on port 8080).

The Cloudflare Worker backend lives in `worker/index.js` and is deployed separately via Wrangler. It is not part of the frontend build.

## Architecture

UGO is a single-page app built on the Google Maps 3D API (`Map3DElement`, `maps3d` library). No framework, no bundler.

### Frontend (`index.html` + `js/`)

Scripts are loaded in order and execute globally:

| File | Role |
|------|------|
| `js/app.js` | Entry point. Owns `map`, UI state machine, all button wiring, camera event listeners, `_toggleGPS()`. Calls `initMap()` as the Maps API callback. |
| `js/recorder.js` | `UGORecorder` — samples camera state at 200ms intervals during recording, stores `CameraFrame[]` |
| `js/visualizer.js` | Renders recorded path as `Polyline3DElement` (eye path) + optional `Polygon3DElement` (extruded curtain) |
| `js/kml.js` | KML export/import; also handles the `?ugo=` URL param for shared UGOs (fetches from worker) |
| `js/gist.js` | Save/load UGOs to the Cloudflare Worker backend |
| `js/iss.js` | `SatTracker` — ISS tracking via wheretheiss.at API, renders a wireframe ISS model using `Polyline3DElement` |
| `js/satellites.js` | `ConstellationTracker` — GPS constellation (see below) |
| `js/welcome.js` | Welcome animation shown on first visit |

### Camera state

The Maps API exposes camera as properties on `Map3DElement`:
- `map.center` — `{lat, lng, altitude}` — the *look-at* point, not the eye
- `map.range` — distance from camera eye to center, in metres
- `map.tilt` — degrees from nadir (0 = straight down)
- `map.heading` — compass bearing clockwise from north
- `map.cameraPosition` (beta) — actual eye position `{lat, lng, altitude}` — more reliable than deriving from center+range+tilt

Camera change events: `gmp-centerchange`, `gmp-rangechange`, `gmp-tiltchange`, `gmp-headingchange`. All four are wired to `_updateCameraReadout()` in `app.js`.

### Recording data model

```javascript
// One captured frame
{ timestamp, center: {lat, lng, altitude}, range, tilt, heading }

// Stored recording (in KML <value> CDATA as JSON)
{ segments: [frames[]], metadata: { boundingBox, totalDurationMs, distance, motionType } }
```

Eye position is derived: `eyeAlt ≈ center.altitude + range × cos(tilt)`.

### Rendering

Everything is appended as children of `Map3DElement`:
- `Polyline3DElement` with `AltitudeMode.ABSOLUTE` for paths, satellite crosses, orbital rings
- `Polygon3DElement` with `extruded: true` for the curtain fill
- `drawsOccludedSegments` only depth-tests against terrain, not the Earth globe at orbital altitude

### Backend (Cloudflare Worker — `worker/index.js`)

Serves:
- `GET /api/gallery` — list of saved UGOs from R2 bucket `UGO_PATHS`
- `GET /api/ugo/:id` — fetch a single UGO's KML
- `POST /api/save` — save a new UGO
- ISS position proxy (cached 30s)

R2 buckets: `UGO_PATHS` (KML files as `.path.json`), `UGO_GALLERY` (visibility metadata), `UGO_GEOCODES` (reverse-geocoded location labels).

## GPS Constellation (`js/satellites.js`)

`ConstellationTracker` renders 32 GPS satellites + orbital rings with no per-tick API calls.

**Pipeline:**
1. Fetch TLEs from CelesTrak (`gp.php?GROUP=gps-ops&FORMAT=tle`) — refreshed every 6h
2. `satellite.twoline2satrec()` → `satellite.propagate(satrec, now)` → ECI position (TEME frame, km)
3. `satellite.gstime(now)` → GMST → `satellite.eciToGeodetic(pos, gmst)` → lat/lng/height
4. Render as `Polyline3DElement` crosses (300 km arms) and orbital ring arcs

**Orbital rings:** Each satellite gets its own ring by propagating through one full period (`2π / satrec.no × 60 × 1000` ms) at 180 steps using a **frozen GMST**. Frozen GMST traces a circle in ECEF space (not a spiraling ground track) and guarantees the ring passes through the satellite's cross at step i=0.

**Occlusion culling (manual):** The Maps API cannot depth-test polylines against the globe at orbital altitude. Rings are culled with a ray-sphere intersection test per point (camera ECEF → ring point ECEF, sphere R=6371000 m). Visible consecutive runs become separate arc polylines. Arcs rebuild on camera change via `requestAnimationFrame` (rate-limited with `_camPending` flag). Camera ECEF is read from `map.cameraPosition`.

**Dependency:** `satellite.js` v6.0.2 loaded from CDN before `satellites.js`.

## Google Maps API key

`config.js` (git-ignored) can override the default key via `window.GOOGLE_MAPS_DEV_KEY`. The fallback key in `index.html` is restricted to production. For local dev, create `config.js`:
```javascript
window.GOOGLE_MAPS_DEV_KEY = 'YOUR_LOCALHOST_KEY';
```
