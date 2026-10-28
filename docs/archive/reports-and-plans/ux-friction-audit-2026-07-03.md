# Shinobi Journey UX Friction Audit - 2026-07-03

Tested against local Vite dev server at `http://127.0.0.1:50891/` on branch `codex/pvp-flow-audit`.

Browser coverage in this pass:
- Desktop 1280x720: first load, account creation, village lore, Daily Briefing, Academy start, companion intro, logout, returning login.
- Mobile 390x844: in-game HUD, bottom nav, mobile menu, start screen, touch target scan, overflow scan.
- Frustrated-player checks: missing local auth endpoint, invalid/error messaging path, hidden desktop logout on mobile, small touch target scans, no-console-error checks.

## 1. Executive Summary

Overall player friction score: 5/10 after fixes, where 10 means most friction. Before the fixes in this pass, the local new-player flow was effectively blocked for dev/QA, and several mobile tap targets were too small.

Overall loading speed score: 8/10 on local dev, where 10 means fastest. Initial UI became meaningful in about 530 ms DOM-ready and about 587 ms idle-ish. Returning login restored the tested save in about 395 ms. New account creation took about 3.3 seconds to land in-game.

Biggest quit-risk moments:
- Mobile returning players must scroll below the full creator form to reach login.
- The first in-game minute can show village lore, Daily Briefing, main menu, next-goal pin, safe-zone map, and Academy prompts in quick succession.
- Account creation had no visible pending state during the 3.3 second creation/save wait.
- Production account registration errors were previously flattened into a generic retry message.

Biggest slow screens:
- Account creation plus first save: about 3.3 seconds.
- Academy start briefly shows `Loading...`, but completed cleanly in this run.
- Larger systems not fully measured here, such as admin/editor, world map, combat, inventory, pets, and bloodline screens, still need route-level timing instrumentation.

Best quick wins applied:
- Added a Vite dev `/api/player-auth` shim so local first-run onboarding works.
- Kept Daily Briefing's primary exit CTA visible with a sticky footer.
- Raised key mobile tap targets to 40 px.
- Removed duplicate mobile name placeholders between creator and login.
- Surfaced real server-side create-account errors.

## 2. Critical Friction Bugs

### CRITICAL - Local first-run account creation could not continue

Player impact: A new local/dev player clicked `Begin Your Journey`, waited about 3.6 seconds, then stayed on the start screen with `Could not create the server account. Try again.`

Location: Vite dev environment, `/api/player-auth`; account creation in `src/App.tsx`.

Recommended fix: Provide a dev-only auth endpoint matching the production `register`, `verify`, `change`, and `delete` actions closely enough for QA.

Fix risk: Low. The middleware only runs in Vite dev, stores local hashes under the existing `saves` directory, and does not alter production `api/player-auth.ts`.

Status: Applied.

## 3. High Priority Friction Bugs

### HIGH - Daily Briefing primary exit CTA could start below the viewport

Player impact: On 1280x720, `Enter the village` was initially below the visible card area while the page itself had no vertical scroll. A close X existed, so this was not a total trap, but the intended path looked missing.

Location: `DailyBriefingModal`, `.daily-briefing-card`, `.daily-briefing-footer`.

Recommended fix: Keep the footer CTA sticky inside the modal, use dynamic viewport height, and keep close/list actions touchable.

Fix risk: Low. Presentation-only CSS.

Status: Applied.

### HIGH - Mobile returning login begins below the first viewport

Player impact: At 390x844, `Player Login` begins below the creator form. Returning players must scroll past the full new-character flow before logging in.

Location: Start screen mobile layout.

Recommended fix: On mobile, use a segmented `Create` / `Login` switch, show login first when a local account exists, or place a `Log in` anchor near the top.

Fix risk: Medium. Requires layout/product decision and regression pass across start-screen desktop/mobile.

Status: Recommended, not applied.

### HIGH - Account creation lacks clear pending feedback

Player impact: The click to in-game took about 3.3 seconds. During slow network/storage, players may double click, assume failure, or refresh.

Location: Character creation submit path.

Recommended fix: Disable the create button while registration/first save is pending and change label to `Creating...` or show an inline progress message.

Fix risk: Medium. Needs state plumbing between `CharacterCreator` and `createPlayerAccount`.

Status: Recommended, not applied.

## 4. Medium Priority Friction Bugs

### MEDIUM - Production create-account errors were too generic

Player impact: Reserved name, storage, and legacy-account conditions all looked like a generic retry. Players would not know whether to pick another name, ask an admin, or retry later.

Location: `createPlayerAccount` in `src/App.tsx`.

Recommended fix: Parse the auth response once and display the server-provided `error` when present.

Fix risk: Low. Keeps existing fallback copy.

Status: Applied.

### MEDIUM - Mobile password-eye controls were too small

Player impact: Three start-screen password toggles were 26x26, easy to miss one-handed.

Location: `src/styles/start-skin.css`.

Recommended fix: Keep the icon visual but expand hit area to 40x40.

Fix risk: Low. CSS-only.

Status: Applied.

### MEDIUM - Next-goal dismiss was too narrow on mobile

Player impact: The `Next Goal` close button measured 40 px tall but only 17 px wide, making accidental misses likely.

Location: `src/components/NextGoalPin.tsx`.

Recommended fix: Give the dismiss button a 40x40 inline-flex target.

Fix risk: Low. Inline presentation-only change.

Status: Applied.

### MEDIUM - Mobile menu close could shrink below the declared width

Player impact: The menu close button computed to 32x40 before the fix.

Location: `.mobile-menu-close` in `src/index.css`.

Recommended fix: Prevent flex shrink and pin width/min-width to 40 px.

Fix risk: Low. CSS-only.

Status: Applied.

### MEDIUM - Creator and login name fields used identical placeholder copy

Player impact: On mobile, both fields read `Enter your shinobi name`, increasing wrong-form mistakes.

Location: `src/screens/StartScreen.tsx`.

Recommended fix: Change login placeholder to `Enter existing shinobi name`.

Fix risk: Low. Copy-only.

Status: Applied.

## 5. Low Priority Polish

- Main menu is dense for a first-session player. Consider grouping social/external links below progression actions.
- `Log Back In` is clear, but mobile would benefit from a top `Already have a shinobi? Log in` jump link.
- Daily Briefing secondary links now have better target height, but duplicate labels like `Idle - start` and `0/20` could be more descriptive.
- Start-screen password reveal buttons now have proper hit areas, but the icon-only buttons still rely on aria labels; tooltips or clearer hover/focus states would improve desktop clarity.
- Some old blocking browser dialogs remain (`alert`, `prompt`) in account/delete flows. These work, but in-game modals/toasts would feel more professional.

## 6. Loading Time Findings

Initial app load:
- Behavior: Meaningful start UI in about 530 ms DOM-ready and about 587 ms idle-ish.
- Missing loading state: None observed on local dev.
- Asset/API issue: No warning/error logs observed.
- Fix recommendation: Keep monitoring production bundle/asset timings; local dev looked healthy.

Character creation:
- Behavior: About 3.3 seconds from submit to in-game after dev-auth fix.
- Slow cause: Registration plus first save.
- Missing loading state: Button does not clearly show a pending state.
- Fix recommendation: Add pending state and prevent repeat submits.

Returning login:
- Behavior: About 395 ms to restore the tested account.
- Missing loading state: Not a problem at this speed, but keep retry/fallback messaging.
- Fix recommendation: Preserve fast local preview path.

Main dashboard / village:
- Behavior: Loaded directly after account creation/login. No console warnings.
- Friction: Too much appears at once in the first minute.
- Fix recommendation: Stage Daily Briefing for returning players or after first Academy beat, not immediately during brand-new onboarding.

Daily Briefing:
- Behavior: Rendered immediately; no blank screen.
- Friction: Primary exit CTA was below fold before fix.
- Fix recommendation: Applied sticky footer and larger targets.

Academy/VN start:
- Behavior: `Begin Academy Training` moved through a brief `Loading...` state into companion selection.
- Missing loading state: Present.
- Fix recommendation: Add timeout/error fallback if VN asset/data load fails.

World map / sectors:
- Behavior: Not fully timed in this pass.
- Fix recommendation: Add instrumentation around map mount, sector switch, tile click to avatar move, and encounter trigger.

Combat:
- Behavior: Not fully replayed in this pass. Prior pushed work fixed battle exit traps and active-flow guards.
- Fix recommendation: Keep a regression script for PvP, PvE, Card Clash, and Pet Coliseum exit paths.

Inventory/shop/training/missions/pets/bloodline/admin:
- Behavior: Not individually timed in this pass.
- Fix recommendation: Add lightweight route timing logs and skeletons for large screens, especially admin/editor panels.

## 7. New Player Journey Review

First 5 minutes:
- Strong: Start screen is fast, account creation works after the dev-auth fix, village choice has flavor, and the Academy path is visible.
- Confusing: Character creator and login compete on the same start screen, especially on mobile. After creation, the player quickly sees village lore, Daily Briefing, a main menu, next-goal pin, and Academy prompts.
- Quit risk: Any server/auth error without clear copy, fixed in the create-account path.

First 15 minutes:
- Strong: `Next Goal` and Academy copy tell the player what to do next.
- Confusing: The player can see many systems before they understand the loop: Tavern, Travel, Users, Mail, Missions, Training, Jutsu, Pets, Bloodline, Professions, Logbook, external links, and map destinations.
- Improve first: Gate or visually de-emphasize nonessential systems until the Academy path establishes training, jutsu, mission, combat, and reward loops.

First 30 minutes:
- Strong: There is enough content depth to keep a motivated player exploring.
- Confusing: The world can feel like a control panel before it feels like a guided RPG. If the player leaves the Academy path early, objective clarity depends heavily on the next-goal pin.
- Improve first: Add an always-visible objective route hint on map/combat/training screens and use success toasts when a milestone changes.

## 8. Mobile Experience Review

Layout:
- In-game mobile HUD and bottom nav fit at 390x844 with no horizontal overflow.
- Start screen stacks correctly, but returning login is below fold.

Touch targets:
- Applied fixes removed the observed sub-36px controls from the tested mobile start and in-game views.
- Bottom nav targets measured about 52x52.
- Mobile menu buttons measured about 171x48.

Scroll:
- Start screen scrolls vertically, expected.
- Daily Briefing now keeps its primary exit visible.
- In-game mobile view had minor vertical overflow, expected with content.

Map/combat fit:
- Safe-zone map buttons fit in three columns at the tested size.
- Combat was not fully replayed in this pass and still needs a dedicated mobile combat board check.

Text readability:
- Core mobile text was readable.
- Dense menu/system lists remain the biggest readability risk.

## 9. Combat Feel Review

Responsiveness:
- Full combat was not replayed in this pass. The previous pushed fix addressed PvP/Card Clash/Pet battle exit traps and active-flow guards.

Clarity:
- New-player onboarding reaches jutsu and combat goals through the objective pin, but the player can still enter many systems before understanding AP, range, targeting, cooldowns, or rewards.

Targeting and feedback:
- Needs a dedicated pass using a battle-ready save on desktop and mobile.

Victory/loss/reward flow:
- Previous work specifically improved battle exits. Keep this as a must-regress area because the original player report was about having to refresh after PvP.

Recommended next combat checks:
- PvP complete -> result -> return to village/world.
- PvE complete -> reward explanation -> next objective.
- Card Clash forfeit/win -> return path.
- Pet Coliseum sealed duel -> exit/replay states.
- Mobile board at 390x844 and 430x932.

## 10. Sector / World Map Review

Movement:
- Not fully exercised in this pass.

Objective clarity:
- The next-goal pin helps, but sector/map screens should also show local objective context such as `Go to Sector X`, `Explore tiles`, or `Return to Mission Hall`.

Tile feedback:
- Needs a tile-click timing and blocked-tile feedback pass.

Encounter clarity:
- Prior fixes reduced active-flow conflicts. Still recommend explicit post-encounter breadcrumbs: `Return to sector`, `Return to village`, `Open mission objective`.

Mobile scaling:
- Safe-zone buttons fit at 390x844. Full world map/sector grid needs separate visual verification.

## 11. UI Feedback Review

Needs better loading indicators:
- Account creation and first save.
- Login retry/cold-start path when production storage is slow.
- Larger admin/editor routes.

Needs better success messages:
- First save complete.
- Training started/claimed.
- Mission accepted/completed.
- Item purchased/equipped/sold.
- Pet selected/equipped.

Needs better error messages:
- Create-account path fixed for server auth errors.
- Remaining `alert`/`prompt` flows should be converted to in-game modals over time.

Needs better confirmation dialogs:
- Delete character already prompts, but it uses browser prompt for password fallback.
- Sell/delete inventory and destructive admin/editor flows should use consistent in-game confirmation.

Needs better disabled button explanations:
- Locked pets, jutsu limits, level gates, insufficient currency, and unavailable actions should expose short inline reasons.

Needs better tooltips:
- AP cost, range, cooldown, jutsu tags, bloodline identity, pet role, and currencies.

## 12. Fixes Applied

`shinobij.client/vite.config.ts`:
- Added dev-only `/api/player-auth` middleware for register, verify, change, and delete.
- Uses scrypt-hashed local auth records under `saves/_auth.json`.
- Safe because it only affects local Vite dev middleware and mirrors production response shapes.

`shinobij.client/src/App.tsx`:
- Create-account now displays server-provided error copy when available.
- Safe because it keeps existing fallback text and only parses the response once.

`shinobij.client/src/index.css`:
- Daily Briefing card uses dynamic viewport max height and stable scrollbar gutter.
- Daily Briefing footer is sticky so `Enter the village` remains reachable.
- Daily Briefing close/list actions have larger targets.
- Mobile menu close can no longer shrink below 40 px.
- Safe because these are presentation-only changes on targeted classes.

`shinobij.client/src/components/NextGoalPin.tsx`:
- Goal dismiss button now has a 40x40 inline-flex hit area.
- Safe because objective and dismissal logic are unchanged.

`shinobij.client/src/styles/start-skin.css`:
- Start-screen password-eye buttons now have 40x40 hit areas.
- Safe because it preserves existing icon/transparent styling.

`shinobij.client/src/screens/StartScreen.tsx`:
- Login name placeholder changed to `Enter existing shinobi name`.
- Safe because it is copy-only.

## 13. Fixes Recommended But Not Applied

Mobile create/login switch:
- Why not applied: Requires product/layout decision.
- Risk: Medium.
- Next step: Add segmented control or top login jump; verify desktop and mobile.

Create/login pending states:
- Why not applied: Requires parent-child state plumbing.
- Risk: Medium.
- Next step: Add `isCreating` and `isLoggingIn` props to start forms, disable submit buttons, and show pending labels.

Staged first-session onboarding:
- Why not applied: Needs design decision about when Daily Briefing appears for new accounts.
- Risk: Medium.
- Next step: Hide Daily Briefing until after first Academy milestone or first logout/login.

Combat mobile regression harness:
- Why not applied: Needs a battle-ready fixture/save and scripted battle paths.
- Risk: Medium.
- Next step: Add browser smoke scripts for PvP, PvE, Card Clash, and Pet Coliseum result exits.

World map/sector timing and objective hints:
- Why not applied: Needs deeper map route pass.
- Risk: Medium.
- Next step: Instrument map load, movement delay, blocked-tile feedback, and post-encounter return.

Inventory/shop compare and feedback pass:
- Why not applied: Not reached in tested new-player path.
- Risk: Low to medium.
- Next step: Audit equip/sell/buy states with a mid-game save.

Replace blocking alerts/prompts:
- Why not applied: Broad UI pattern change.
- Risk: Medium.
- Next step: Introduce shared toast/confirm/password modal components and migrate the highest-traffic flows first.

## 14. Final Player Friction Action Plan

Must fix before beta:
- Keep battle-exit regression tests green for PvP, PvE, Card Clash, and Pet Coliseum.
- Add visible pending states for account creation and login.
- Put mobile login within the first viewport or add an obvious top jump.
- Add objective breadcrumbs to sector/world/combat return paths.

Should fix before beta:
- Delay Daily Briefing for brand-new players until after the first Academy beat.
- Add route timing instrumentation for map, combat, inventory, pets, bloodline, missions, and admin.
- Convert most common `alert` errors into in-game messages.
- Add success feedback for training, mission, purchase/equip, pet, and jutsu actions.

Can fix after beta:
- Rebalance main menu ordering and grouping.
- Add more tooltips for currencies, jutsu tags, AP/range/cooldowns, pet roles, and bloodline identity.
- Improve duplicate/ambiguous labels inside Daily Briefing secondary links.

Long-term polish:
- Build a guided first-session mode that gradually unlocks visible systems.
- Add automated browser smoke tests for new player, returning player, mobile player, and post-combat flows.
- Add production performance marks so slow screens are measured from real player sessions, not only local QA.
