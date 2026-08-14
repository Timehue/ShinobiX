# Living Chronicle Cohesion and AAA QA Report - August 12, 2026

## Executive assessment

The cohesion and AAA hardening pass is complete for the locally verifiable
product scope. Story combat, companion combat, the Chronicle card game, the
Ancients, and the one hundred Legacies now operate as one fictional and
progression loop without merging their distinct combat engines.

All final local release gates are green: the full repository suite, production
build and size budget, built-server certification, immutable seven-project
Playwright matrix, real Express Solo-PvE journeys, TypeScript, lint, dependency
audits, and worktree hygiene. No unresolved P0 or P1 defect is known in the
reviewed local scope.

This is a local release certificate, not proof of production infrastructure.
Postgres/Supabase, multi-replica realtime, deployed credentials, backups,
telemetry delivery, and Node 22 parity still require staging or CI evidence.

## Cohesion result

The governing canon is:

> Combat makes the deed; companions witness it; the Chronicle preserves it; a
> Legacy is the pattern a shinobi chooses to repeat.

This rule is established in `docs/world-cohesion.md` and
`docs/story-bible.md`, then carried into progression, rewards, dialogue, card
lore, and result ceremonies.

### Canon contract

- The Ancients were ordinary people of the Sunken Court era, not gods,
  prehuman beings, or spirits.
- The Withheld were Ancients who refused the Court's extraction of a defining
  choice.
- Their resistance left exactly one hundred recognizable patterns of action:
  the one hundred Legacies, represented by the shrine's one hundred glyphs.
- A Legacy is a freely repeated pattern confirmed through witnessed deeds. It
  is never a Bloodline, gene, soul, reincarnation, ancestor, or fate installed
  by the Sage.
- A Chronicle card is a portable record, never the trapped soul or living
  essence of the person or companion it depicts.

### Player-facing progression loop

1. **Story combat creates evidence.** A server-sealed boss victory can press
   that boss's Chronicle record. Story choices bias later Legacy recognition
   without predetermining it.
2. **A companion witnesses the road.** An eligible active companion can be
   summoned into current story-boss combat. Authoritative Pet Arena wins now
   show exact Living Witness progress from 1/10 through card pressing at 10/10.
3. **The Chronicle preserves the evidence.** The reviewed catalog maps all
   story bosses, all one hundred Legacies, the Wandering Sage, and five fixed
   Living Witness companions. These server-derived records do not consume the
   ordinary pack inventory cap.
4. **Chronicle play becomes new evidence.** Verified Chronicle wins feed the
   Legacy activity record. Free-Play duration, action, repeat-opponent, and
   reciprocal-farming rules prevent manufactured recognition.
5. **The player chooses the meaning.** Sage acceptance and Awakening can press
   the Sage and matching Legacy records, but recognition never removes the
   player's right to refuse the reading.

The Card Hall presents this as a four-step Living Chronicle spine. Story,
Legacy, and companion rewards use explicit receipt ceremonies, so each mode
reinforces the others while keeping its own mechanics and pacing.

## Major authority, economy, and reliability repairs

- **Story settlement:** boss starts, actions, settlement, retries, account
  identity, and Chronicle rewards are server sealed and replay-safe. Stale
  account responses cannot unlock a new account's story.
- **Mission combat:** terminal HP, physical loss/flee state, reward receipts,
  and save versions reconcile atomically. Regen and autosave pause while a
  Mission fight is unresolved. Hospital discharge commits authority before
  navigation evaluates admission state.
- **Chronicle Free-Play:** queue pairing fails closed under lock; forfeits and
  non-meaningful games grant no farmable Legacy evidence; durable outbox
  receipts repair delivery after response loss.
- **Chronicle progression:** all one hundred Legacies and reviewed story
  sources map exactly once; starter and progression cards cannot bypass the
  packable collection cap; sync is server-derived and idempotent.
- **Ranked companion battles:** reciprocal queue consent, deterministic
  initiation, a two-player active registry, and durable settlement intents
  prevent forced ladder matches, duplicate starts, and one-sided partial
  settlement after proof expiry.
- **Companion Warfront:** the server owns the seed, policy, reward, frozen blue
  and red rosters, active pointer, resume state, proof, and sole initializer.
- **Living Witness:** counted wins produce a bounded authoritative progress
  receipt. Replays never increment twice or restage the 10/10 ceremony. A
  pre-Card-Hall tenth deed is recorded truthfully for later pressing.
- **Companion expeditions:** launch allowance and pet lease commit atomically;
  a stable UUID launch receipt makes response-loss retries exact; duplicate
  activation cannot spend a second daily allowance.
- **Legacy acceptance/trials:** marker-only acceptance automatically repairs
  its save, Aura, Sage card, trial, Hall, event, audit, Era, and announcement.
  Trial world effects drain from durable receipts on ordinary reads.
- **Save integrity:** exact base-version enforcement, fresh authoritative
  reads, account epochs, authority-generation fences, serialized required
  saves, durable conflict revisions, exact unresolved-post journals, and
  unload protection prevent stale or cross-account overwrites.
- **First-session creation:** achievement backfill now adopts its returned
  character mutation and save version atomically. The prior v1 -> v2 race that
  raised a conflict banner on a new account is covered by regression tests.
- **Storage authority:** save, story, Legacy, Chronicle, pet, PvP, and war
  transactional keyspaces bypass unsafe process-local pgKV reads.
- **Versioned responses:** full-character client hydration is routed through
  account-scoped monotonic commits; server mutation routes echo the exact
  version written under lock.
- **Startup recovery:** a CSP-safe pre-React watchdog provides an accessible,
  explicit latest-game reload when a critical same-origin module fails or boot
  exceeds its deadline. It does not auto-loop and does not weaken entry-size
  measurement.

Representative implementation evidence includes `api/story/_settle.ts`,
`api/card-clash/_progression-cards.ts`,
`api/card-clash/_pet-witness.ts`,
`api/card-clash/_freeplay-legacy.ts`, `api/pet/_ranked-authority.ts`,
`api/pet/battle-result.ts`, `api/pet/_warfront-start-coordinator.ts`,
`api/missions/expedition-start.ts`, `api/legacy/_acceptance.ts`,
`api/legacy/trial.ts`, `api/save/_save-version.ts`, `api/_storage.ts`, and
`shinobij.client/src/lib/save-persistence.ts`.

## Accessibility and presentation result

- Chronicle, Living Witness, story, and Legacy ceremonies have semantic
  dialogs or live regions, focus containment/return, inert backgrounds, and
  viewport-constrained scroll owners.
- Pet result actions remain reachable at mobile landscape and 200%-equivalent
  reflow; settlement/reward actions stay locked until authority is confirmed.
- Direct-body combat collapses ambient help to a non-occluding 44 px Tip
  control. Full help opens in a canonical focus-trapped modal.
- Card Hall selection exposes both visible pressed state and accessible state.
- Pet Yard roster, claim, and expedition interactions are keyboard operable;
  launch is single-flight with a truthful busy state.
- The disabled main-combat pet summon explains the explicit level-50 unlock
  branch instead of presenting every absent seal as a generic failure.
- Responsive combat maintained board/action reachability at 390x844 and
  720x450 in hands-on QA; automated coverage also exercises the 200%-equivalent
  720x450 and 512x384 contracts.

## Verification ledger

### Final green local gates

| Gate | Final result |
|---|---:|
| Full repository automated suite | **5,519/5,519 passed**, 822 suites, 0 failed/skipped/cancelled/todo; 806,831.4124 ms |
| Instrumented production build | **PASS** - server, story-content checks, client TypeScript/Vite, `verify:dist`, and `sizecheck` |
| Product JS/CSS hard budget | **7,009,492 B / 7,265,000 B**, 255,508 B headroom; budget unchanged |
| Product JS/CSS gzip | **2,062,747 B** |
| On-demand story JSON | **566,116 B raw / 143,151 B gzip** across four village assets |
| Combined tracked product | **7,575,608 B raw / 2,205,898 B gzip** |
| Distribution verification | **PASS** - 97.9 KB server; 285.3 MB client; no authoring sources |
| Built-server release certification | **87/87 passed**, 17.8 s; port 41987 released |
| Immutable Playwright CI matrix | **96 passed, 0 failed/flaky/retries, 86 intentional skips**, 182 total; seven projects |
| Automated accessibility in that matrix | **14/14 passed**, no asserted serious/critical findings |
| Sentry lazy/fail-open smoke | **PASS** against instrumented immutable bundle |
| Real Express Solo-PvE | **4/4 passed**, desktop/mobile win+flee, 0 retries, 0 page errors, 0 API 5xx |
| Server TypeScript | **PASS** |
| Client app and node TypeScript | **PASS** |
| Client ESLint | **PASS**, zero warnings/errors; only Babel's informational >500 KB processing note for `PetColiseum.tsx` |
| App source budget | **7,726 / 7,727 lines** |
| Root production dependency audit | **0 vulnerabilities** |
| Client production dependency audit | **0 vulnerabilities** |
| `git diff --check` | **PASS**, no whitespace errors; only expected LF/CRLF notices |

The immutable browser artifact contains 3,646 files / 299,110,867 bytes and
has SHA-256
`a79667d3b72b5debfb4861ef1f8394d4180d7cba3cb4b2e172fc19c00ea4b430`.
All preview, runner, worker, browser, release-certification, live-test, and
manual-QA server processes exited, and their exact ports were verified clear.

### Hands-on browser QA

A unique disposable account was created in an isolated in-memory world. The
pass exercised the opening Sunken Court/Hollow Gate narrative, companion
choice, Academy guidance, Story Hall milestone gating, Card Hall gating, Pet
Yard, a complete Pet Coliseum victory, Mission Hall, and real Mission combat.
The same session was inspected at desktop, 390x844 phone, and 720x450 short
landscape sizes.

That pass directly found two issues now fixed and regression-covered:

1. a first-session achievement save-version race that raised the recovery
   banner on a newly created account; and
2. missing 1-9/10 Living Witness feedback after a counted Pet Arena win.

The temporary manual browser and memory server were closed, PID ownership was
verified, and port 41991 was released.

### Worktree hygiene

- User-owned `docs/screenshots/combat-layout/after/**` changes were preserved.
- User-owned untracked `output/` and `tools/` directories were preserved.
- QA evidence directories and immutable snapshots were preserved for review.
- No lockfile changed during dependency restoration; `npm ci` restored the
  lockfile-pinned client test packages and reported zero vulnerabilities.

## Deployment-only checks not verified locally

These require a safe staging or production-like target, credentials, and
operational authority. They remain **UNVERIFIED** even though every local gate
above is green.

- Real Postgres/Supabase persistence, contention, row subscriptions, and a
  demonstrated restore from backup.
- Multi-instance realtime behavior with production topology and representative
  simultaneous players.
- Credentialed fresh-account/live-save smoke against deployed services.
- Authenticated admin and operational tooling.
- External identity, Patreon, and other production integrations.
- Environment-specific Legacy availability and deployment configuration.
- Production telemetry delivery, alert routing, rate behavior, and dashboards.
- Host/CDN headers, rollback execution, and staged deployment promotion.

Local verification ran on Node **24.15.0** / npm **11.12.1**, while CI/release
targets Node **22**. A successful Node 22 CI run remains required for exact
runtime-version parity.

## Release decision

The reviewed game code is locally release-ready: cohesion is implemented,
authority boundaries are server-owned, recovery is explicit, accessibility
gates pass, and all final local regression/release gates are green. Promotion
should still be conditional on the deployment-only checks above; this report
does not describe untested production infrastructure as certified.
