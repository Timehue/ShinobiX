# Hollow Gate, Rifts, and Stronghold — Gameplay Expansion Plan

**Status:** First slice implemented; release profiling pending
**Last updated:** 2026-10-01
**Scope:** Implement the approved first slice for Hollow Gate detours, weekly Rift route signals, and a non-economic Stronghold intel objective. Co-op remains discovery only.

**Implementation note:** Server rules and focused regression coverage are in place. The matched-device frame-time comparison and focused browser/device review remain release checks; no numeric FPS gain is claimed from code inspection alone.

## First-slice implementation record

- **Hollow Gate:** the server identifies one existing chest at least four steps off the shortest route, seals that route metadata in the immutable manifest, and returns it consistently on reseal. The client marks the choice and states the route cost and standard chest contents. Old manifests remain unchanged.
- **Rifts:** a shared Monday-UTC rotation is sealed into each new Rift run. Each floor marks one existing chest, battle, or shard vein as route intel. The node, combat, daily offer, and reward remain unchanged; active runs keep their original weekly rule.
- **Stronghold:** the reachable War Archives has a visit-bound intel interaction. It is idempotent, unavailable in Death's Gate, and grants no currency or item.
- **Responsiveness and presentation:** the Hollow Gate screen reuses its line-of-sight result between map and minimap in the same render; the Stronghold visibility cache and static ambient framing remain in place. New route markers use static styling without continuous effects.
- **Verification:** 42 focused server/shared tests passed; client and server TypeScript checks passed; focused client ESLint passed; a production Vite build passed to a fresh temporary directory. Dedicated Stronghold/Rift browser specs and matched-device frame-time measurements are not available in this run, so runtime FPS gains remain unverified.

## Goals

1. Give Hollow Gate runs more decisions without restoring the fixed-wing layout that was previously reverted.
2. Make the existing short Rift quests feel different across visits while preserving their story and daily offer cadence.
3. Give Stronghold exploration optional objectives beyond walking toward the vault and managing patrol threat.
4. Protect responsiveness, mobile usability, server authority, player saves, and existing rewards while adding content.

## Current system boundaries

- Hollow Gate's current five-floor standard run, server-sealed run token, immutable floor manifest, reward ledger, death/extraction rules, and augment authority remain authoritative. Event Rifts remain short variants of the same engine, currently one to three floors.
- Hollow Gate floors remain randomly generated. This proposal does not restore mandatory hub-and-wing layouts.
- Rift quests continue to use their current daily offer rotation, authored story, level access, and server-owned completion/reward catalog.
- Stronghold remains a shared 37×23, twelve-chamber interior. Movement continues to add 4% threat per successful step; the patrol threshold, PvP rules, Death's Gate rewards, and current Anbu encounter gates do not change in this plan.
- No reward rate, currency payout, drop chance, daily cap, combat formula, or save schema changes without a separate balance and implementation review.
- Keep environmental presentation inexpensive: prefer static art, restrained transitions, and clear UI cues over continuous particles, extra canvases, or per-tile animation.

See the current owners: [Hollow Gate gameplay loop](hollow-gate-loop.md), [Hollow Gate server and augment contract](hollow-gate-augments.md), and [Stronghold design and validation](stronghold/README.md). The existing [Anbu Infiltration plan](anbu-infiltration-plan.md) remains the owner for raid rewards and economy boundaries.

## Recommended sequence

| Phase | Feature | Priority | Main dependency |
|---|---|---:|---|
| 0 | Playtest and detail the proposed rules | Required | Owner review of the open decisions below |
| 1 | Optional Hollow Gate detours and room conditions | First build | Preserve random generation and the sealed floor manifest |
| 2 | Weekly Rift distortion and readable boss signatures | Second build | Reuse Phase 1's sealed expedition-rule pattern |
| 3 | Stronghold optional supply-cache objective | Third build | Server-owned objective and reward receipt |
| 4 | Co-op Stronghold breach | Separate discovery | Party admission, shared combat, settlement, and reconnect design |

Phases 1–3 can be separately gated and shipped. Phase 4 is a longer-term option, not a prerequisite.

## Phase 0 — Rule review and playtest

Before implementation, play the current activities on desktop and a low-end/mobile profile. Confirm that the recent map-performance work is present in the baseline, then record the starting experience for exploration time, completion, abandonment, and known render hot spots where instrumentation permits.

Owner approved implementation in chat. Hollow Gate uses an existing chest only; Stronghold intel grants no currency or item. Weekly Rift signals reveal one existing point of interest and do not change combat or payout values. Keep player feedback distinct from measured runtime evidence. The matched-device performance baseline remains to be captured before claiming an FPS improvement.

**Exit gate:** scope and reward policy are approved. Record the matched-device performance baseline and review final player-facing copy before release.

## Phase 1 — Hollow Gate: optional Echo Cache detours

### Player loop

On a randomly generated floor with an existing chest at least four steps off the shortest route, mark one optional Echo Cache detour. Show the additional route cost and standard chest contents before the player commits. The existing map and encounter rules remain in force; no chest is added and no reward value changes.

Future room-condition ideas remain deferred until a rule can be added without introducing unapproved balance changes:

The initial release is one optional detour marker at most per floor. The direct route always remains available.

### Implementation shape

- Derive optional route metadata from existing nodes and seal it in the generated floor manifest, not in client-trusted mutable save data.
- Validate reachability, uniqueness, and allowed node budgets when the server seals the floor. Do not allow a generated detour to block the required descent, exit, boss, or recovery path.
- Use the existing chest event and reward ledger unchanged. Repeated floor seals return the same route metadata.
- Reuse current tile art and room UI first. Add a compact condition badge, a risk/payoff summary, and a distinct static room treatment only where it improves recognition.
- Keep existing run duration, daily run limit, extraction/death behavior, combat settlement, and shard costs intact.

### Acceptance criteria

- Standard and event floors remain connected and all required nodes remain reachable after adding optional rooms.
- The player sees the detour's risk and payoff before committing; skipping it never softlocks progression.
- Server-sealed manifests and idempotent event receipts prevent route or reward replay exploits.
- Existing saves and in-progress runs continue to resume under their existing manifest.
- No additional always-running animation or map-wide work is introduced. Compare render cost on the same floor before and after, including a low-end/mobile profile.

## Phase 2 — Rifts: weekly distortion and boss signatures

### Player loop

Introduce one weekly Rift Distortion shared across the available Rift quests. The distortion changes one clearly explained tactical rule for that week, while the current daily system continues choosing which eligible Rift the giver offers. A Rift still uses its authored story, scaled short run, and unique boss.

Approved first rotation:

- **Echoed Cache:** mark one existing chest on each floor.
- **Echoed Threat:** mark one existing battle on each floor.
- **Resonant Vein:** mark one existing shard vein on each floor.

Rotate these information-focused distortions by Monday UTC. Keep the authored Rift boss identity visible and unchanged. Do not add continuous effects, combat-stat changes, or payout multipliers.

### Implementation shape

- Derive the active weekly distortion from a stable server-owned week key. Seal its ID and parameters into the Rift run token so a run started near rotation time cannot change rules mid-run.
- Keep Rift identity, daily offer rotation, level gating, 1–3 floor length, story text, boss IDs, and current reward catalog unchanged.
- Treat distortions as route-information rules, not reward multipliers. The selected existing node and distortion ID are sealed into the floor manifest and run token.
- Ensure the introductory Rift explains the rule in plain language and does not assume knowledge from later Rifts.

### Acceptance criteria

- All clients entering during the same server-defined week receive the same distortion; reconnects and retries preserve the run's sealed version.
- A week rollover does not alter an active run or duplicate/erase a reward receipt.
- Daily Rift offers and existing reward parity remain unchanged.
- Every distortion gives the player a clear route choice; combat and reward behavior remain unchanged.
- Reduced-motion mode and low-end devices retain full gameplay information without relying on VFX.

## Phase 3 — Stronghold: optional cache objective

The Stronghold expansion notes already call out limited, guarded supply caches in optional chambers. Use that as the first objective rather than adding a new stealth system at the same time.

### Player loop

Place one optional, non-economic field-intel interaction in the War Archives. The player can inspect the patrol ledger or skip it and continue toward the vault. Keep the existing 25-step patrol threshold and all combat rules unchanged.

### Implementation shape

- Add the objective and its state to the server-owned Stronghold visit; client presentation only displays the current objective and receipt.
- Use a single-use, server-validated interaction tied to the active visit and exact objective tile. Retries return the same claimed state.
- Grant no currency or item. Keep Death's Gate/Obsidian excluded until its distinct reward and Blood Altar rules are reviewed.
- Make the objective optional and make the vault route viable without it. Preserve current exploration, reconnect, tab-admission, PvP isolation, patrol, and exit behavior.
- Start with one ordinary Stronghold objective. Death's Gate/Obsidian can reuse the framework later only after its distinct rewards and Blood Altar are reviewed.

### Acceptance criteria

- Objective completion is server-authoritative, visit-bound, and idempotent across reloads and network retries.
- Skipping or failing the cache cannot block the vault or change the Anbu admission condition.
- The exact step threat and patrol threshold, PvP rewards, and existing Anbu rewards remain unchanged.
- The objective is reachable on the shared map, readable at mobile sizes, and does not increase repeated render work during presence polling.
- No reward settlement or player-save schema is introduced for the intel objective.

## Phase 4 — Co-op Stronghold breach (discovery only)

A team breach could make the shared interior a coordinated operation, but it is a larger systems change than an optional objective. First define party admission, host/leader disconnect behavior, movement and patrol ownership, synchronized combat, participant eligibility, reward splits, PvP boundaries, reconnects, and simultaneous claim protection. Reuse the current interior only if every participant can observe a consistent server-owned visit state.

Discovery recommendation: key the instance by the existing party identity plus sector, store one versioned server visit for the party, and keep each member's presence lease separate. A leader disconnect should not close the run; any admitted member can continue after reconnect. Serialize moves and objective interactions with the visit version. Patrols should use one shared combat session with explicit participant eligibility and per-player existing settlement receipts. Keep Stronghold PvP as a separate interaction, outside shared patrol fights. Reuse the existing party size limit and do not add a new reward split until economy review approves exact eligibility and amounts.

Do not start implementation until the combat/session owner, economy owner, and multiplayer owner approve one complete flow. Do not let co-op alter normal Stronghold PvP or Death's Gate reward rules implicitly.

## Cross-feature validation plan

For each shippable phase:

1. Add deterministic unit coverage for generation/reachability, weekly selection, or objective eligibility as appropriate.
2. Verify server ownership, request replay/idempotency, reconnect behavior, and reward limits with integration tests.
3. Run focused Chromium/WebKit browser checks for desktop, small phone, landscape, and reduced-motion behavior; retain screenshots for visual review.
4. Re-run Stronghold lifecycle/resource checks when changing the Stronghold screen or mount boundary.
5. Compare performance on matched hardware/settings; report operation counts and measured frame/render timing separately. Do not infer a device FPS gain from source-level optimization alone.
6. Run the required client lint, type checks, build, and applicable full CI gates before release.

## Decisions and remaining verification

- Hollow Gate detours reuse one existing capped chest event; no additional chest or payout is added.
- Stronghold field intel is informational and non-economic.
- The Rift signal rotation is weekly on Monday UTC, shared across Rifts, and sealed per run.
- Co-op Stronghold remains discovery only pending party, combat, multiplayer, and economy review.
- Capture and compare matched-device performance; source-level caching alone does not establish an FPS gain.

No reward-rate, currency, combat-formula, or save-schema changes are included in the approved implementation. Validate the first slice with server replay/reconnect coverage, focused UI checks, and matched-device performance evidence before release.
