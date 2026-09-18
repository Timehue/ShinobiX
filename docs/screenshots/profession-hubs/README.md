# Profession headquarters

Local browser captures of the Vanguard, Pet Tamer, and Healer redesign, using deterministic QA characters rather than live accounts. Desktop: 1440 × 1000. Mobile: 390 × 844.

The pages reuse the game's profession paintings, location scenes, pet portraits, display font, and aged-gold palette. Each profession has a restrained accent color. Emoji headings and action buttons have been replaced with typography, rank insignia, resource artwork, and illustrated destinations.

- `vanguard-desktop.png` / `vanguard-mobile.png`: hero, rank progress, Honor Seal ledger, and deployment scenes.
- `pet-tamer-desktop.png` / `pet-tamer-mobile.png`: hero and current profession bonuses.
- `companions-desktop.png`: companion portraits and daily missions.
- `healer-desktop.png` / `healer-mobile.png`: hero, chakra reserve, and healing benefits.

Run the focused browser checks from `shinobij.client`:

```powershell
node node_modules/@playwright/test/cli.js test -c playwright.professions.config.ts
```

The preview uses an isolated Vite dependency cache and scans only the game entry. The first visit compiles the full game; subsequent checks reuse that process. Browser checks use a deterministic API fixture, not live player accounts.

Coverage includes both viewports, artwork loading, containment, every headquarters destination, real menu navigation and Back history, the empty companion roster, published pet portraits, UTC Seal resets and mastery caps, mastery investment/respec across reloads, Sector Map maintenance, healing receipts and idempotent retries, rejected stale healing responses, daily mission error recovery, and profession changes updating the hub/menu/missions/progression together.

Integration recheck: all 24 desktop/mobile cases passed across full and focused runs. Destination checks also wait for rendered content and reject caught React rendering errors. Fixtures mirror the Sector Map response and the Pet Arena's HTTP 204 response when no active battle exists. The cold-start allowance is five minutes because the complete game module graph can exceed three minutes on this workstation. All 100 targeted client/server logic tests passed, as did the client TypeScript build check and targeted ESLint checks.

Release recheck against current main: the production build, artifact verification, size budgets, and full client lint passed (14 existing lint warnings). All 105 targeted logic/API tests passed, including the latest shared-image hydration checks. The built artifact passed all 84 profession scenarios across the seven standard browser/viewport projects across the full run and a focused rerun. The two healing cases now pause the browser clock immediately before accepting the successful receipt so passive chakra regeneration cannot race the exact debit assertion; all 14 healing/browser combinations passed after that adjustment. The existing WebKit navigation checks also passed locally. CI remains the Linux release gate.

Run the profession checks against a completed production build with the standard configuration:

```powershell
node node_modules/@playwright/test/cli.js test e2e/profession-hubs.spec.ts --workers=2
```
