# Stronghold and Hollow Gate resource review

October 12, 2026. Actual React views, terrain, walker, NPC avatars, audio and
stronghold Arena are exercised with disposable local server/character fixtures.

## Changes

- Both click-to-walk queues stop on visibility loss and page-cache navigation.
  Already submitted steps can finish, but the remaining path never continues
  or resumes on return. Stronghold presence heartbeats keep their existing
  multiplayer behavior and stop when the feature unmounts.
- Cave walking is fenced by active screen, floor and run token. A new floor/run
  cancels the old target and timers even when its tile index stays the same.
- Player/NPC glides cancel their frame, queue and walking style on hide, unmount,
  or a live reduced-motion preference change. Frame IDs reset during cleanup so
  React Strict Mode can mount the effect again safely.
- The stronghold raster-window object retains its identity across unchanged
  presence responses. The memoized terrain no longer redraws for actor-only
  heartbeat updates. Existing viewport-bounded SVG rendering remains intact.

## Verification

| Check | Result |
| --- | --- |
| Stronghold exploration/combat/exterior resource audit | 19 checks passed; exact polling/timer cleanup and bounded retained resources |
| Chromium cave/Rift resource audit | 6 scenarios passed; 108 repeated visits; zero listener growth |
| WebKit cave/Rift resource audit | 6 scenarios passed; 108 repeated visits; no leftover feature resources |
| Full canonical CI with Postgres required | **14,784 passed, 0 failed/cancelled/skipped**; temporary cluster removed |
| Production client build, TypeScript, focused lint | Passed |
| Bundle size and generated handoffs | Passed; existing budgets unchanged |
| Final mobile input/frame-pacing matrix | **112 checks passed**, 0 page/asset errors; all 32 movement samples passed the unchanged 100ms p95 gate |

All twelve cave scenarios passed (216 repeated visits), in addition to forty
stronghold exploration/combat cycles and the exterior suspension checks.

Chromium's final cave heaps are 530,008–727,572 bytes above their warmed baseline
after eighteen visits including additional-floor rendering. Intermediate cohorts
show bounded cache warming; listeners grow by zero, detached nodes by only four,
and compositor layers settle at five (warmed baselines are five/six). Final frames, intervals,
feature observers, timers, CSS animations and audio sources/connections are zero.
The app's one global modal observer remains unchanged after feature exits.

The stronghold audit covers twelve exploration entry/exit cycles and eight
combat cycles per normal/Obsidian stronghold, successful and failed settlement,
an in-flight step interrupted by hiding, and exterior suspension/restoration.
Its one app-wide capability lease is expected to outlive feature unmount; the
test requires the exact original timer ID/stack, not merely an equal timer count.

The cave audit covers floors 2/5 and event Rift 3 at 390×844 and 1366×900 in
Chromium/WebKit, eighteen visits per scenario, React Strict Mode, moving NPCs,
floor changes, journal/lore expansion, forfeit and forced unmount. It enables
audio and tests live reduced motion plus synthetic visibility/page-cache events.
Issued moves are counted atomically with visibility dispatch, so an already
submitted React commit cannot be mistaken for another background step.

Chromium compares post-GC heap, DOM listeners/nodes and compositor layers after
warming caches. WebKit checks timers, frames, observers and animation lifecycle.
This Windows WebKit build exposes neither `AudioContext` nor `webkitAudioContext`:
a separate native constructor probe confirmed that limitation. Audio lifecycle
coverage comes from Chromium; WebKit proves the supported silent fallback creates
no audio objects. Audio instrumentation observes actual stop/disconnect calls because
an ended event can wait until a suspended audio context resumes.

## Evidence limits

Both interiors render as SVG/DOM and allocate zero WebGL contexts. Their GPU
work is managed by the browser compositor; stable layers and bounded SVG raster
windows are checked. These tests do not measure physical GPU-driver allocation
or certify every phone. React/Chromium may keep the most recent detached combat
tree; repeated fights must show bounded retention, no growth and no running work.
Shared decoded audio/art caches warm once and are intentionally reused.

A clean resource lifecycle removes a source of progressive lag; network delay,
device limits and browser scheduling can still affect an individual frame.

An initial frame-pacing run overlapped the full CI suite and another WebKit
resource browser. Chromium's sixteen samples passed; the first WebKit stronghold
sample had a 216ms p95 and failed the unchanged 100ms gate. It is retained as
diagnostic evidence, not reported as a passing run. Once those local checks
finished, the same WebKit empty-page control measured 19/20ms p95, with maximum
30/26ms intervals and no hidden/unfocused frames. The final matrix is rerun in
that isolated local condition: all 32 movement samples pass; the highest p95 is
57ms. The longest individual interval is 643ms, so this evidence supports bounded
resources and the existing pacing gate, not a claim that every frame is hitch-free.
Chromium samples use 4× CPU slowdown; WebKit samples use native execution. CPU
measurements are not inferred from leak counters.

## Recorded runs

- [Stronghold lifecycle results](leak-strongholds-final/resource-results.json)
- [Chromium cave lifecycle results](leak-cave-after/chromium-cave-resources.json)
- [WebKit cave lifecycle results](leak-cave-after/webkit-cave-resources.json)
- [Full CI and Postgres cleanup](leak-full-ci.log)
- [Client build](leak-client-build.log), [types](leak-types.log), [focused lint](leak-focused-lint.log)
- [Bundle budgets](leak-size.log), [generated handoffs](leak-handoffs.log)
- [Empty-page WebKit control](leak-webkit-control.json)
- [Isolated movement samples](leak-mobile-isolated/movement-frames.json)
- [Complete mobile results](leak-mobile-isolated/results.json)

## Repeat locally

From `shinobij.client`:

```powershell
node scripts/stronghold-browser-qa.mjs --resources --output=../docs/stronghold/underground-review/leak-strongholds-final
node --import tsx scripts/underground-sector-browser-qa.mjs --resources --output=../docs/stronghold/underground-review/leak-cave-after
```

From the repository root, with the portable PostgreSQL 16 binaries present:

```powershell
npm run test:ci:postgres -- --pg-bin=.tmp/pg-local/pgsql/bin
```
