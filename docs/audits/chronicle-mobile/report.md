# Chronicle Showdown mobile handoff

Implemented and verified locally. Rules, card content/art, balance, deck constraints, AI decisions, authoritative APIs, PvP authority, and rewards were not changed by this work.

## Problems and causes

| Problem | Root cause | Change |
| --- | --- | --- |
| Tiny, overlapping hand cards | Several responsive generations sized cards from a compressed console height and applied negative margins | A 96px rail with spacing, scroll snapping, and a 1.14× selected card |
| Selected cards hard to read or inspect | Selection toggled off; reading relied on a separate chip | Second tap opens the full reader; selected cards scroll into view; Cancel is explicit |
| Actions hidden sideways | The phone command dock used a non-wrapping horizontal scroller | A contextual, wrapping tray pinned above the bottom safe area |
| Tiny instructions and phase names | Desktop phase rails and floating placement paragraphs were compressed | A current-phase readout, progress dots, and a short live decision banner |
| Ambiguous targeting | Small zones and color-only feedback | At least 44px targets, legal checkmarks, selected outlines, dimmed alternatives, and accessible zone names/state |
| Four-digit stats clipped at 320px | A single-line ATK/DEF badge exceeded its zone | Readable wrapping stats and larger outcome labels |
| Collection required excessive scrolling | Full rules text was rendered inside browsing tiles | Two-column artwork-led binder with type, rarity, and ownership; full text stays in the inspector |
| Deck list was buried below collection | Desktop columns simply stacked | Collection / My Deck navigation and sticky count/save controls |
| Filters dominated narrow screens | Four independent selects always occupied the toolbar | Search plus a collapsible filter group with active count and Clear filters |
| Conflicting mobile layouts | Two large phone CSS generations plus global stage overrides | One consolidated adaptive section; obsolete phone blocks and global Chronicle row overrides removed |

## Files changed

- `shinobij.client/src/components/ChronicleDuelBoard.tsx`: selection, inspection, phase/decision presentation, accessibility, contextual commands, and tray-height observation.
- `shinobij.client/src/components/ChronicleCardLibrary.tsx`: extracted the shipping Collection and Deck Builder from Card Hall, with mobile navigation and copy controls.
- `shinobij.client/src/components/ChronicleCardSearch.tsx`: shared immediate client-side search and Class/Element/Tier/Rarity filters.
- `shinobij.client/src/screens/CardHall.tsx`: consumes the extracted library components.
- `shinobij.client/src/styles/chronicle-duel.css`: consolidated mobile/tablet/landscape presentation, inspector, binder, deck controls, safe areas, and touch targets.
- `shinobij.client/src/styles/layout/adaptive-stages.css`: removes superseded Chronicle-specific row sizing.
- `shinobij.client/src/chroniclepreview.tsx`: dev-only real-engine, library, tutorial, and actual screen-host fixtures.
- `shinobij.client/scripts/chronicle-mobile-qa.mjs`: reproducible Playwright browser gauntlet and evidence capture.
- `shinobij.client/e2e/chronicle-duel-ux.spec.ts`: expanded matrix, larger hand requirement, second-tap inspection, and removal of the horizontally scrolling action allowance.
- This directory contains screenshots, measured geometry, action evidence, and the full-project typecheck output.

Pre-existing sound-setting edits in the board and activity-navigation edits in Card Hall were preserved. Other working-tree changes were left alone.

## Mobile architecture and play experience

The opponent, current phase, and five-zone battlefield lead the screen. The decision banner identifies the immediate choice and selected card. The hand uses recognizable artwork instead of shrinking with hand size. Required commands remain pinned at the bottom, with a measured clearance that prevents content from being stranded under the tray. Selecting a card temporarily defers phase-changing commands; Cancel restores them.

On short phones, the battlefield and hand can scroll vertically while commands remain visible. This is intentional: a 320×568 screen does not force cards and decision text down to miniature sizes. Landscape phones use the battlefield on the left and the hand/decision area on the right, with the tray below that area. Desktop retains its existing board and phase rail.

The same board is used by Card Hall AI, Free-Play, Clan War, Sector War, Echoes, and Dungeon encounters. The actual AI, Echoes, PvP, Sector War, and Clan War hosts were exercised with local intercepted responses, verifying action submission and projection refresh.

## Hand, inspection, targeting, and commands

- Normal cards are 96px wide; selection gives approximately 109px visual width, a lift, emphasis, and automatic centering. Adjacent cards recede without overlapping selection hitboxes.
- Five, six, eight, and ten cards were exercised at 320px. Every card was selected; selected cards were checked against both viewport edges and the pinned tray.
- A second tap inspects the selected hand card. Cards can also be read outside the player's actionable phase. Public opponent cards open directly, and selected player monsters can be tapped again to inspect.
- Legal targets retain all existing rule calculations. Checkmarks and outlines supplement glow. Screen-reader labels distinguish placement, tribute, attacker, target, and inspection actions.
- Existing rule-aware combat previews remain; their mobile labels and ATK/DEF presentation are readable rather than clipped.
- Summon/Set, Jutsu, Snare, attack, phase completion, response activation, and Pass retain their original action payloads and authority.
- The inspector preserves artwork, rules, stats, rarity, element, limits, and context-specific Add to Deck. Large Close controls, bounded portrait geometry, modal focus trapping/restoration, and nested Escape behavior were verified.

## Collection and Deck Builder

Both surfaces share immediate local search over card name and visible metadata. Filters have explicit accessible names, an active count, and a clear action. No search requests are sent to the server.

The binder uses two columns on phones, with type/rarity captions and owned counts. Deck Builder offers Collection and My Deck views without making the player scroll through the catalog to reach the deck. The sticky header shows deck size, class totals, and Save. Identical cards remain grouped, with inspect, add-copy, and remove-copy controls. Existing ownership, copy-limit, and 40-card validation still gate additions and saving.

## Accessibility and performance

The audited phone/tablet duel controls meet a 44×44 minimum; primary actions and library copy controls use 48px height. Decision text uses 15px, selected-card guidance 13px, and primary commands 14px. Small decorative zone labels remain decorative. Native buttons, disclosure controls, pressed state, live status, keyboard behavior, and the existing modal implementation are retained.

Safe-area insets are applied to the active surface, pinned tray, and reader actions. Existing reduced-motion handling remains. The changes add no animation library, duplicated board, server search, or continuous visual effect. Card selection uses transforms/opacity; a single ResizeObserver measures the active tray and disconnects on cleanup. No hardware frame-rate claim is made.

## Verification

The final self-contained browser run passed **25 scenarios across 10 viewport sizes**, with **zero page errors**. It uses the shipping components, shared game engine, actual modal tokens/fonts, and global adaptive shell/stage styles. See `layout.json` for geometry and submitted action payloads.

| Viewport | Result |
| --- | --- |
| 320×568 | Passed |
| 360×640 | Passed |
| 375×667 | Passed |
| 390×844 | Passed |
| 412×915 | Passed |
| 430×932 | Passed |
| 768×1024 | Passed |
| 844×390 | Passed |
| 915×412 | Passed |
| 1366×768 | Passed |

Browser coverage includes normal summon, defense setting, tribute summon, untargeted/targeted/Graveyard Jutsu, Snare setting, targeted/direct attack, all four hand sizes, response activation/Pass/ownership, collection search/filter/inspection, deck ownership/copy limits/add/remove/40-card save, field and Graveyard inspection, nested dialogs, busy/error states, tutorial, and five real screen hosts. Action trays were checked for horizontal overflow and viewport containment. Mobile/tablet controls were measured for touch size.

The broader Node regression run passed **114 tests**, including authoritative rules, AI, Free-Play, Echoes settlement, dungeon proofs, request ordering, and Card Hall contracts. A final focused run passed **24 tests**, including card rendering/art, board, placement, Card Hall, and Clan War catalog coverage. These runs overlap and should not be added as unique tests.

Run the browser gauntlet from `shinobij.client` with:

```text
node scripts/chronicle-mobile-qa.mjs
```

The script builds an isolated artifact, serves it on an automatically assigned loopback port, saves evidence, and removes its temporary build directory. It does not require the production bundle or a live account.

## Bugs found during verification and cleanup

- Field-card inspection and Match options initially had sub-44px widths; corrected.
- Filter labels initially included option text in their accessible names; explicit names added.
- The battle log initially intercepted taps above the pinned command tray; stacking corrected.
- Four-digit ATK/DEF badges clipped on the smallest viewport; wrapping corrected.
- The standalone preview lacked shared modal design tokens; added to make dialog testing representative.
- An intentionally restricted ownership fixture correctly blocked an invalid restored deck; the fixture was corrected to separately verify a valid save.
- Removed the superseded compressed phone cockpit rules, tiny short-phone overrides, horizontal action-scroller rules, and global Chronicle grid-row overrides.
- Removed the abandoned Vite QA configuration and stopped the two temporary Vite preview processes. The successful audit cleans its build output and stale failure screenshot.

## Unchanged behavior and verification limits

8,000 starting HP, five Monster Zones, five Jutsu/Snare Zones, Field Zone, 40-card decks, tribute rules, effects, targeting legality, card limits, artwork/content, AI decisions, server authority, and reward/economy behavior remain unchanged. The existing desktop layout and grouped deck representation are retained.

The full client typecheck still exits with errors in unrelated combat, admin, world, and other screens; none reference the changed Chronicle files. See `typecheck.txt`. A clean whole-project production build is therefore not certified by this handoff. Targeted lint and the isolated browser build validate this change separately.

The browser runs are local Chromium viewport tests. Host endpoints are intercepted; gameplay actions use the real shared engine in dedicated fixtures. No live player battle or deployment was performed. Physical Android cutout behavior, touch latency, and device frame rate were not hardware-certified.

## Visual evidence

- `390x844.png`: primary portrait layout and pinned commands.
- `selected-hand-320.png`: selected large-hand card at the smallest width.
- `844x390.png`: landscape battlefield and side console.
- `targeting.png`: legal target and outcome presentation.
- `inspector.png`: bounded card reader with visible Close controls.
- `collection.png` and `deck.png`: binder and grouped deck views.
- The remaining viewport-named screenshots cover the full matrix.

## Live-main integration verification

The release was isolated onto remote main `c280a4369` before committing. Existing audio settings and activity navigation changes on main were preserved; unrelated workspace edits were excluded. On this checkout, 125 regression tests passed, the browser audit passed 25 flows across 10 viewports with no page errors, and targeted ESLint passed. The full client typecheck still reports unrelated errors in combat, admin, world, and other files; no diagnostics reference the changed Chronicle files. The earlier typecheck transcript records the same categories of baseline issues. Remote main's production image build was successful before this push; deployment of this change is not certified by these local checks.
