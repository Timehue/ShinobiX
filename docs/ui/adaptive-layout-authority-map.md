# ShinobiX adaptive layout authority map

Status: implemented and verified
Baseline commit: `3431174b6d6ea2b21a4a0497e90f768156785516`
Baseline branch: `codex/uiauto` (the shared checkout was concurrently moved to
`codex/jutsu-parity-combat-ui` at the same commit before implementation began).
Because that shared checkout already contained unrelated dirty changes, all
reproducible before metrics and screenshots use the clean baseline commit rather
than claiming to reconstruct the exact initial dirty worktree.

## Purpose

This document records the active runtime surfaces, the layout rules that reached
them before the adaptive consolidation, and the single owner for each responsive
responsibility after migration. It distinguishes normal DOM reflow from logical
game-stage fitting. Visual presentation continues to come from Veiled Steel; this
map covers geometry, containment, scrolling, and input alignment.

## Breakpoint contract

The application has one content-fit contract. JavaScript exports these values from
`src/lib/viewport-contract.ts`; CSS mirrors the same boundaries because custom
properties cannot be used in media-query conditions.

| Mode | Inclusive CSS width | Runtime class | Shell behavior |
|---|---:|---|---|
| Phone | below 560px | `xs` | mobile HUD/navigation, one-column content |
| Tablet | 560-979px | `sm` | mobile HUD/navigation, wider reflowing content |
| Compact | 980-1179px | `md` | compact desktop rails, intrinsic center track |
| Desktop | 1180-1399px | `lg` | full desktop shell |
| Wide | 1400-2199px | `xl` | full desktop shell with bounded fluid spacing |
| Ultrawide | 2200px and above | `xxl` | bounded desktop composition; no global scaling |

The navigation handoff is exact at 980px: `xs`/`sm` show the mobile status and
navigation surfaces and hide both desktop rails; `md` and above show desktop
rails and hide mobile navigation. Component-local structure changes should use
container queries, not new shell breakpoints.

## Authority table

| Responsibility | Previous owners and conflict | JS involvement | Previous `!important` | New authority |
|---|---|---|---:|---|
| Root viewport height | `01-base-app-chrome`, `10-layout-lock-herald`, `24-combat-mobile-restore`, `27-mobile-polish-fixes`, `30-combat-viewport-fit` | `body.in-battle` | yes | `adaptive-shell.css` for normal UI; `CombatInstance`/combat stylesheet for a fight |
| Page scrolling | document, `.center-game`, and route fixes competed in `10`, `23`, `24`, `27`, `30` | battle body class | yes | `adaptive-shell.css`: center scroller on desktop, document scroller on mobile; explicit route scrollers only where documented |
| Normal application shell | fixed margins/calc in `10` and `18`; late token shadowing in Veiled Steel | shell markup in `App.tsx` | yes | `AdaptiveGameShell.tsx` plus `adaptive-shell.css` grid |
| Main content width/margins | `10`, `14`, `18`, `23`, `24`, `26`, `27`, `30`, Veiled Steel | none | yes | middle `minmax(0, 1fr)` grid track; no `100vw - rails` calculation |
| Left rail | `02`, `03`, `13`, `18`, `26`, battle skin, Veiled Steel | conditional mount in App | yes | `adaptive-shell.css`; shell mode owns visibility and track width |
| Right rail | `02`, `18`, `26`, Veiled Steel; collapsed visual width disagreed with reserved center margin | `RightMenu` open/closed class | yes | `adaptive-shell.css`; `:has(> .right-menu-panel.closed)` switches the tokenized grid track |
| Mobile top HUD | `23` revealed separately from rail-hide rule | mounted with normal chrome | yes | same 980px block as rail handoff in `adaptive-shell.css` |
| Mobile bottom navigation | `23` visibility and `18`/`27` clearance had separate owners | mounted with normal chrome | yes | same 980px block and `--shell-mobile-nav-clearance` in `adaptive-shell.css` |
| Banner dimensions | dead `.journey-banner` sizing persists after `banner-skin.css` hides it | `SectorBanner` active for selected routes | yes | active rail/banner sizing in `adaptive-shell.css`; dead journey geometry retired |
| Dialog containment | `ui.css` card itself scrolled; Veiled Steel mobile bottom-sheet override | canonical `Modal` portal/focus/lock stack | limited | `ui.css`: grid card, scrollable body, fixed header/footer, dynamic-viewport and safe-area bounds |
| Drawers/sheets | mobile menu and profile sheet independently managed focus/locks | `MobileNav`, `MobileProfileSheet` | yes | shared overlay tokens and existing body-lock hook; each surface remains explicit until a shared Drawer primitive is justified |
| Overlay stacking | 57 raw CSS z-index values plus inline values; token scale almost unused | many portals | mixed | `tokens.css` overlay tiers; top-level shells/dialogs/nav/toasts consume tokens |
| Combat viewport | `06`, `18`, `24`, `26`, `30`, `battle-skin`, per-screen styles competed | `CombatInstance` body portal, `body.in-battle` | yes | `CombatInstance` remains boundary; `ShinobiCombatShell` owns shared solo/PvP composition |
| Combat grid fit | duplicated width/height rules plus shared hook | `useBoardScale` | yes | `useBoardScale` is the sole measured logical-board scale; container owns available size |
| Battle HUD placement | old portal sidebar and newer in-grid dossiers could both activate | legacy `#battle-hud-portal` | yes | in-grid dossier contract in `ShinobiCombatShell`; compatibility portal target remains only for unmigrated hosts |
| World map | fixed percentage markers plus `world-map-zoom` CSS/JS | `useWorldMapZoom` | mixed | map stage preserves aspect ratio and percentage coordinates; its measured viewport owns pan/zoom |
| Sector maps | several screen-specific fixed-height/panning overrides | flat/Three.js conditional render | yes | map viewport owns clipping/panning; ordinary actions reflow outside the stage |
| Card field | `chronicle-duel.css` owns a fixed five-zone field and viewport mode | `ChronicleDuelBoard` | mixed | card field remains a fitted logical stage; hand/log/actions use deliberate scroll/drawer regions |
| Visual novel | classic inline and cinematic portal variants | `TriggeredVisualNovel`, cinematic body lock | mixed | cinematic stage owns immersive viewport; classic content reflows and scrolls normally |
| Three.js/canvas | per-feature Canvas defaults and window-derived UI measurements | R3F size/camera/raycast, device-tier DPR | no global owner | each renderer measures its real container, clamps DPR, and keeps overlays/input in the same coordinate space |
| Admin/creator tools | component and feature CSS with ad hoc fixed columns | role state only | mixed | normal DOM reflow, local split-panel/container-query rules, and local table overflow only |
| UI preference | no active global scale preference found | storage searches found no shell-scale authority | no | automatic layout only; future density preference may adjust bounded tokens, never root scale |

## Active route and surface inventory

Classification: A normal reflowing DOM; B fitted fixed-coordinate DOM; C canvas or
WebGL; D static/semi-interactive artwork; E isolated/full-viewport mode; F
role-restricted management.

| Runtime surfaces | Class | Active behavior |
|---|---|---|
| Start, login, character creation, legal pages | A, D | responsive normal UI |
| Village, Central Hub | A, C, D | normal shell with decorative canvases |
| Profile, Inventory/equipment, Logbook/Legacy, Training, Jutsu Training, Missions, Bloodline Maker | A | normal shell; mission actions may launch isolated fights |
| Town Hall, Clan Hall, Bank, Hospital, shops, marketplace, cafeteria, tavern | A | normal shell; local lists/forms/chat own only their content scrolling |
| Home/Pet Yard, hunting, messages, guides, professions, Hall of Legends, Shinobi Council, user views | A | normal shell; pet evolution can open a C/E cutscene |
| World Map | A, B, C, D | percentage-coordinate atlas plus measured pan/zoom; sector views may render Three.js ambience |
| Village War and Village War Map | A | management/card UI; despite its name, Village War Map is not a coordinate stage |
| Arena, Battle Arena, Arena District | A lobby; B, E fight | shared fixed hex board in isolated combat |
| PvP, missions, story, AI host, Hollow Gate, Towers, Weekly Boss, Clan Boss | B, E | `CombatInstance` body portal and shared board scale |
| Pet Arena, Pet Ladder, Sector War pet, event pet battles, dungeon pet duel | A lobby; C, E fight | R3F/canvas tactical surfaces |
| Card Hall/Shinobi Tiles, Card Clash, Sector War cards, event/tilecards duel | A lobby; B, E duel | shared `ChronicleDuelBoard` logical field |
| Triggered/cinematic visual novel, onboarding cinematic | D, E (and C where companion render is active) | body-portaled immersive stage with explicit scroll lock |
| Dungeon classic VN and archive story content | A, D | inline/reflowing story presentation |
| Admin login/panel and all creator editors | A, F | dense management UI; Bloodline Maker is also player-facing A |
| Profession picker | A, E | required full-viewport portal |
| Retired compatibility routes `storyBoss`, `hollowGateTiles` | B/D, E | restore compatibility only; not production navigation targets |

## Scroll ownership

- Normal desktop (`md`-`xxl`): `.center-game` is the one primary vertical
  scroller. The grid shell and both rails remain viewport-bound.
- Normal mobile (`xs`/`sm`): the document is the primary vertical scroller;
  `.center-game` expands with content and reserves safe bottom-navigation space.
- Tavern mobile: the screen is viewport-bound and `.tavern-log` is the sole
  message scroller.
- Battle Arena mobile lobby: `.center-game.screen-battleArena` is an explicit
  route scroller to prevent gesture fall-through into fixed navigation.
- Combat: the body-portaled combat instance owns a `100dvh` isolated viewport.
- Modal: backdrop/card remain fixed; only `.ui-modal-body` scrolls (bare feature dialogs retain their explicitly bounded internal scroller).
- Maps/card fields: only a deliberately marked stage/hand/table region may pan
  horizontally. Page-level horizontal scrolling is never intentional.

## Specialized-surface contract

### Combat

`CombatInstance` remains the body portal. `ShinobiCombatShell` owns the common
solo/PvP responsive composition, while `BattleTowerFight` remains an explicit
variant. `useBoardScale` remains the only auto-fit implementation for all fixed
hex boards and must cleanly disconnect its `ResizeObserver`. UI panels reflow;
only the logical grid layer is transformed. Pointer and VFX anchors remain in
logical board coordinates and use the same effective scale/centering values.

### Maps

The atlas preserves its authored aspect ratio and percentage marker coordinates.
Pan/zoom occurs inside the measured map viewport. Sector actions and labels stay
outside transformed map content when possible. Resize observers must disconnect
on ref replacement/unmount.

### Card games

`ChronicleDuelBoard` preserves slot geometry. The field may fit as a logical
stage, but the hand, inspector, log, and actions must remain readable and
touchable. Mobile composition uses scrollable/focused regions rather than a
globally shrunken page.

### Visual novels

Cinematic stages are isolated body portals; classic stages are normal DOM.
Dialogue and choices own deliberate internal scrolling so long text cannot hide
the final line or required actions. Safe-area padding applies to skip/back and
choice controls.

### Three.js and canvas

Each active R3F/native-canvas feature owns renderer sizing for its actual
container. Perspective cameras/raycast mapping use renderer size; DPR is capped
by the feature quality policy. DOM overlays derive from the same container
coordinates. No outer-canvas CSS scale substitutes for renderer resizing.

### Admin and creator tools

Editors remain normal DOM. Split panes collapse by available container width;
action bars wrap or become locally sticky; tables may scroll only within a
labeled region. Role restriction does not exempt controls from viewport or
keyboard requirements.

## Baseline measurements

| Measure | Before migration |
|---|---:|
| Direct `.center-game` rule files | 13 (12 geometry owners) |
| Normal-root width/overflow declaring files | 6 |
| Desktop rail display authorities | 3 CSS sheets plus App conditional mounting |
| Mobile navigation visibility authorities | 1 CSS sheet, but handoff/clearance split across 3 sheets |
| Active breakpoint contracts | 4 including isolated combat (3 normal-shell contracts) |
| Strict shell geometry `!important` declarations outside an authority | 172 |
| `!important` in the named conflict files | 2,457 |
| `!important` across application source CSS | 5,163 in 72 CSS files |
| Active global root scale mechanisms | 0 |
| Broad viewport typography/control scaling passes | 1 (`28-desktop-scaling.css`) |
| Repository CSS numeric media-query values | 40 non-zero values |

The repository-wide baseline build passed. Client lint passed. The first full
test run completed 4,923/4,925 tests and exposed two failures in the concurrent
combat worktree; these are tracked as starting-state failures, not adaptive-shell
regressions.

## Final measurements

Measurements compare clean commit `3431174b6` with the final shared worktree.
The latter also includes pre-existing/concurrent combat-layout changes. Counts
of `!important` strip block comments first, then count the literal token in all
`src/**/*.css`; the named set is the same eleven high-conflict sheets on both
sides (`10`, `13`, `18`, `23`, `24`, `26`, `27`, `28`, `30`, `battle-skin`, and
Veiled Steel). Selector-authority counts parse selector lists and use the
rightmost subject; pseudo-elements are visual, not structural owners.

| Measure | Before | After | Change |
|---|---:|---:|---:|
| Files with a direct `.center-game` rule | 13 | 3 (authority plus 2 visual-only files) | -10 |
| Direct `.center-game` geometry owners outside the authority | 12 | 0 | -12 |
| Normal-root width/overflow declaring files | 6 | 1 (`adaptive-shell.css`) | -5 |
| Desktop rail display/visibility declaring files | 3 | 1 (`adaptive-shell.css`) | -2 |
| Mobile HUD/navigation display/visibility declaring files | 1 (clearance/handoff split elsewhere) | 1 (`adaptive-shell.css`, including clearance/handoff) | consolidated |
| Normal-shell breakpoint contracts | 3 | 1 | -2 |
| Strict shell geometry `!important` declarations outside the authority | 172 | 0 | -172 |
| Authority-owned shell `!important` declarations | 0 | 11 route/isolated-mode exceptions | +11, explicit and guarded |
| `!important` in the named conflict files | 2,457 | 2,500 | +43 (+1.8%; concurrent combat work and the input-blocking combat modal included) |
| `!important` across application source CSS | 5,163 in 72 files | 5,155 in 75 files | -8 (-0.2%) |
| Broad viewport typography/control scaling passes | 1 | 0 | -1 |
| Global application/root scaling mechanisms | 0 | 0 | unchanged; explicitly guarded |
| Unintended horizontal-overflow assertion failures | not established | 0 | passing viewport matrix |
| Viewport-matrix assertion failures | not established | 0 | passing 22-size matrix |

The remaining `!important` declarations are primarily feature skins, isolated
combat compatibility, and inline-style overrides in legacy specialized modes.
The migration deliberately did not perform a blind repository-wide removal.

## Migration ledger

| Area | Migrated rule | Previous rule narrowed/removed | Compatibility retained |
|---|---|---|---|
| Shell | `AdaptiveGameShell` and `adaptive-shell.css` own root/grid/content geometry | fixed margins, width calculations, and desktop scale pass retired from `10`, `18`, `26`, `28`, and Veiled Steel | facility/background presentation and visual rail skins |
| Navigation | one 980px handoff owns desktop rails, mobile HUD/nav, and bottom clearance | visibility/clearance rules removed or narrowed in `18`, `23`, `26`, and `27` | existing `RightMenu`, `MobileNav`, and profile-sheet behavior |
| Root/scrolling | desktop center scroller; mobile document scroller; explicit isolated modes | competing root heights, overflow locks, and generic center scrollers retired | tavern, Battle Arena lobby, modal, and combat-specific scrollers |
| Dialogs/overlays | canonical Modal grid, bounded dynamic height, scrollable body, safe-area margins, tokenized z tiers | card-as-scroller behavior and short-landscape overshoot retired | bare central dialogs keep a bounded internal feature scroller |
| Combat | body-portaled `CombatInstance`; shared `ShinobiCombatShell`; single measured `useBoardScale` | theme-owned desktop gutter math and duplicate fixed-board sizes retired | compatibility HUD portal and explicit Battle Tower variant |
| Maps/cards/VN/Three.js | `adaptive-stages.css`, measured map/renderer containers, preserved logical stages, explicit takeovers | fixed sector dimensions, window-derived renderer UI sizing, unbounded canvas/HUD placement retired | authored map/card/board coordinates and feature quality policies |
| Admin/creator | `adaptive-tools.css` plus local wrapping/container behavior | fixed split widths and non-wrapping action rows narrowed | feature-specific table scrollers and role behavior |

## Verification and evidence

- Root production build passed, including server TypeScript, the Vite client,
  dist verification, and size budgets. The verified distribution is 95.2 KB of
  server output plus 284.7 MB of client assets; the initial JavaScript/CSS graph
  is 1.36 MB raw / 362.2 KB gzip and the 6.89 MB product budget passes.
- Full source/API/client contract baseline passed: 4,938/4,938. After the final
  integration fixes, the affected adaptive/combat ownership contracts passed
  15/15.
- Client ESLint passed with no ESLint errors or warnings. Babel emitted only its
  informational large-source deoptimization note for `PetColiseum.tsx`.
- The adaptive ownership architecture suite passed 10/10, including sole shell,
  normal-root, navigation, board-scale, map-lifecycle, pet-takeover, WebGL cleanup,
  and stylesheet-load-order guards.
- Cross-browser release smoke passed all 37 applicable checks across Chromium,
  Firefox, WebKit, compact, tablet, and mobile projects. The remaining 75 of 112
  project/test combinations were intentionally skipped by their applicability
  guards.
- Adaptive DPR coverage passed 4/4 applicable world-map checks at device scale
  factors 1, 1.25, 1.5, and 2; 28 non-map project/test combinations were
  intentionally skipped. The shared adaptive suite also covers the exact 22-size
  viewport matrix, navigation handoff, storage clearance, dialog containment,
  loading/empty/error/validation/long-content states, maximum inventory and
  jutsu capacity, subscriber capacity, and expanded mobile drawers.
- The combat matrix passed 12/12 Solo/PvE and PvP projects across Chromium DPR
  1/1.25/1.5/2, Firefox, and WebKit. Each project exercises the exact 22-size
  matrix plus zoom-equivalent reflow, and the mobile PvP run verifies portaled
  left/right action details, a real input-blocking modal backdrop, bounded
  dialog geometry, click/Escape dismissal, Tab containment, ARIA association,
  trigger-focus restoration, and the equipped thrown-item detail path.
- World-map pointer cancellation is distinct from completed pointer release, so
  a cancelled gesture cannot become half of a false double-tap. The lifecycle
  contract also verifies pointer-loss and observer cleanup.
- Warfront load/restart/reseed, accelerated completion, missing-rig fallback,
  WebGL context recovery, renderer/backing-store alignment, real drag/follow/wheel
  input, and opt-in fitted-canvas capture passed. The uncontested full run cleared
  lifecycle plus DPR 1/1.25/1.5; the unchanged strict DPR 2 renderer case passed
  separately in 6.6 minutes under its measured 480-second software-WebGL budget.
  Software WebGL logs retain the upstream `THREE.Clock` deprecation and long-task
  telemetry warnings; neither is a functional failure.
- Canonical before/after screenshots are stored in the ignored
  `.playwright-mcp/aaa-adaptive` evidence directory. They cover landing, creator,
  village boundaries and ultrawide, mobile navigation/menu, contained dialog,
  world map, selected sector, active Chronicle field, cinematic VN, and pet
  board/tactical/Warfront surfaces. The committed combat matrix under
  `docs/screenshots/combat-layout` covers desktop/mobile PvE and PvP plus browser
  and zoom-equivalent measurements.

## Known limitations

- The existing production build still warns about JavaScript chunks above 700
  kB and the source tree still contains substantial feature-skin `!important`
  debt outside migrated shell ownership. Both predate this consolidation.
- Software WebGL evidence records intermittent long tasks while large pet assets
  warm and the upstream Three.js clock deprecation warning. Renderer readiness,
  fallback, context recovery, pointer capture, and resource cleanup are covered.
- The compatibility `#battle-hud-portal` remains fixed for unmigrated hosts, but
  normal solo/PvP combat now uses in-grid dossiers and no longer depends on
  normal-shell gutter calculations.
- Browser-zoom coverage uses deterministic CSS-pixel reflow equivalents; the
  automation cannot operate native browser zoom chrome. Playwright WebKit is a
  cross-engine proxy, not a native Safari/device run.
- Desktop Playwright cannot summon a native mobile virtual keyboard. Mobile form
  reflow, focus, validation, and short-height containment are covered, but the
  operating-system keyboard overlay itself remains a device-manual check.
- The reconnect overlay and native browser-painted title tooltips were not held
  open in automation. Loading/error states, custom dropdowns, and custom
  left/right-edge action dialogs are explicitly contained and tested.
- Canonical `before-*` evidence comes from clean commit `3431174b6`, not an exact
  snapshot of the already-dirty starting checkout. Canonical `after-*` evidence
  comes from the final implementation worktree.
