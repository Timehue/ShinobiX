# Launch readiness plan (2026-11-16)

Three asks, one document:

1. What a good browser MMO / PBBG does and should have, checked against Shinobi Journey, with a plan for the gaps.
2. The mistakes AI-written ("vibe coded") games keep shipping, plus what can get a small online game into legal trouble, checked against this repo.
3. Sector arrival: the 3 s wait, then a blank screen and figures popping in. **Fixed in this branch** (section 1).

Method: two web-research passes (sources at the end of each section), then two read-only audits of this repo against the resulting checklists. Every "present" or "gap" below cites the file it was checked in. **Nothing here is legal advice.** Items marked **[LAWYER]** need a qualified lawyer.

---

## 1. Sector arrival (done in this branch)

### What was wrong

Measured with a timing probe on the production build, over a throttled phone connection (150 ms RTT, ~1.2 MB/s), arriving in Sector 1 from the atlas:

| After the travel mask ends | Before | After |
|---|---|---|
| First painted ground on the canvas | ~660–710 ms (blank until then) | **0–90 ms** |
| Player's own marker visible | ~650–730 ms | **first frame** |
| "Connecting to world…" banner | shown for the whole connect | hidden unless the connect takes over 1.2 s |
| Road residents (SectorLife) start mounting | after 2 server round trips | unchanged (still on `ready`, see below) |

Re-measured 2026-11-18 on the shipped build (#123 live), same throttled profile, with the **live model art** served through the probe from `img.shinobijourney.com/sector-models` (150 ms + size at ~1.2 MB/s per file). 9 arrivals, desktop and phone sizes:

| After the travel mask ends | Measured |
|---|---|
| First painted ground | 97–190 ms (desktop); first frame on phone |
| The player's own model (starter) | **56–192 ms**, every run |
| A road wanderer's model, when the wanderer is on screen | already drawn in 8 of 9 runs. In 1 run it was a portrait circle for ~1.2 s (in view at 152 ms, model at 1,387 ms) |
| World walkable (`ready`) | 0.65–1.3 s |

The one remaining visible gap is that occasional wanderer. It is still unverified on a real phone over mobile data (`docs/owner-launch-filings.md` section 7).

**Why the wanderer gap happens.** During the travel wait, `warmSectorArrival` (`lib/sector-arrival-warm.ts`) decodes one page per figure: its standing, front-facing frame. A wanderer that arrives walking, or facing another way, needs a different page. Until that page lands, `SectorModelFigure` shows the portrait circle (`waitForArt`), because the figure has never painted. On the throttled profile that page takes about a second.

**[OWNER] choice:**
- (a) Warm more pages per wanderer. The 9 MB decoded budget cannot hold all eight walking facings for several people, so this only narrows the gap.
- (b) Draw the warmed standing frame as a stand-in until the right page lands. The portrait never shows, but a walking wanderer glides in a standing pose for up to a second. That changes model presentation, which the owner reviews.
- (c) Leave it: the gap is occasional, and only on a slow connection.

Three causes, all in the arrival path:

- **The world rebuilt from nothing after the mask.** `WorldMap` swaps the whole scene for `TravelingOverlay` during travel, so `ContinuousWorldSector` mounted only once the mask ended. `mountContinuousWorld` then waited for the server's position (`GET /api/player/world-move`) before it drew a single frame, leaving a blank canvas for one round trip.
- **The floor art was never warmed.** The travel warm-up preloaded `sectorFloorImage`, but the renderer draws `sectorLifePainting(sector) ?? sectorFloorImage(sector)` plus a biome terrain material, and it waits for `decode()`. Even a cached floor took a decode after mount.
- **Residents waited for two round trips.** `SectorLife` (the road's people and their models) mounted only on `ready`, which comes after the position GET and the adopting POST.

### What changed

- `lib/continuous-world-controller.ts`: the renderer is built as soon as the (already warmed) world layout is loaded. It paints the **arrival tile** every frame, with the player's marker, while the position request is in flight. The server's answer then takes over exactly as before. If it fails, the renderer is disposed and the marker is hidden again. The tick and the preview share one `place()` helper.
- `lib/world-floor-warm.ts` (new): during the travel wait, fetch **and decode** the destination's floor, its biome ground and its current life painting. The renderer takes them already decoded (`takeWarmImage`), so the first frame draws them. Anything nobody takes is released after 30 s, a failed decode is forgotten, and engines without `decode()` just warm the HTTP cache. The renderer and the warm-up share `worldFloorSource` / `worldTerrainName`, so they cannot drift apart.
- `components/ContinuousWorldSector.tsx`: passes the arrival tile and marks the routine connect banner so CSS can delay it. `SectorLife` still waits for `ready`. Mounting it during the preview showed residents and work points before the world could be walked or tapped, and broke the two-player shared-work e2e (`sector-life.spec.ts`). Their figures' first frames are still warmed during the travel wait (#115).
- `continuous-world.css`: the "Connecting to world…" label appears only after 1.2 s. Errors, Retry and Reload show at once as before.

Not changed: server, saves, movement authority, travel time, rewards. Sectors sit 46+ tiles apart in the world layout, so no neighbouring floor is ever on screen at arrival. The warm-up therefore only covers the destination.

### What is still slow, and the next step

- **`ready` still costs two round trips (GET, then the adopting POST). Reviewed 2026-11-18 and kept.** The ground and the player show during that time; the residents, buildings, movement and the run button wait for it. Overlapping the two would save one round trip (about 0.15 s on a phone) for those layers, but it means either a server-authority change or letting the world start before the server has adopted the player's position, in the core movement code. A bug there costs far more than 0.15 s, so this stays as it is unless a real-phone check shows the residents' wait is noticeable.
- **Phone camera glide.** On phones the camera eases about 1.5 s toward the nearest landmark/resident (the framing from #108). That is deliberate and not loading, but it reads as "settling". Snapping to the framed view on the first ready frame would be a small, separate UX change.
- **Real-device check.** All numbers above come from Chromium with network emulation. Confirm on a real phone over mobile data after deploy.
- Bundle: about +1.7 KB of lazy JS/CSS, with startup unchanged. Together with section 3's fixes, the whole branch fits the existing budget after trims (section 4).

---

## 2. MMO / PBBG best practice vs. Shinobi Journey

### Already strong (keep)

Checked in code by the audit:

- **Onboarding.** Academy flow, JourneyGuide, FirstPact and a daily briefing. Per-step funnel analytics in `api/_beta-funnel.ts` plus an admin beta-metrics view. Research says to measure every onboarding step, and you already do.
- **Daily login.** The streak never resets on a missed day (`api/player/_daily-login.ts`). That beats the usual "grace period" advice.
- **Social systems.** Clans with wars, bosses and Sensei/Student mentoring (`api/clan/_mentor.ts`), plus friends, private messages, and village, clan, sector and PvP chat.
- **Economy sinks.** Taxed one-way trades with a transfer budget (`api/player/trade.ts`), Exchange listing fees and limits (`api/festival/exchange.ts`), and village tax on bank transfers. These are the classic RMT-funnel and inflation controls.
- **Competition.** Ranked 1v1, 2v2 and pets, archived seasons, leaderboards, Hall of Legends, world boss, and events.
- **Moderation.** Report (`ReportControl` → `api/report.ts` → `ModerationPanel`), block (`api/player/blocks.ts`), and admin silence, kick, ban and chat delete. Ban reasons are shown at login.
- **Shop.** Real-money prices on Shard tiers, no countdown pressure offers, and odds disclosed for card packs. The store is blocked inside the Play build (`lib/shard-store.ts`, `lib/surface.ts`).
- **Live-ops.** Patch notes modal, Discord link, announcements.

### Gaps, in priority order

**Now (before inviting players):**

1. **Bug-report button and known-issues list.** Bugs reach you only through Discord today, and the report categories have no "bug". Add a "Bug" category to the existing ReportControl, with screen, build and a client log tail attached, plus a pinned known-issues entry in patch notes. Players forgive bugs they can see are known. [codecks.io community guide; bugnet known-issues]
2. **A published wipe/reset policy.** The Terms only say the beta "may change, reset". Before a public push, state:
   - whether there is one more wipe, and when;
   - what survives it (account name, purchased Shards, Supporter time, cosmetics);
   - how much notice players get.

   An admin reset tool exists (`api/admin/server-reset.ts`). Wipes without notice or compensation are a top reason MMO communities turn. **Owner decision.**
3. **A "what money can and cannot buy" page.** The claim exists in shop and legal copy ("no combat advantage"). Make it one public page linked from the shop. It is cheap insurance against the pay-to-win label, which is near impossible to remove once it sticks. Check that paid Legendary packs and forge rolls do not undercut it (see 3.B).
4. **Odds and ranges on every paid random roll** (also legal, 3.B #1).

**Next (first 1–3 months):**

5. **Web push for the moments that matter:** your PvP match is ready, a world boss spawned, a war started, training finished. Use a soft pre-prompt after a meaningful moment, never on first load, and cap the frequency. Nothing exists today (no PushManager or VAPID). With 100–200 players this is the cheapest re-engagement lever available.
6. **Catch-up for late joiners.** Clan mentoring exists, but nothing scales rewards for players far below the population median. Use a rested/XP boost below the median level, capped so veterans keep their edge.
7. **Accessibility basics:** an in-game text-size control, an in-game reduced-motion toggle (today only the OS setting is honoured), and a check that no state is shown by colour alone. These are on the "basic" tier of the Game Accessibility Guidelines.
8. **A predictable cadence.** Small fixes weekly, one themed event about every 4 weeks, larger drops quarterly. Publish a short roadmap (Discord or in-game) and follow through visibly.
9. **"Alone together" presence.** The world already shows peers and traces. Make sure the atlas, the hubs and the tavern always surface recent activity, so a 30-player evening still feels inhabited.

**Later:**

10. Capped offline progress (about 24 h; it partly exists through training, expeditions and bank interest).
11. A public read-only API for player-made tools.
12. Formal player polls on balance-sensitive changes, once the population can carry them.

**Not recommended:** an energy wall. There is no AP gate today (stamina is a combat stat), and research consistently finds pure energy walls end sessions without a reason to return.

### Top failure modes to watch

These are the usual reasons a game like this fails, with the counter-measure for each:

- **An empty world.** Keep players concentrated: one server, a single ranked queue, hubs.
- **Pay-to-win perception.** Covered by #3 and #4.
- **Grind walls.** Watch the funnel for level clusters where players stop.
- **A slow first load.** Covered by section 1, plus the size gates.
- **Obligation mechanics.** Your streak design already avoids this.
- **Exploit-driven inflation.** Covered by the ledger and locks.
- **Botched wipes.** Covered by #2.
- **Slow content cadence.** Covered by #8.
- **Unmoderated chat.** Present.
- **Launch-day collapse.** You measured a ~500-player ceiling against a 100–200 player cap.
- **Solo-dev burnout.** Choose a cadence you can sustain.

Sources (MMO/PBBG):
- GameAnalytics 2025 benchmarks: https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks
- Browser game load times: https://enclavegames.com/p/browser-games-lose.html
- First-time experience: https://unity.com/how-to/10-first-time-user-experience-tips-games
- Guild play and retention (DiGRA): https://dl.digra.org/index.php/dl/article/download/75/75
- Streak design and burnout: https://yukaichou.com/gamification-analysis/streak-design-gamification-motivation-burnout/
- Banked daily turns: https://wiki.kingdomofloathing.com/Adventure
- Paying for power in matchmade games: https://gamedeveloper.com/business/paying-for-power-in-matchmade-games
- Penalty and reporting systems (ADL): https://www.adl.org/resources/reports/games-framework-resource-penalty-and-reporting-systems
- Community channels: https://www.codecks.io/blog/guide-for-community-management-in-game-development-channels-and-best-practices/
- Game Accessibility Guidelines (basic): https://gameaccessibilityguidelines.com/basic/
- Indie live-ops: https://www.strayspark.studio/blog/liveops-indie-developers-post-launch
- Web push timing: https://www.optimove.com/resources/learning-center/web-push-notifications
- Laws of online world design: https://www.raphkoster.com/games/laws-of-online-world-design/the-laws-of-online-world-design/
- Long-running browser MMO interview: https://www.pocketgamer.com/torn/twenty-one-years-interview

---

## 3. Vibe-coded mistakes and legal exposure

### 3.A Security: the AI-written-app checklist vs. this repo

What has gone wrong elsewhere:
- 170 of 1,645 AI-builder apps had Supabase tables open to the world (CVE-2025-48757).
- Moltbook (2026): a Supabase key in client JS plus RLS off exposed the whole database.
- Veracode 2025: 45% of AI-generated code introduced OWASP Top-10 flaws.
- An AI agent deleted a production database.
- Leaked API keys ran up $82K in 48 h.

**Already correct (verified in code):**
- No privileged secrets in the client.
- `kv_store` has RLS on, with anon and authenticated revoked (`supabase-schema.sql:96,105,110`), and there is no client-side Supabase.
- Passwords use scrypt with `timingSafeEqual` (`api/player-auth.ts`).
- Identity comes from the token, never from the body (`_auth.ts:606`).
- Rate limits on 279 handlers, with per-action auth budgets. Client IP is trusted only from Railway or Cloudflare peers (`api/_client-ip.ts`).
- QA routes exist only under `NODE_ENV=test`.
- Currency inputs are validated (bank, trade, shop).
- No `dangerouslySetInnerHTML`. BBCode allows only http(s) links and same-origin images.
- SQL is parameterised.
- CORS is an exact allowlist with no credentials.
- Errors are generic in production.
- Server-minted reward tokens, ledgered saves, `withKvLock`.
- Dependabot covers root, client and actions.
- A ReDoS test exists.

That is better than most hand-written indie backends.

**Gaps, most severe first:**

1. ✅ **Fixed by #118 (merged).** Tebex refunds and chargebacks used to be only logged. They are now reversed, and Shards that were already spent are flagged for you. Details are in that PR.
2. ✅ **Fixed by #119 (merged).** Admin save overwrites and server resets are recorded in the `admin` audit domain, and admin logins in the `auth` domain. This branch adds `admin` and `auth` to the admin console's audit viewer, so both can be read there. Logging only: no auth decision changed.
3. **Reviewed 2026-11-18: no change needed.** The reusable admin password is still accepted on admin routes (`ADMIN_STRICT_TOKEN_ONLY` is off by default), but turning strict mode on would add almost nothing. The admin panel already sends a signed token instead of the password (`authFetch.ts`). Wrong passwords are capped at 10 per 15 minutes per address on every route (`adminPasswordRole`), and an attacker who holds the password could mint a token at `/admin-auth` anyway. It would also break the operator scripts that send `x-admin-password` (`beta-daily-report.mjs`, the probes). The protection that would help is a second factor on admin login, which is a feature for later, not a setting.
4. ✅ **Done in this branch.** API responses had no default `Cache-Control`: 121 handlers opted in to `no-store` one by one, and authenticated GETs such as `admin/moderation`, `clan/seal-pool/get`, `legacy/stats`, `sector/life` and `solo-pve/state` had none, while Cloudflare does cache some `/api` GETs. `server.ts`'s `route()` adapter now defaults every API answer to `private, no-store`. The 21 handlers that deliberately share a cached answer (`game-state`, `world-state`, `weekly-boss`, `img` and others) set their own header, which replaces the default. A test in `server-routes.test.ts` pins this.
5. ✅ **Done in this branch; it runs once you add two secrets.** `.github/workflows/nightly-backup.yml` runs the runbook's own `kv-backup.mjs export` every night at 07:17 UTC and keeps the result for 14 days as a private workflow artifact, off Railway and off Supabase.
   - It refuses to upload anything the script did not encrypt (AES-256-GCM).
   - It does nothing until `BACKUP_DATABASE_URL` and `KV_BACKUP_PASSPHRASE` exist as repository secrets. Keep a copy of the passphrase outside GitHub.
   - It can never fail a check suite Railway waits on (the deadlock in `post-deploy-health.yml`). A failure opens a "Nightly backup failed" issue instead.
   - A restore drill stays a manual monthly step (`kv-backup.mjs drill`).
   - Pinned by `scripts/nightly-backup-workflow.test.mjs`.
6. ✅ **Fixed by #119 (merged).** The default JSON body limit is now 256 KB. The routes that legitimately carry images got their own tiers after a sweep of every client POST: the Make Model profile portrait and the starter pet at 2 MB, challenges at 5 MB, and game-state and content publishing for admins only.
7. **Reviewed and kept on purpose: the broad `connect-src`/`img-src` CSP.** The hosts come from build arguments and per-deployment settings (Supabase, Sentry, PostHog, R2), so pinning them would silently break features on the next configuration change (see the comment in `api/_http-security.ts`). The part that stops an injected script, `script-src`, is already strict: self plus one Cloudflare beacon, with no inline scripts and no eval.
8. **Not a gap (the audit was wrong).** `ci.yml` already runs `npm audit --prefix shinobij.client --audit-level=high`, which currently passes (9 moderate findings in eslint tooling only). The only third-party action, `subosito/flutter-action`, is already pinned to a commit SHA. The rest are GitHub's own `actions/*`.

Minor items:
- ✅ `safeEqual` no longer leaks a secret's length; it compares SHA-256 digests in constant time.
- Owner decision: HSTS `includeSubDomains`/`preload`. Preload is effectively permanent for every subdomain, so only you can decide it.
- ✅ `/restart` no longer accepts `KV_PROXY_TOKEN` (2026-11-18). Only a real `RESTART_TOKEN` opens it; unset or a placeholder disables the route. Nothing calls it, and Railway's Restart does the same job, so this needs no setting.
- Deliberate and documented: the Tebex IP check only logs, because the HMAC signature is the authentication, and a proxy-attribution mismatch once threw paid purchases away.

### 3.B Legal: the checklist vs. this repo

**Already in place** (`screens/LegalPage.tsx` v1.12, `data/legal.ts`):
- Terms, Privacy, Community Rules, Purchases & Refunds, Cookies, Copyright, privacy request, account deletion and Notices pages.
- In-app account deletion with a 24 h confirm, and a `/delete-account` web URL as Google Play requires.
- The 13+ requirement is stated.
- "No cash value" and "may be reset during beta" clauses.
- Tebex is the merchant of record (it handles VAT and sales tax).
- The store is blocked inside the Play build, which avoids a Play Billing violation.
- Report and block in every chat.

**Gaps:**

1. ✅ **Fixed by #120 (merged).** The Awakening reroll now publishes its odds before purchase. The named forge rolls were already disclosed (the audit was wrong): CentralHub's forge panel lists per-value percentages for EP, range, offense, armor stats, specials and tag appearance, from `shared/named-forge-roll.ts`. Card packs already did this.
2. ✅ **Done in this branch; the owner should review the wording.** PostHog was not named as a processor. The privacy policy (`LegalPage.tsx`, now v1.13, dated November 16, 2026) now says aggregate product analytics go to PostHog with no account name, identifier or cookie, and that PostHog receives the request IP. The cookie banner already said "no advertising or third-party tracking **cookies**", which is accurate (PostHog sets none), so it is unchanged.
3. ✅ **Neutral age screen done in this branch.** The age gate used to be clickwrap only ("you confirm you are at least 13"). The amended COPPA rule has been fully enforceable since 2026-04-22, and an anime-styled game with chat and purchases fits the profile the FTC looks at.
   - The creator's final step now asks for a birth year for every sign-up mode (password, Google, guest), with no default and no hint at the cutoff.
   - An under-13 answer gets a plain refusal and is remembered in that browser, so going back and picking another year does not reopen the door.
   - The year is never stored or sent (`e2e/age-screen.spec.ts` checks that).

   Still open: **[LAWYER]** on whether the game counts as "directed to children", and whether under-16s should get chat and purchases off by default (the UK children's code, FTC precedents).
4. ✅ **Stated 2026-11-18 (Terms, v1.14).** The conduct section now says what a ban does, as the code does it: a timed ban blocks sign-in until it ends; a permanent ban also gives up village and clan seats and returns Exchange listings; neither removes or refunds Shards or Supporter time; neither cancels a subscription (owner ruling 2026-11-18), with a pointer to cancel through Tebex; and sign-in shows the ban's end date and recorded reason (`player-auth.ts` 403, `player-login.ts`), which is the DSA Art. 17 statement of reasons. Still open: **[LAWYER]** review of the wording.
   - ✅ **Silences, 2026-11-18.** Every surface that refuses a silenced author now answers with one shared message (`silenceRefusal` in `api/admin/moderation.ts`). It names when the silence ends (UTC), the reason staff recorded, and the appeal address. Sector chat shows that line instead of its own reason-less one.
   - Still open: removing a single chat message tells its author nothing. *Low*, because the author keeps posting.
5. **No registered DMCA agent** (the Copyright page says one "will be published"). *Fix:* register at copyright.gov/dmca-directory ($6, renew every 3 years) and name it on the page. Without it there is no safe harbour for player content. *High.*
6. ✅ **DSA contact point done in this branch.** Notices now names support@shinobijourney.com as the single point of contact for users and authorities under DSA Articles 11–12. Still open: **[LAWYER]** on whether an EU or UK representative is needed (GDPR Art. 27, DSA Art. 13).
7. ✅ **Done 2026-11-18 (privacy policy v1.14).** "Kept while needed" is replaced by the periods the code enforces: IP and device stamps 7 days, moderation linkage 90 days, sector and battle chat about an hour, village, clan and direct messages capped and removed after 30 idle days, save backups 90 days, off-site backups 14 days, logs capped at 5,000 entries. `docs/DATA_RETENTION_POLICY.md` keeps the full schedule.
   - The policy also promised that guest characters are deleted after 14 days without play, but the sweep had only ever run report-only (it needed `GUEST_SWEEP_ENABLED=1`; production logs showed 3 abandoned guests kept). On the owner's ruling it now deletes by default, and `GUEST_SWEEP_ENABLED=0` turns it back to report-only.
8. **Data export is by manual request only.** That is acceptable under GDPR if answered within a month. An in-app export is nice to have. *Low.*
9. ✅ **Done in this branch.** There were no credits for Inter, Marcellus, fflate or h264bsd, although their licences shipped in `public/`. `public/licenses/THIRD-PARTY-NOTICES.txt` now lists every bundled font and library with its copyright and licence, and Notices links to it. The internal `src/assets/fx/CREDITS.txt` covers authored FX, not third-party code.
10. **Shard-priced items show no real-money equivalent** (packs, rerolls, forge). The EU CPC principles ask for it. *Medium.* **[OWNER] decision, 2026-11-18.**
    - A flat "≈ $X" conflicts with `shared/shard-packages.ts`, which forbids showing the reference USD price: players are charged Tebex's localized price, such as euros with VAT.
    - It would also need client bytes the bundle cap no longer has.
    - Options:
      - (a) show "≈ $X (USD)" from the $5 tier's rate, with the currency stated;
      - (b) show it only on the Shard bundle tiles, as a per-Shard price taken from Tebex's localized price;
      - (c) leave it to the lawyer review.
11. **UK Online Safety Act.** Chat makes the game in scope regardless of size, so a written illegal-content and children's-access risk assessment is required. **[LAWYER]** *Medium.*
12. **Google Play.** Before submission: the Data safety form must match what is really collected (IP, fingerprint, chat, purchases, PostHog, Sentry); the IARC questionnaire must declare chat and purchases; and if Play users can ever buy, Play Billing is required. *Before the Play release.*
13. **IP clearance.** Get a trademark search on "Shinobi Journey". Keep technique, character and clan names generic and original (the ip-hygiene test already guards competitor names). Keep records of human creative work on AI-assisted art, since purely AI output is not copyrightable in the US. **[LAWYER]** for the trademark search.

Sources (security and legal):
- Lovable Supabase RLS flaw: https://nvd.nist.gov/vuln/detail/CVE-2025-48757
- Moltbook exposure: https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys
- Escape.tech scan of vibe-coded apps: https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/
- OWASP Top 10 (2025): https://owasp.org/Top10/2025/
- Race-condition testing: https://portswigger.net/research/smashing-the-state-machine
- Tebex webhooks: https://docs.tebex.io/developers/webhooks/overview
- Cloudflare cache deception: https://blog.cloudflare.com/understanding-our-cache-and-the-web-cache-deception-attack/
- Slopsquatting: https://labs.cloudsecurityalliance.org/research/csa-research-note-slopsquatting-ai-supply-chain-20260419/
- Supabase backups: https://supabase.com/docs/guides/platform/backups
- GDPR Art. 13: https://gdpr-info.eu/art-13-gdpr/
- COPPA rule: https://www.federalregister.gov/documents/2025/04/22/2025-05904/childrens-online-privacy-protection-rule
- FTC action on loot boxes and odds: https://www.ftc.gov/node/87268
- EU coordinated action on in-game currencies: https://commission.europa.eu/live-work-travel-eu/consumer-rights-and-complaints/enforcement-consumer-protection/coordinated-actions/social-media-online-games-and-search-engines_en
- Google Play loot-box odds: https://fenwick.com/insights/publications/google-play-now-requires-disclosure-of-loot-box-odds
- DMCA agent directory: https://www.copyright.gov/dmca-directory/
- Digital Services Act: https://eur-lex.europa.eu/eli/reg/2022/2065/oj
- Play payments policy: https://support.google.com/googleplay/android-developer/answer/9858738
- Play account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- Play UGC policy: https://support.google.com/googleplay/android-developer/answer/9876937
- Online Safety Act and games: https://www.lewissilkin.com/insights/2025/10/24/ofcom-issues-guidance-about-online-safety-act-in-video-gaming-context-102lr5v
- AI output copyrightability: https://www.jonesday.com/en/insights/2025/02/copyrightability-of-ai-outputs-us-copyright-office-analyzes-human-authorship-requirement

---

## 4. What is left

Fixed by merged PRs:
- #118: Tebex refund and chargeback reversal;
- #119: admin audit trail and tiered body limits;
- #120: Awakening odds.

Fixed in this branch:
- the sector arrival fix (section 1);
- nightly encrypted backup;
- `no-store` default on API responses;
- `safeEqual`;
- the neutral age screen;
- the PostHog disclosure, the DSA contact point and third-party credits;
- `admin` and `auth` in the admin audit viewer.

Still to build, each its own PR:
- the bug-report category and known-issues list (2 #1);
- a public "what money can and cannot buy" page (2 #3);
- web push (2 #5);
- catch-up for late joiners (2 #6);
- in-game text size and reduced-motion toggles (2 #7);
- "≈ $X" next to Shard-priced items (3.B #10). This waits on the owner's choice of currency.

**Bundle budget: one owner-approved 2 KiB step.** After #118 and #120 merged, `main` itself read 9,883,287 B in its Production Image, 547 B over the 9,882,740 B cap, so those fixes could not deploy. This branch adds about 600 B more. The owner approved `LAUNCH_COMPLIANCE_JS_CSS_FAIL_BYTES` (+2 KiB) on 2026-11-17. The production-env build now measures 9,883,801 B against 9,884,788 B (987 B left). Startup gzip is unchanged at 398,823 B against its 399,000 B cap. Trims made first:
- The third-party credits moved into a plain-text notices file, which is outside the JS/CSS budget.
- A shorter odds sentence.
- Seventeen copies of the same "visually hidden, read by screen readers" rule, spread across feature stylesheets, now share one `.ui-sr-only` rule in `styles/ui.css`. Sixteen elements were renamed to that class, and the onboarding coach's class is listed on the rule. The tower keeps its own rule because tower tests pin it.
- `first-contract.css`'s copy of the toast-in keyframes now uses the identical `game-toast-in` already in startup CSS.

Dead CSS is exhausted: a full scan found one 165 B rule, in a QA stylesheet. Merging adjacent duplicate rules saves nothing, because the minifier already does it.

## 5. Decisions only the owner can make

Every item below that needs a filing or a form has ready-to-use steps and answers in `docs/owner-launch-filings.md`.

- The wipe policy, and what survives a reset (2 #2).
- What happens to an account that #118 flags for spent Shards after a refund or chargeback: freeze, ban, or nothing (3.A #1).
- Add the `BACKUP_DATABASE_URL` and `KV_BACKUP_PASSPHRASE` secrets to switch on the nightly backup (3.A #5).
- Legal text: review the v1.13 wording (PostHog, the DSA contact, credits), then decide ban forfeiture and retention periods (3.B #4, #7). Then a lawyer review of Terms and Privacy as a whole.
- Registering the DMCA agent, and the trademark search (3.B #5, #13).
- **[LAWYER]**: whether the game is "directed to children", an EU/UK representative, and the UK Online Safety Act risk assessments (3.B #3, #6, #11).
