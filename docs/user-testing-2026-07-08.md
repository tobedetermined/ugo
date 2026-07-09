# UGO user-testing findings — 2026-07-08

Tester: Enzo (Claude Code session in the enzo repo, driving Brave via the Claude
extension), at Alex's request: "test out the different user stories through the
app, as if you were a user." Live site (https://usergeneratedorbit.com), desktop
Brave, 1512×786 viewport, mouse + keyboard. Several runs: cold load, controls
help, record→stop→fill→clear, save/load, destination search, gallery, sightings.

## What's genuinely good (keep)

- **The opening scene.** Cold start into the blue atmospheric limb, then the Bay
  Area resolves with "WELCOME TO UGO" drawn as red wireframe flight-path letters.
  It teaches the medium (paths in 3D space) before a single word of UI. First-rate.
- **Destination search transit.** Typing "Amsterdam" produces a cinematic
  zoom-out-to-globe → transit → descend-into-the-city flight, ending on a
  beautiful oblique city view. This is the single most delightful interaction in
  the app — it *is* the product pitch, animated.
- **The rendered path.** Once visible, the red path arcing down through the
  atmosphere is exactly the "shape of your curiosity" the about page promises.
- **Controls modal.** Terse, complete, honest (keyboard + trackpad columns).
- **Gallery cards.** Mini-globe thumbnail + "somewhere → Benschop, NL" + date /
  duration / km is a great compression of a flight.
- **Sightings page.** The filled-curtain screenshots are spectacular — they sell
  the FILL feature far better than the live app currently does (see finding 1).

## Findings (ranked)

### 1. The reveal moment is missing — the app never shows you your own shape
After STOP, the status flips to "UGO rendered" but the camera stays exactly where
the user stopped — sitting at the end of (or inside) their own path, where the
path is invisible or nearly so. I only discovered my orbit by manually flying
away, at which point it was gorgeous. A first-time user who presses STOP, sees
nothing change on the canvas, and reads "rendered" will conclude it's broken.
**Suggestion:** on STOP, auto-fly to a vantage that frames the whole path (fit
the path's bounding sphere, pull back ~2×, slight orbit drift), the way the
about page's step 03 ("See your shape") already promises. This is the single
highest-leverage fix in the app: it converts the core promise from something the
user must stumble into, into the climax of every flight.

### 2. SAVE and LOAD are silent — no feedback, no visible effect
Clicking SAVE (with a rendered UGO) produced: no dialog, no toast, no status
change, no download, and **zero network requests** (verified via devtools-level
network capture on the second click; the worker `/api/save` was never called).
Clicking LOAD on a fresh session likewise did nothing visible. Either the
buttons are no-ops in this state or they persist to localStorage invisibly —
indistinguishable from broken, from the user's side.
**Suggestion:** every recorder-panel action should change something the user can
see within 300 ms. Minimum: a status-line message ("saved locally" / "nothing to
load"). If SAVE is meant to reach the gallery pipeline (`/api/save`, hidden by
default), say so ("submitted — appears in gallery after review"), which also
explains the gallery's current email-only sharing note.

### 3. Two sharing stories coexist and neither is discoverable
The panel has SAVE/LOAD; the gallery page says "Want to share your UGO? →
alex@usergeneratedorbit.com". As a user I can't tell how a flight becomes a
gallery entry, whether SAVE is related, or what LOAD loads. One sentence of copy
in the panel (or a SHARE button that does the `/api/save` + returns the UGO URL)
would collapse the confusion.

### 4. Keyboard zoom (+/−) didn't work in my hands; scroll wheel works but is undocumented
The controls modal lists `+ / −` for zoom and arrows for move. Arrow keys moved
the camera only barely; 55 presses of `minus` (with canvas focused via click)
produced no perceptible zoom. Meanwhile the mouse **scroll wheel zooms
beautifully** — but isn't listed in the controls modal at all (only "2-finger
drag"). Possible focus-stealing issue after clicking panel buttons (button
retains focus, keys go to the button not the canvas).
**Suggestions:** (a) blur panel buttons after click so keys always reach the
canvas; (b) add "scroll" to the zoom row of the modal; (c) verify +/− handler
fires on both `+`/`=` and numpad keys.

### 5. Recording state gives no evidence of capture
While recording, the panel shows "● Recording…" but nothing counts up — no
elapsed time, no point count, no km. Combined with finding 1 (no reveal), a
user's entire flight produces no visible trace *during or after* unless they
find the path manually.
**Suggestion:** live counter in the status line ("● Recording… 0:42 · 1,204 km").
The gallery cards already show exactly these stats, so the data exists.

### 6. ISS and GPS buttons appear permanently disabled, unexplained
Across all states I reached (ready / recording / rendered), ISS and GPS stayed
grayed out with no tooltip. The repo says these are live features (TLE
propagation via worker proxy). If they need a condition (data loaded, https
geolocation grant), the disabled buttons should say so on hover; if they're
desktop-ready, they may be broken in this state machine.
(Note: I deliberately didn't click GPS to avoid triggering a browser geolocation
permission prompt mid-automation.)

### 7. Small polish
- **Welcome text vs. panel overlap:** on reload at this viewport the tail of
  "…UGO" renders partly behind the recorder panel (right edge). Consider
  centering the text in the *visible* canvas (minus panel width) or drawing it
  before the panel fades in. (Earlier I logged "WELCOME TO UG" as a truncation
  bug — false alarm, the O was still drawing; the animation is just slow enough
  to read as finished-and-wrong for a beat.)
- **Nav contrast:** the top nav links (about/gallery/sightings) render very
  faint over bright terrain; they disappear entirely over the Sierra snow. A
  subtle text-shadow or the search-box's dark chip treatment would fix it.
- **Tab-while-modal:** pressing TAB with the Controls modal open toggles the
  (hidden-behind-modal) panel instead of closing the modal; Esc/Tab should
  probably both dismiss the modal first.
- **FILL toggle state:** FILL highlights when active, but from most camera
  angles (looking down the path) the curtain is invisible, so the toggle feels
  like a no-op. If finding 1's reveal move ships, FILL becomes legible for free.

## Not tested (left for a UGO-repo session)
- Mobile/touch (recent commits show active mobile work).
- GPS flow (permission prompt — see above), ISS follow.
- Gallery `edit` button; opening an individual gallery UGO (`/orbit`/`/api/ugo/:id`).
- LOAD with a genuinely saved flight in localStorage; RESET semantics vs CLEAR.
- The `D` debug panel and `'` metrics overlay.

## One product-level observation
The about page's three verbs (RECORD / FLY / RENDER) are exactly right, and the
app already does all three — but the *emotional* sequence only completes if the
render is shown to you (finding 1). Everything else on this list is polish;
that one is the product.

## Post-fix addendum (same evening)

Finding 1 (the reveal) was implemented (`e62d9da`), pushed, and verified on the
live site: STOP now auto-flies to the `_overviewCamera` framing and the curtain
is visible without any user action. Two follow-ups noted during verification:
- **Framing tuning:** the path can sit off-center at tilt 55; a later pass could
  bias the framing toward the path or lower the tilt for tall recordings.
- **Deploy caching:** the first verification ran a stale cached `app.js`
  (deploy reached the CDN in ~20 s, but the browser kept the old script until a
  hard reload). Consider versioned asset URLs (`app.js?v=<hash>`) so returning
  visitors pick up changes immediately.
