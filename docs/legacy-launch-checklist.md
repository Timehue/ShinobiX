# Legacy System — Launch Checklist & Runbook

The operator's guide to turning the Legacy system on, watching it during launch
week, and turning it off cleanly if needed. Design source of truth:
[legacy-system-plan.md](legacy-system-plan.md). Roster:
[legacy-roster.md](legacy-roster.md). Assets: [legacy-assets.md](legacy-assets.md).

---

## 1. Flags — what gates what

| Flag | Where | Default | Meaning |
|---|---|---|---|
| `ENABLE_LEGACY` | server env (Railway **and** cPanel) | unset (**off**) | The real gate. Off = every legacy endpoint 404s, every hook no-ops, save behavior is byte-identical. |
| `legacy.v1` | client localStorage | **on** | Per-device kill-switch only. Set to `"off"` in a device's console to hide legacy client surfaces there. No server effect. |
| `DISCORD_ANNOUNCE_WEBHOOK_URL` | server env | unset | Optional. When set, mythic announcements also post a rich embed to Discord. |
| `LEGACY_SPECIALTY_PVP` | — | retired (never wired) | Historical plan flag — **no code ever read it**. Specialty Jutsu shipped PvP-enabled (owner signed off) gated only by `ENABLE_LEGACY`. Setting this does nothing; the only kill-switch for signatures in PvP/Towers is the full `ENABLE_LEGACY` rollback (§6). |

## 2. The flip (launch)

1. **Deploy first, flip second.** Make sure the latest `main` (with committed
   root `dist/` — cPanel serves it verbatim, Railway self-builds) is live on
   both hosts *before* touching the flag. The flag-off build is byte-identical,
   so deploying early is safe.
   ⚠ **Dist discipline when committing a build:** `shinobij.client/dist` is
   gitignored — after `npm run build`, new hashed bundles must be force-added
   (`git add -f -A shinobij.client/dist/`) or cPanel serves an index.html whose
   scripts 404 (white screen). Commit only js/css/html there — never
   re-compressed images. Root `dist/` churns line-endings on rebuild; commit
   only files with real changes (`git -c core.autocrlf=true diff --numstat dist/`).
2. Set `ENABLE_LEGACY=1` in **Railway → Variables** (service restarts itself).
3. Set `ENABLE_LEGACY=1` in the **cPanel `.env`** and restart the Passenger app
   (env-parity rule: the fallback host must match or behavior drifts between
   hosts; same rule as `SESSION_SECRET`).
4. Optionally set `DISCORD_ANNOUNCE_WEBHOOK_URL` on both hosts.
5. No client action is needed — `legacy.v1` is already default-on.

## 3. Smoke test (5 minutes, test account at level 50+)

1. `GET /api/legacy/definitions` → 200 with `legacies: [100]` (it 404s while
   the flag is off — this is the canary).
2. Admin → 🌠 Legacy → Player Inspector → inspect the test account →
   **Force-Spawn Sage**. Walk to the named sector on the world map: the Sage
   stands there; his VN opens; the offer sheet lists 2-3 legacies with badges.
3. Accept on the test account (it's a test account — the seal is intended):
   the acceptance ceremony shows the Trial of Awakening; Profile → 🌠 Legacy
   shows the trial with the Sage's charge and live objectives.
4. Check Hall of Legends → World Eras: Era V shows live milestone counters.
5. Post a `low` announcement from the admin panel; confirm it appears under
   Hall of Legends → News.
6. **Signature slot**: on an account with a Stage-3+ legacy (Inspector →
   Emergency Correction can set one on the test account), Profile → Jutsu tab
   shows the pinned "◆ Legacy Signature" card (mastery 30/40/50 by stage);
   start a PvE arena fight → the signature sits at the END of the action bar
   and casts (cd 10); open a PvP duel → it appears in the sealed loadout too.
   Below Stage 3 the card and bar slot are absent.

## 4. Launch-week dashboards (all in Admin → 🌠 Legacy unless noted)

- **Sage Funnel** — daily offers / accepts / declines. If offers stay at 0,
  players aren't reaching level 50 or the roll isn't firing.
- **Suspicion Queue** — anti-farm flags (win-trading rings, IP/fp overlap).
  Each row has Inspect + Clear-Suspicion (the relief valve). Suspicion decays
  on its own after ~10 idle days.
- **Custom Titles** log — recent title purchases with one-click
  Revoke + Refund; the Player Inspector also shows any worn title with a
  revoke button (covers titles older than the 100-row log).
- **World Eras** — Era V milestone counters; thresholds are tunable live via
  the overlay (`shared:legacy-defs`) without a deploy.
- **Audit trail** — Admin → Diagnostics → Audit log → domain `legacy`: every
  emergency-change, overlay write, title grant/revoke, era action, and hall
  correction, with actor + reason.

## 5. Incident playbook

| Incident | Tool |
|---|---|
| Wrong/duplicate legacy on a player | Inspector → Emergency Correction (reason required, audited; use sparingly — permanence is the design) |
| Offensive custom title | Titles log or Inspector → Revoke + Refund (audited) |
| False anti-farm flag | Suspects list → Clear suspicion (audited) |
| Hall of Legends mistake | Hall corrections → flip status / annotate (never hard-deletes) |
| A requirement is too hard/easy | Set-overlay: per-legacy requirement floors (`0` waives one) + Sage knobs (spawn chance, pity, decline cooldown, daily cap), live. Trial deltas are code constants (KIND/RARITY factors in api/_legacy-core.ts) — changing them needs a deploy |
| A trial stat seems stuck | Inspector → Server counters shows the live side-car values; trials measure fresh deltas over these |

## 6. Rollback

Unset `ENABLE_LEGACY` (or set `0`) on **both** hosts and restart.

What happens: every legacy endpoint 404s; the Sage, emissaries, briefing
sections, LegacyPanel content, and emissary trial panel hide themselves (their
fetches return null/empty). The Hall of Legends **tabs stay visible** (they're
client-flag gated) but render their empty states — "no legends written yet" is
technically misleading during a rollback; acceptable for a short incident
window. Saves keep their `legacy`/`serverTitles` fields untouched (frozen,
re-injected by the sanitizer); tavern prestige chips stop being stamped on new
messages; trials pause exactly where they are (fresh-delta baselines keep,
since the side-car stops moving too). Flipping back on resumes everything with
no data loss.

**Signature-slot rollback nuance**: flag-off removes Legacy signatures from
NEW PvP/Towers sessions immediately (the seal-time injection is flag-gated;
in-flight sessions keep their already-sealed copy). The PvE action bar reads
the CLIENT kill-switch (`legacy.v1`), not the server flag — so during a
server-only rollback a Bound player still sees and uses their signature in PvE
until `legacy.v1` is flipped off client-side. Combat-safe either way (the tag
and jutsu code paths ship regardless); flip both if you need the signature
gone everywhere.

Deliberate flag-off exceptions (they keep working, by design):
- **Moderation survives**: admin `view`, `suspects`, `clear-suspicion`,
  `titles-log`, `title-revoke`, `hall-list`, `hall-correct`, and `metrics`
  still work with the flag off — custom titles keep rendering flag-off, so the
  revoke tooling must too, and the Hall corrections list reads through the
  admin action (the public hall endpoint returns empty while off).
- **Title squat guard**: a *changed* custom title matching one of the 300
  server-credited legacy/era titles is rejected even while off (prevents
  pre-flip squatting).
- In-flight emissary errands can still be **claimed** (sealed server-side);
  only new accepts stop.

## 7. Design decisions (owner-signed, documented)

- **Rank is owner-only.** A Legacy's rarity (basic/rare/legendary/mythic) is
  **never shown to players and never used to separate/sort/colour any
  player-facing surface** — offer modal, accepted card, Codex, tavern chip,
  nameplate, Hall, VN. Every legacy renders with the same violet accent. Rarity
  still exists internally (drives requirement floors, jutsu tier, aura reward,
  server-first announcements) and is visible **only in the admin panel**.
- **The 16th slot is intended, additive prestige power.** The Legacy signature
  is a strictly-additive jutsu on top of the 15-slot loadout (a Legacy player
  fields one more jutsu than a no-Legacy player) with no offsetting loadout
  cost. This is accepted because it is **earned** (achievement floors + a
  5-stage trial), never bought or RNG'd — inside the skill-gated-power pillar.
  Its only in-combat cost is AP contention + cd 10. Enforced legacy-only + not
  spoofable in `api/pvp/session.ts`.
- **Accept boon: Aura Stones**, granted once on accept by rank (mythic 10 /
  legendary 8 / rare 5 / basic 3), server-side under the accept lock,
  exactly-once via the `legacy:aura-granted` NX marker. The player receives the
  stones but is never told the rank.
- **No Legacy weakness/tradeoff, and no mechanical Bloodline link — by design.**
  Legacy is a *third*, secondary identity layer; Bloodlines remain the main
  power identity. Legacy stays pure prestige (signature + title + aura + stones).
- **Progression depth (post-Stage-5 mastery, per-legacy passives) is deferred.**

## 8. Known deferred items

- **Specialty Jutsu** (plan §10) — **BUILT and live** (owner signed off on PvP).
  All 100 signatures ship in PvP, PvE, and Battle Towers whenever
  `ENABLE_LEGACY=1`, via the dedicated 16th slot injected server-side in
  `api/pvp/session.ts` `hydrateCharacterFromSave` at Stage 3+. There is **no
  per-feature flag** (`LEGACY_SPECIALTY_PVP` was never wired); the only lever is
  the full `ENABLE_LEGACY` rollback. All 100 signature-jutsu icons are generated
  and wired (`shinobij.client/public/legacy/jutsu/`); regenerate any with
  `shinobij.client/scripts/gen-legacy-jutsu-icons.mjs`.
- Real-device viewport smoke pass — the layouts were code-audited for 390px
  mobile; do one live phone pass (Sage modal, trial card, Hall, wanderer
  dialog, Profile signature card) during the smoke test.
