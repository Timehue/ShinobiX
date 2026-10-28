# Pet Colosseum release and inherited CI repairs

Release base: `20757cab1a5d762d5a19ce1cb0fbd77428712255` (`origin/main`).
Production initially served `663bcd30025c5df83bf7680a0c98d7e6a58174fd`.
The release preserves the village leadership and shared-online Kage challenge
changes already on main and adds the Colosseum balance, presentation, model,
and resource-lifecycle work documented in the companion audit reports.

## CI failures inherited from main

- [Village release CI](https://github.com/Timehue/ShinobiX/actions/runs/34409700099)
  and [Kage release CI](https://github.com/Timehue/ShinobiX/actions/runs/34412933019)
  both failed `api/_world-pvp-mercenary-freeze.test.ts` during its cleanup hook.
  A static mercenary-settlement import now reaches storage through player-save
  authority before the test enables its in-memory backend. It therefore selects
  Supabase and fails for missing credentials. Reproduced locally with Node 22,
  then changed the test to import that graph after setting the test environment.
  The settlement assertions and production storage behavior remain intact.
- The village run also failed `e2e-warfront/coliseum-terminal.spec.ts` after
  re-entry and Replay. Replay reset the clock to `initialTick`, which the fixture
  sets to terminal tick 5000. It briefly exposed playback controls before ending
  again. Replay now resets to zero; initial entry still honors the requested
  position. The browser regression requires the replay clock to reach its first
  five seconds, rather than accepting the fleeting controls that could let the
  old test pass.

No CI assertions, required jobs, or bundle limits were removed or relaxed.

The broader local browser run also exposed an ambiguous Echoes witness selector:
the same sentence appears in the visible dialogue paragraph and its screen-reader
announcement. The assertion now selects the paragraph, retaining the text and
visibility checks without racing the accessibility announcement.
Two layout assertions also sampled transitional geometry: Chronicle checked
immediately after a viewport resize, and the combat dossier read heading and
pill positions in separate animation frames. The former now waits for the same
viewport requirements to hold; the latter measures both boxes in one frame.
The static combat fixture also waits for font metrics, reflow, and finite
entrance animations before measuring its completed layout.

The hosted replay check also exposed a software-rendering constraint: the duel
limits simulation progress per rendered frame, so the desktop preset could
remain below one displayed game second for the entire 30-second assertion
budget. The settlement/replay workflow now selects the shipped Performance
preset, retaining its real clock-progress assertion. The separate GPU resource
lifecycle test continues to exercise low, medium, and high presets.

## Local release validation

- Node 22.23.2 full regression suite: **10,003 / 10,003 passed**, no skipped or
  cancelled tests.
- Full client lint: **0 errors**, 9 existing warnings in other preview/Warfront
  modules.
- Production server/client build, TypeScript, distribution verification, and
  normal bundle gate: passed; product JS/CSS **8,199,205 bytes**.
- Separate client build with the Production Image workflow's public placeholder
  build arguments: passed; product JS/CSS **8,255,311 bytes**, below the existing
  **8,300,000-byte** gate.
- Local isolated Express release certification: **90 / 90 passed**.
- Colosseum terminal settlement/re-entry/replay regression: **6 / 6 passed**,
  with three independent runs each on desktop and phone.
- Targeted dialogue/resize/combat-layout repair checks: **10 eligible cases
  passed** across Chromium, Firefox, and WebKit (the existing Echoes restriction
  skips that scenario in Firefox and WebKit).
- Mission eligibility, release asset decoding/references, one million pet
  breeding probability rolls, and generated tooling handoffs: passed.

The Colosseum lifecycle report records the repeated-round, graphics-quality,
failed-playback, exit/re-entry, and WebGL teardown measurements. Those are finite
observed scenarios, not a claim that every possible browser/device path is free
of leaks. Audit instrumentation is confined to the development preview entry.

Generated builds, local logs, and browser artifacts are retained under the
ignored release worktree output directories; deployment builds from source.
