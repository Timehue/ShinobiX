# Landing page refresh — September 18, 2026

The homepage takes visual direction from the Elder Scrolls Online home page: a cinematic image-led opening, restrained gold navigation and actions, large editorial headings, and clear sections introducing the world. All imagery and copy remain specific to Shinobi Journey.

## Implementation

- `shinobij.client/src/screens/StartScreen.tsx`: complete responsive landing composition, full logo in all placements, mobile navigation, existing registration/login/guide/leaderboard actions retained.
- `shinobij.client/src/screens/start/GameplayGallery.tsx`: five gameplay tabs, including a four-image mobile gallery, keyboard-operable tabs, and a native modal image viewer with Escape dismissal and focus restoration.
- `shinobij.client/src/styles/landing-skin.css`: replaced the previous homepage rules; retained account and legal-page styling. Homepage typography is scoped to `#landing-home` to avoid the game shell's mobile paragraph overrides.
- `shinobij.client/public/boot-watchdog.js`: first-visit hero preload points to the new artwork. Saved accounts still skip the preload.
- `shinobij.client/public/landing/`: locally shipped WebP artwork and screenshots. No remote image requests or new dependencies.

## Images

| Supplied image | Export | Use |
| --- | --- | --- |
| 1 | `story.webp` | Story gallery and cinematic-story feature |
| 2 | `companion.webp` | Companion feature, discovery tile, hero art reference |
| 3 | `mobile-combat.webp` | Mobile gameplay gallery |
| 4 | `cards.webp` | Card battle gallery |
| 5 | `pet-arena.webp` | Pet arena gallery |
| 6 | `combat.webp` | Tactical combat gallery |

Gameplay captures are faithfully resized and encoded, not redrawn. The gallery uses `object-fit: contain` so the complete capture remains available. Artwork uses intentional responsive framing. The existing high-quality village and clan artwork is retained.

### Mobile gallery follow-up

The owner supplied additional mobile captures on September 18. These are encoded at their original dimensions as WebP (quality 92):

| Owner attachment | Export | Dimensions |
| --- | --- | --- |
| `codex-clipboard-8a614489-cc38-4075-9fdf-26524f360843.png` — Ridge Post Four | `mobile-story.webp` | 1080 × 2340 |
| `codex-clipboard-2f0c6bb5-ad8a-4d5e-b12b-7127d289d2d9.png` — Codex Hall battle | `mobile-cards.webp` | 1080 × 2340 |
| `codex-clipboard-9425fa1a-a3e4-4522-ba94-8c8fc45e09d3.png` — icy pet arena | `mobile-pet-arena.webp` | 605 × 730 |

The second pet attachment was a duplicate. The three new images add approximately 473 KB and load lazily alongside the existing mobile combat screenshot. All four remain uncropped and can be enlarged individually. The shorter pet image has a blurred decorative backdrop to fill its frame without cropping the gameplay. Desktop shows four columns; phones show two.

The “Discover your journey” control is centered with inset/margins instead of a transform, and explicitly stays stationary on hover. The Discord call to action also stays stationary. Regression coverage checks their bounding boxes before and after hover, all four mobile images and modal focus restoration, and overflow at 320, 390, 768, and 1366 pixels.

Follow-up verification: TypeScript, ESLint for the gallery and visual spec, and the production build passed. The eight landing visual/gallery scenarios passed; the focused hover regression passed after correcting the Discord selector specificity. The new mobile-gallery baseline brings the suite to 20 images / 10.21 MB, within its 20-image / 12 MiB limits. The desktop four-column presentation and phone two-column capture were visually reviewed.

The old navigation logo file was cropped within the source image. The new transparent logo contains the complete emblem, both points, and the kunai; all logo placements use `object-fit: contain` and proportional sizing. A small export serves navigation/footer placements.

## Generated artwork

Tool: built-in imagegen, using the imagegen skill. Final project assets:

- `shinobij.client/public/landing/hero-shinobi.webp`
- `shinobij.client/public/landing/logo-complete.webp`
- `shinobij.client/public/landing/logo-small.webp`

### Hero prompt

Use case: ads-marketing. Create a premium cinematic ultrawide website hero key art for Shinobi Journey, 2560x1440 landscape. Use the attached artwork as the exact character and world style reference: dark-haired young adult shinobi with tied-back hair, layered ink-black practical armor and navy scarf, and his orange fox companion with glowing golden tail. Recompose into a beautiful expansive landscape: character standing in three-quarter profile and fox together on a rocky overlook in the RIGHT THIRD, looking over a magnificent hidden mountain village of Japanese pagodas, bridges and waterfalls, ancient golden ginkgo canopy framing top right, autumn leaves drifting. LEFT HALF must be atmospheric dark blue-gray negative space with misty distant mountain silhouettes, suitable for overlaying a large logo and copy, no dominant objects there. Golden sunset behind the village at center-right; exquisite painterly anime game concept art, exceptionally refined silhouettes, rich natural textures, restrained gold light, majestic scale and depth, crisp clean illustration, AAA key art. No text, no lettering, no logos, no UI, no border. Keep face readable and entire head within safe margins, fox identifiable. Landscape wide composition, never a portrait.

The generated master returned at 1672 × 941; the web export preserves that native resolution rather than artificially upscaling it.

### Logo prompt

Use case: background-extraction / precise-object-edit. Edit this Shinobi Journey logo into a pristine production-ready transparent PNG logo asset. Preserve the exact text SHINOBI JOURNEY, existing dynamic gold brush letterforms, circular black iron medallion, orange sunset pagoda, throwing star top and bottom points, and horizontal kunai below JOURNEY. Preserve brand identity and composition very closely. Clean all rough blocky extraction artifacts, fringe pixels, gray/white bands and stray rectangles around the exterior. The entire area outside the emblem and intentional ink flourishes MUST be genuinely transparent alpha, not a checkerboard or white background. Keep the whole complete logo including top tip and bottom tip well inside the canvas with generous 8% transparent padding on all four sides; absolutely no cropping of top, bottom or sides. All lettering perfectly legible, tasteful gold metal details. Wide landscape asset, output transparent PNG.

The generated master returned at 1688 × 932 with a real alpha channel. Web exports retain transparency and the complete image.

## Validation

- Client TypeScript project build: passed.
- ESLint on the two changed React components: passed.
- Existing OAuth branding, conditional preload, and mobile touch-target checks: 18 passed.
- Production Vite build: passed.
- Browser inspection: 1440 × 900 desktop, 768 × 1024 tablet, 390 × 844 mobile, and 320 × 740 compact phone. No horizontal overflow; full logo retained.
- All five gallery choices checked; card screenshot enlargement and Escape dismissal checked; arrow-key tab switching checked.
- Mobile menu opening, section navigation, closing, and Escape checked.
- Character creator, login, and guide entry flows checked without creating an account or changing game data.

The seven existing landing visual scenarios passed both regeneration and a subsequent comparison run (7/7). The visual-baseline size check also passed (19 total suite files, 9.89 MB against the 12 MiB limit). All 17 landing screenshot baselines were refreshed for the new design, including the hero, feature tiles, gameplay gallery, story/companion sections, finale, and footer. The desktop and mobile hero, gallery, and story captures were visually reviewed.

The initial design pass did not deploy or commit. The authorized main release is documented below; unrelated working-tree changes are excluded.

## Final integration and presentation audit

The final pass verified all 13 desktop entry points into character creation, account login, guides, and the leaderboard; all nine footer policy routes and their return links; all five gallery tabs and four mobile captures; keyboard navigation, Escape dismissal, focus restoration, reduced motion, and the server-driven registration pause. Image requests and share metadata are checked against the production build, with no landing-page JavaScript errors. The Discord invite was checked against Discord's invite API and resolves to **Shinobi Journey**.

Finishing corrections:

- Prevent the game's generic button lift/shadow from leaking into landing navigation, gallery controls, footer links, menu toggle, and screenshot close button.
- Move keyboard focus into the opened mobile navigation and to the selected page section when navigating.
- Mount full-size screenshots only when requested, focus the close button after the dialog renders, lock background scrolling, and remove the image again on close. Explicitly return focus to the opening image button: WebKit does not focus buttons on pointer click, so native dialog restoration alone was insufficient.
- Disable decorative hover transforms for visitors requesting reduced motion.
- Update Open Graph and Twitter sharing to the new hero artwork, with its correct dimensions and description.
- A local Settings presentation-map issue was corrected during the initial workspace audit. That unrelated change is excluded from the landing release, which builds on the latest remote main.

The functional audit is retained in `e2e-visual/release-surfaces.visual.spec.ts`. Run the regular Chromium landing checks with `npm run test:e2e:visual -- --grep landing`. Run the same integration checks on Firefox and WebKit with `node node_modules/@playwright/test/cli.js test -c playwright.landing-audit.config.ts` after building the client.

The browser integration tests mock API responses to exercise entry flows and availability states without creating accounts or submitting credentials. They verify the landing's wiring, not live authenticated gameplay or a production deployment. Manual visual review covers the complete logo, phone navigation, desktop composition, and screenshot viewer; the smallest checked viewport is 320 × 740.

Final results: all 14 Chromium landing scenarios passed together against the final build. The five integration scenarios passed on both Firefox and WebKit, with the WebKit focus issue corrected and the affected scenario rechecked on both engines. All 18 branding/preload/mobile contract tests, the client TypeScript build, changed-file ESLint, the production Vite build, and the visual-baseline budget check passed. Baselines total 20 files / 10,211,063 bytes, below the 12 MiB budget. Password recovery was also opened and inspected without submitting account data.

## Hero atmosphere

The hero now includes slowly rising gold embers, a few larger drifting flecks, and a soft warm-light pulse matched to the sunset and fox artwork. The layer fades away from the desktop copy and is confined to the upper artwork on phones. It uses CSS opacity/transform animations with no new dependencies or media downloads: 44 particles on desktop, 14 on mobile. Desktop particles are larger, drift 25% faster, and have a stronger glow; mobile retains the original lighter sizing, speed, and light pulse.

The user-requested removal of the manual Pause/Play control also removes its persisted session setting. Animation pauses automatically when the hero leaves the viewport or the document is hidden; observers and listeners are cleaned up when leaving the landing page. Reduced-motion preferences hide the decorative layer entirely.

On desktop, 18 additional golden canopy flecks originate along the upper-right tree branches and drift down and left with a slow tumble. These complement the rising embers below, share the same automatic visibility handling, and are hidden without animation on mobile so the lighter phone effect remains intact.

### Cinematic depth and scroll pacing

Two translucent mist layers drift through the valley at independent 26- and 34-second rates. A separate 8-second glow breathes around the fox tail; the broad sunset light no longer doubles as the tail glow. All hero layers share the document-visibility, offscreen, and reduced-motion handling. Phones keep one faint mist layer and omit the additional foreground mist and tail aura. No new assets, dependencies, per-frame JavaScript, or animated blur were added.

Section headings, feature cards, gameplay media, story/companion blocks, and the final invitation use one-time fade/rise entrances. Desktop cards stagger by 100ms. Mobile entrances are shorter with less travel. Content stays visible before observation, content already on screen is never introduced again, keyboard focus cancels an entrance immediately, and changing reduced-motion preferences removes the animations. Navigation, Discord, and the discovery cue retain their stationary hover behavior.

Validation after these additions: all 16 Chromium landing scenarios passed, including the existing layout baselines and entry-flow checks. The atmosphere and scroll-reveal scenarios also passed on Firefox and WebKit (four additional runs). Tests cover real layer movement, shared pause, mobile omissions, one-time entrances, keyboard focus, and reduced motion. Client TypeScript, changed-file ESLint, production build, and the unchanged 20-file visual-baseline budget all passed. The desktop hero, feature composition, and phone hero were manually reviewed in the local preview.

### Mobile brand placement

At phone widths (560px and below), the eyebrow, complete logo, and headline sit 224px higher than the original layout, including a further requested 48px lift. The description and actions stay below the artwork, leaving the middle open for the fox. The mobile shading is lighter around the companion, and the higher text gains a subtle dark shadow for contrast against the sky. The manual motion control has been removed from both desktop and mobile at the user's request. Desktop and tablet brand placement is unchanged. The 320px and 390px phone layouts were visually checked; the mobile hero baseline is updated for this composition.

Verification: client TypeScript, changed-file ESLint, production build, and visual-baseline size budget passed. The focused browser scenario checks actual particle movement, automatic offscreen pause/resume, ignoring the removed control's saved preference, mobile density and overflow, and reduced motion. The desktop, compact, and phone hero visual scenarios passed. Desktop and 390px phone presentations were also reviewed in the local preview.

### Neutral charcoal palette

Removed the green spotlight gradients from the feature and gameplay sections and replaced teal-tinted page surfaces with coordinated charcoal, warm black, and neutral image frames. Header, mobile navigation, story and companion sections, gallery, lightbox, footer, and hero fades now share that palette. Secondary copy uses warm gray; mist is neutral and slightly softer. Gold accents and original artwork carry the color. This is scoped to the public homepage CSS, preserving account and legal-page styling, gameplay captures, animations, and mobile logo placement.

The production build and all 16 Chromium landing scenarios passed. Desktop features, story framing, mobile gallery, and the 390px phone hero were visually reviewed. All 18 landing screenshot baselines were refreshed with zero color tolerance because the normal comparison tolerance intentionally ignores subtle color shifts; normal suite tolerances remain unchanged. The baseline budget passes at 20 total files / 9,764,962 bytes, below 12 MiB.

## Landing lifecycle and resource audit

The September 18 audit found two sources of unnecessary work outside the decorative landing components:

- `App.tsx` started its one-second idle-vitals timer and 20-second stale-duel sweep without a character. Both now start only for a loaded character and clear when that character is removed. Existing signed-in regeneration behavior is preserved.
- The startup fingerprint probe allocated a detached WebGL context and relied on garbage collection to release it. It now explicitly loses that temporary context in `finally` and shrinks the backing canvas. Fingerprint values and session caching are unchanged; tests cover successful reads, failed reads, cleanup errors, and unavailable cleanup extensions.

The landing's own observers and visibility/media-query listeners already clean up on unmount. The animations use CSS, with no JavaScript frame loop. They pause offscreen and on the document visibility signal; reduced motion disables them. Gallery images are removed when their dialog closes and the CSS scroll lock clears. The shared capability poll is intentionally retained to keep login/registration availability fresh; it maintains one scheduled refresh, cancels it while hidden, and disposes its listeners and schedule on provider unmount.

The new `e2e-visual/landing-lifecycle.spec.ts` opens/closes a gameplay screenshot and leaves/returns through Account 15 times in each browser engine. It checks stable observer/listener/interval counts, no remaining landing observers on Account, no idle JavaScript frame callbacks, no live WebGL context, and no new contexts on repeated navigation. Chromium also collects garbage before heap and DOM samples. The visibility check simulates the browser's visibility signal to exercise the actual handler.

Saved evidence: [Chromium](./lifecycle-chromium.json), [Firefox](./lifecycle-firefox.json), [WebKit](./lifecycle-webkit.json).

In the Chromium sample, the DOM held at 1 document / 1,159 nodes / 249 listeners from cycle 3 through cycle 15. Collected JavaScript heap rose from 6,611,560 to 6,979,068 bytes, with decreasing increments after warmup. Landing observers returned to two on each visit and zero on Account; the two local listener counts also returned to their exact baselines. Active intervals, pending JavaScript frames, and live WebGL contexts were zero. The two-second foreground/offscreen samples recorded zero layout passes. These are bounded browser-process measurements, not physical GPU utilization or proof about every long-running gameplay screen.

Validation: production build, client TypeScript build, changed-file ESLint, and 14 fingerprint/vitals unit checks passed. All 17 Chromium landing scenarios passed, including the new lifecycle check. Firefox and WebKit passed all resource checks and entry/policy/availability checks. One Firefox navigation test raced a still-running explicit smooth scroll; the test now waits for the destination to reach its scroll margin before clicking another card. That path passed twice in each of Firefox and WebKit after correction. The public Discord invite was independently checked and still resolves to Shinobi Journey. API-backed entry checks use mocks and do not submit live credentials or create accounts.

## Main release preparation

The release is isolated on top of remote main commit `2808be23f711d47e99488d8a7f67eb4174a07b23`. It contains the landing artwork, layout, animation and navigation work; its browser evidence; and the two audited timer/fingerprint resource fixes. Unrelated local gameplay and Settings changes are excluded.

Homepage-only styles now load with the lazy StartScreen module from `src/styles/landing-home.css`. Shared account and policy styles remain globally available in `landing-skin.css`. This keeps the existing initial-download budget unchanged and avoids sending the homepage stylesheet on a signed-in startup. Asset-preload and mobile touch-target contracts follow the new stylesheet location.

Release preflight passed: full client lint (zero errors; 14 existing warnings outside the changed files), TypeScript and production build, 39 focused unit/contract checks, 17 Chromium landing scenarios, 16 Firefox/WebKit scenarios, release asset validation, and the visual baseline budget. Production-shaped public build configuration yields an initial graph of 1,433,192 raw bytes / 385,445 gzip bytes, within the unchanged size gate. All 18 landing screenshot baselines match after deferring the CSS. The lifecycle JSON above contains fresh results from this isolated release build.
