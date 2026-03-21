/**
 * satellites.js — ConstellationTracker
 *
 * Fetches Two-Line Element (TLE) data from CelesTrak, propagates satellite
 * positions locally using satellite.js (SGP4), and renders each satellite
 * as a small + cross on the 3D globe, with faint orbital plane rings.
 *
 * No per-tick API calls — positions are computed locally every 30 s.
 * TLEs are refreshed from CelesTrak every 6 hours.
 *
 * Orbital rings are drawn by propagating a representative satellite through
 * one full orbital period, converting all ECI positions using the *current*
 * GMST (frozen Earth orientation). This traces the orbit as a circle in space
 * rather than a spiraling ground track, and is guaranteed to pass through the
 * satellite's current position (at t=now, same propagation + same gmst as the
 * cross marker).
 *
 * Ring occlusion: the Maps 3D API cannot depth-test polylines against the
 * Earth globe at orbital altitude. We cull manually: for each ring point, cast
 * a ray from the camera to the point and test intersection with a sphere of
 * radius 6371 km. Occluded points are skipped; visible runs become separate
 * arc polylines. Arcs are rebuilt on camera change (debounced 150 ms).
 */

class ConstellationTracker {
  // options.group      — CelesTrak group name (default: 'gps-ops')
  // options.showRings  — draw orbital rings (default: true)
  // options.crossArmKm — half-arm length in km (default: 300)
  // options.tleTtlMs   — TLE refresh interval in ms (default: 6h)
  constructor(map3d, color = 'rgba(100, 220, 255, 0.90)', options = {}) {
    this.map         = map3d;
    this.color       = color;
    this._group      = options.group      ?? 'gps-ops';
    this._showRings  = options.showRings  ?? true;
    this._crossArmKm = options.crossArmKm ?? 300;
    this._tleTtlMs   = options.tleTtlMs   ?? 6 * 60 * 60 * 1000;
    this._crossLines = [];   // Polyline3DElement for satellite crosses
    this._ringLines  = [];   // Polyline3DElement for orbital arcs (variable — culled)
    this._ringPts    = [];   // cached ring geometry: [[ {lat,lng,altitude}, ... ], ...]
    this._satrecs    = [];   // [{ name, satrec }]
    this._visible    = false;
    this._onReady    = null;
    this._onError    = null;
    this._posTimer   = null; // 30s position-update interval
    this._tleTimer   = null; // TLE-refresh interval
    this._cameraEcef  = null;  // [x,y,z] metres — set by setCameraFromMap()
    this._camPending  = false; // true when a rAF ring redraw is queued
  }

  // One-shot callback fired after the first successful render.
  onceReady(cb) { this._onReady = cb; }

  // One-shot callback fired if the initial TLE fetch fails.
  onceError(cb) { this._onError = cb; }

  async show() {
    if (this._visible) return;
    this._visible = true;
    // Seed camera position before first draw so arcs are culled from the start.
    this.setCameraFromMap(this.map);
    const ok = await this._fetchTLEs();
    if (!ok) {
      this._visible = false;
      if (this._onError) { const cb = this._onError; this._onError = null; cb(); }
      return;
    }
    await this._propagateAndDraw();
    this._startTimers();
    if (this._onReady) { const cb = this._onReady; this._onReady = null; cb(); }
  }

  hide() {
    this._visible = false;
    this._onReady = null;
    this._onError = null;
    clearInterval(this._posTimer); this._posTimer = null;
    clearInterval(this._tleTimer); this._tleTimer = null;
    this._camPending = false;
    this._clearCrossLines();
    this._clearRingLines();
    this._ringPts = [];
  }

  // Called from app.js on every camera change event. Computes camera ECEF from
  // map.cameraPosition (beta) and triggers a debounced ring redraw.
  setCameraFromMap(map) {
    if (!map.center) return;
    const camPos = map.cameraPosition;
    const lat = (camPos?.lat      ?? map.center.lat) * Math.PI / 180;
    const lng = (camPos?.lng      ?? map.center.lng) * Math.PI / 180;
    const alt =  camPos?.altitude ??
      ((map.center.altitude || 0) + (map.range || 0) * Math.cos((map.tilt || 0) * Math.PI / 180));
    const R = 6371000, r = R + alt;
    this._cameraEcef = [
      r * Math.cos(lat) * Math.cos(lng),
      r * Math.cos(lat) * Math.sin(lng),
      r * Math.sin(lat),
    ];
    if (!this._visible) return;
    if (!this._camPending) {
      this._camPending = true;
      requestAnimationFrame(() => {
        this._camPending = false;
        this._redrawRings();
      });
    }
  }

  async _fetchTLEs() {
    try {
      const res = await fetch(`${WORKER_URL}/tle?group=${this._group}`);
      if (!res.ok) { console.warn(`UGO: ${this._group} TLE HTTP`, res.status); return false; }
      const text  = await res.text();
      const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
      this._satrecs = [];
      for (let i = 0; i + 2 < lines.length; i += 3) {
        const name  = lines[i];
        const line1 = lines[i + 1];
        const line2 = lines[i + 2];
        if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
        this._satrecs.push({ name, satrec: satellite.twoline2satrec(line1, line2) });
      }
      console.log(`UGO: loaded ${this._satrecs.length} ${this._group} TLEs`);
      return this._satrecs.length > 0;
    } catch (e) {
      console.warn(`UGO: ${this._group} TLE fetch failed`, e);
      return false;
    }
  }

  async _propagateAndDraw() {
    if (!this._visible || this._satrecs.length === 0) return;
    const { Polyline3DElement, AltitudeMode } = await google.maps.importLibrary('maps3d');
    this._clearCrossLines();
    this._clearRingLines();
    this._ringPts = [];
    const now  = new Date();
    const gmst = satellite.gstime(now);

    for (const { satrec } of this._satrecs) {
      const result = satellite.propagate(satrec, now);
      if (!result.position) { if (this._showRings) this._ringPts.push([]); continue; }

      const geo  = satellite.eciToGeodetic(result.position, gmst);
      const lat  = satellite.degreesLat(geo.latitude);
      const lng  = satellite.degreesLong(geo.longitude);
      const altM = geo.height * 1000;
      for (const pts of this._buildCross(lat, lng, altM)) {
        const line = new Polyline3DElement({
          strokeColor:           this.color,
          strokeWidth:           2,
          altitudeMode:          AltitudeMode.ABSOLUTE,
          drawsOccludedSegments: false,
        });
        line.path = pts;
        this.map.appendChild(line);
        this._crossLines.push(line);
      }
      if (this._showRings) this._ringPts.push(this._buildRingPts(satrec, now, gmst));
    }

    if (this._showRings) this._redrawRings();
  }

  // Propagate satrec through one full period at N steps, using frozen gmst so
  // the orbit traces a circle in ECEF space rather than a spiraling ground track.
  // Returns [{lat, lng, altitude}, ...] — the point at i=0 matches the cross marker.
  _buildRingPts(satrec, now, gmst) {
    const periodMs = (2 * Math.PI / satrec.no) * 60 * 1000;
    const N  = 180;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const t      = new Date(now.getTime() + (i / N) * periodMs);
      const result = satellite.propagate(satrec, t);
      if (!result.position) continue;
      const geo = satellite.eciToGeodetic(result.position, gmst);
      pts.push({
        lat:      satellite.degreesLat(geo.latitude),
        lng:      satellite.degreesLong(geo.longitude),
        altitude: geo.height * 1000,
      });
    }
    return pts;
  }

  // Rebuild ring polylines from stored _ringPts using current camera culling.
  // Called on every camera change (via rAF) and after each 30s propagation.
  async _redrawRings() {
    if (!this._visible || this._ringPts.length === 0) return;
    const { Polyline3DElement, AltitudeMode } = await google.maps.importLibrary('maps3d');
    this._clearRingLines();
    for (const pts of this._ringPts) {
      if (pts.length === 0) continue;
      for (const arc of this._buildVisibleArcs(pts)) {
        const line = new Polyline3DElement({
          strokeColor:           'rgba(100, 220, 255, 0.18)',
          strokeWidth:           1,
          altitudeMode:          AltitudeMode.ABSOLUTE,
          drawsOccludedSegments: false,
        });
        line.path = arc;
        this.map.appendChild(line);
        this._ringLines.push(line);
      }
    }
  }

  // Split a ring's point array into visible arc segments, discarding points
  // occluded by Earth. Falls back to the full ring before camera state is known.
  _buildVisibleArcs(pts) {
    if (!this._cameraEcef) return [pts];
    const cam  = this._cameraEcef;
    const segs = [];
    let cur    = [];
    for (const pt of pts) {
      if (this._isOccluded(cam, this._llaToEcef(pt.lat, pt.lng, pt.altitude))) {
        if (cur.length >= 2) segs.push(cur);
        cur = [];
      } else {
        cur.push(pt);
      }
    }
    if (cur.length >= 2) segs.push(cur);
    return segs;
  }

  // Ray-sphere intersection: returns true if Earth (sphere R=6371 km at origin)
  // lies between camera cam=[x,y,z] and orbital point pt=[x,y,z] (metres).
  _isOccluded(cam, pt) {
    const R  = 6371000;
    const dx = pt[0] - cam[0], dy = pt[1] - cam[1], dz = pt[2] - cam[2];
    const dd = dx*dx + dy*dy + dz*dz;
    const cd = cam[0]*dx + cam[1]*dy + cam[2]*dz;
    const cc = cam[0]*cam[0] + cam[1]*cam[1] + cam[2]*cam[2];
    const disc = cd*cd - dd*(cc - R*R);
    if (disc < 0) return false;          // ray misses Earth
    const t = (-cd - Math.sqrt(disc)) / dd;
    return t > 1e-3 && t < 1;           // near intersection is between camera and point
  }

  // Convert geodetic (degrees, metres) to ECEF [x,y,z] metres (spherical Earth).
  _llaToEcef(lat, lng, altM) {
    const R = 6371000, r = R + altM;
    const φ = lat * Math.PI / 180, λ = lng * Math.PI / 180;
    return [
      r * Math.cos(φ) * Math.cos(λ),
      r * Math.cos(φ) * Math.sin(λ),
      r * Math.sin(φ),
    ];
  }

  // Returns two [south→north] and [west→east] path arrays forming a + cross.
  _buildCross(lat, lng, altM) {
    const ARM_KM = this._crossArmKm;
    const cosLat = Math.cos(lat * Math.PI / 180);
    const dLat   = ARM_KM / 111.32;
    const dLng   = ARM_KM / (111.32 * cosLat);
    return [
      [{ lat: lat - dLat, lng,             altitude: altM },
       { lat: lat + dLat, lng,             altitude: altM }],  // N-S
      [{ lat,             lng: lng - dLng, altitude: altM },
       { lat,             lng: lng + dLng, altitude: altM }],  // E-W
    ];
  }

  _clearCrossLines() {
    this._crossLines.forEach(l => l.parentNode?.removeChild(l));
    this._crossLines = [];
  }

  _clearRingLines() {
    this._ringLines.forEach(l => l.parentNode?.removeChild(l));
    this._ringLines = [];
  }

  _startTimers() {
    // Re-propagate positions locally every 30 s (no network call).
    this._posTimer = setInterval(() => {
      if (this._visible) this._propagateAndDraw();
    }, 30_000);

    // Refresh TLEs at the configured interval.
    this._tleTimer = setInterval(async () => {
      if (!this._visible) return;
      if (await this._fetchTLEs()) this._propagateAndDraw();
    }, this._tleTtlMs);
  }
}
