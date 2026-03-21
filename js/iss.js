/**
 * SatTracker — shows the ISS as a 3-D wireframe model on the globe.
 *
 * Fetches a single TLE from CelesTrak and propagates position locally using
 * satellite.js (SGP4). No per-tick API calls — position is computed every 5 s.
 * TLE is refreshed every 2 hours (ISS at ~410 km LEO drifts faster than GPS).
 *
 * ISS_SCALE multiplies real dimensions so the model is visible at orbital
 * distance. Real truss ≈ 109 m; at scale 100 that becomes ~10.9 km.
 */
const ISS_SCALE = 100;

class SatTracker {
  constructor(map3d, color) {
    this.map      = map3d;
    this.color    = color;
    this._lines   = [];
    this._satrec  = null;    // parsed TLE satrec
    this._posTimer = null;   // 5s propagation interval
    this._tleTimer = null;   // 2h TLE refresh interval
    this._visible  = false;
    this.lastPos   = null;
    this._onReady  = null;
    this._hasDrawn = false;
  }

  // Register a one-shot callback fired after the first position is rendered.
  onceReady(cb) { this._onReady = cb; }

  async show() {
    if (this._visible) return;
    this._visible = true;
    const ok = await this._fetchTLE();
    if (!ok) { this._visible = false; return; }
    this._propagateAndDraw();
    this._startTimers();
  }

  hide() {
    this._visible  = false;
    this._hasDrawn = false;
    this._onReady  = null;
    clearInterval(this._posTimer); this._posTimer = null;
    clearInterval(this._tleTimer); this._tleTimer = null;
    this._clearLines();
  }

  async _fetchTLE() {
    try {
      const res = await fetch(`${WORKER_URL}/tle?group=stations`);
      if (!res.ok) { console.warn('UGO: ISS TLE HTTP', res.status); return false; }
      const lines = (await res.text()).trim().split('\n').map(l => l.trim()).filter(Boolean);
      // Find ISS by NORAD ID 25544 (appears on line 1 as "1 25544U ...")
      for (let i = 0; i + 2 < lines.length; i += 3) {
        if (lines[i + 1].startsWith('1 25544')) {
          this._satrec = satellite.twoline2satrec(lines[i + 1], lines[i + 2]);
          console.log('UGO: ISS TLE loaded');
          return true;
        }
      }
      console.warn('UGO: ISS TLE not found in stations group');
      return false;
    } catch (e) {
      console.warn('UGO: ISS TLE fetch failed', e);
      return false;
    }
  }

  _propagateAndDraw() {
    if (!this._visible || !this._satrec) return;
    const now    = new Date();
    const gmst   = satellite.gstime(now);
    const result = satellite.propagate(this._satrec, now);
    if (!result.position) return;
    const geo  = satellite.eciToGeodetic(result.position, gmst);
    const lat  = satellite.degreesLat(geo.latitude);
    const lng  = satellite.degreesLong(geo.longitude);
    const altM = geo.height * 1000;
    this.lastPos = { lat, lng, altitudeM: altM };
    this._update(lat, lng, altM);
  }

  _startTimers() {
    this._posTimer = setInterval(() => {
      if (this._visible) this._propagateAndDraw();
    }, 5_000);
    this._tleTimer = setInterval(async () => {
      if (!this._visible) return;
      if (await this._fetchTLE()) this._propagateAndDraw();
    }, 2 * 60 * 60 * 1000);
  }

  async _update(lat, lng, altitudeM) {
    if (!this._visible) return;

    const { Polyline3DElement, AltitudeMode } = await google.maps.importLibrary('maps3d');

    this._clearLines();

    const isFirst = !this._hasDrawn;
    this._hasDrawn = true;
    this._lines = this._buildISS(lat, lng, altitudeM).map(pts => {
      const line = new Polyline3DElement({
        strokeColor:           this.color,
        strokeWidth:           2,
        altitudeMode:          AltitudeMode.ABSOLUTE,
        drawsOccludedSegments: true,
      });
      line.path = pts;
      this.map.appendChild(line);
      return line;
    });

    if (isFirst && this._onReady) {
      const cb = this._onReady;
      this._onReady = null;
      cb();
    }
  }

  _clearLines() {
    this._lines.forEach(l => l.parentNode?.removeChild(l));
    this._lines = [];
  }

  // Convert local ISS-frame offsets (real metres × ISS_SCALE) to globe coords.
  // dx = east (+) / west (−), dy = north (+) / south (−), dz = up (+) / down (−)
  _pt(lat, lng, altM, dx, dy, dz) {
    const cosLat = Math.cos(lat * Math.PI / 180);
    return {
      lat:      lat  + (dy * ISS_SCALE) / 111320,
      lng:      lng  + (dx * ISS_SCALE) / (111320 * cosLat),
      altitude: altM + (dz * ISS_SCALE),
    };
  }

  _buildISS(lat, lng, altM) {
    const p = (dx, dy, dz) => this._pt(lat, lng, altM, dx, dy, dz);
    const s = [];

    // ── TRUSS (runs east–west, Z = +5 above module centreline) ──────────────
    s.push([p(-54,  0,  5), p(54,  0,  5)]);   // spine
    s.push([p(-54,  3,  5), p(54,  3,  5)]);   // front rail
    s.push([p(-54, -3,  5), p(54, -3,  5)]);   // rear rail
    // Cross-braces at SAW attachment joints and centre
    for (const x of [-41, -28, 0, 28, 41]) {
      s.push([p(x, -3, 5), p(x, 3, 5)]);
    }

    // ── MODULE STACK (runs north–south through the truss centre, Z = 0) ─────
    s.push([p(-2, -38, 0), p(-2,  13, 0)]);   // port wall
    s.push([p( 2, -38, 0), p( 2,  13, 0)]);   // starboard wall
    s.push([p(-2, -38, 0), p( 2, -38, 0)]);   // aft cap (Zvezda end)
    s.push([p(-2,  13, 0), p( 2,  13, 0)]);   // fore cap (Harmony end)
    s.push([p(  0,  0, 0), p(  0,  0,  5)]);  // vertical strut up to truss

    // ── SOLAR ARRAY WINGS (8 panels — 4 pairs at X = ±28 and ±41) ──────────
    // Real dimensions: 35 m tall, 12 m wide. Upper wing extends +Z, lower −Z.
    for (const x of [-41, -28, 28, 41]) {
      const x0 = x - 6, x1 = x + 6;
      // Upper wing rectangle + midline
      s.push([p(x0, 0, 5), p(x1, 0, 5), p(x1, 0, 40), p(x0, 0, 40), p(x0, 0, 5)]);
      s.push([p(x0, 0, 22), p(x1, 0, 22)]);
      // Lower wing rectangle + midline
      s.push([p(x0, 0, 5), p(x1, 0, 5), p(x1, 0, -30), p(x0, 0, -30), p(x0, 0, 5)]);
      s.push([p(x0, 0, -12), p(x1, 0, -12)]);
    }

    // ── ZVEZDA MINI-WINGS (small panels at aft end, extend east–west) ───────
    const sy = -32;
    s.push([p(-15, sy, 0), p(-5, sy, 0)]);
    s.push([p(  5, sy, 0), p(15, sy, 0)]);

    return s;
  }
}
