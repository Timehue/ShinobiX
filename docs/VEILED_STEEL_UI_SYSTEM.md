# The Veiled Steel UI System

Veiled Steel is Shinobi Journey's player-facing design contract. It combines dark lacquer, moonlit steel, restrained antique gold, spirit-light accents, and the game's existing village art without changing gameplay rules or data.

## Source of truth

| File | Responsibility |
| --- | --- |
| `shinobij.client/src/styles/tokens.css` | Semantic palette, spacing, typography, elevation, motion, village, rarity, and status tokens |
| `shinobij.client/src/styles/ui.css` | Baseline shared primitive styles |
| `shinobij.client/src/styles/veiled-steel.css` | Final cross-route material and application-shell layer |
| `shinobij.client/src/components/ui/` | Buttons, modal, panels, badges, progress, loading, and empty states |
| `shinobij.client/src/components/ScreenContextHeader.tsx` | Consistent current-screen context in the global shell |

New components use `--sj-*` semantic tokens. Legacy aliases remain only to keep existing screens stable during migration.

## Art direction

- 70% dark neutral structure, 20% material variation, 10% meaningful emphasis.
- Base surfaces are quiet charcoal. Steel surfaces carry tactical information. Scroll surfaces are limited to lore and ceremonial copy. Spirit surfaces identify supernatural systems. Prestige surfaces are reserved for permanent or server-level accomplishments.
- Gold identifies primary actions and prestige, not ordinary borders. Red identifies danger, hostile state, or destructive action.
- Corners remain compact (4–8px) with notched treatment on major shell panels. Pills are limited to compact status and counters.

## Core tokens

```css
--sj-void: #080b0f;
--sj-background: #0d1218;
--sj-surface-low: #121820;
--sj-surface: #18212b;
--sj-surface-high: #202c38;
--sj-surface-raised: #293744;

--sj-text-primary: #f0ede5;
--sj-text-secondary: #b7c0c8;
--sj-text-muted: #7f8c98;

--sj-gold: #d1a758;
--sj-spirit: #74adbd;
--sj-seal: #a83e45;

--sj-success: #70aa80;
--sj-warning: #d29448;
--sj-danger: #c65359;
--sj-info: #6d9fbd;
```

Use semantic state tokens only for their named meaning. Village affiliation is controlled through `--village-accent` and `--village-accent-soft` on the shell.

## Typography and numbers

- Interface: Inter/Geist/Segoe UI system stack for body text, forms, tables, buttons, and combat data.
- Display: Marcellus/Spectral/Noto Serif/Georgia stack for page titles, village names, bosses, story chapters, and prestige reveals.
- Decorative display type is not used below 18px.
- Changing values use tabular numerals: health, chakra, stamina, AP, currency, timers, rankings, and resource totals.

## Spacing and shape

Use `--sp-1` through `--sp-16` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64px). Use `--r-xs` or `--r-sm` for controls and standard panels; `--r-md` only for feature surfaces and dialogs.

## Components and states

- `Button`: primary, secondary, ghost, destructive, success, and info variants; supports loading, busy, disabled, pressed, hover, and focus-visible states.
- `Panel`: base, steel, scroll, spirit, and prestige materials.
- `Modal`: portals to the document, locks body scrolling, restores focus, traps Tab focus, supports Escape, and becomes a bottom sheet on mobile.
- `Badge`: neutral, gold, success, danger, info, and spirit tones with optional icon.
- `ProgressBar`: gold, health, chakra, stamina, AP, and spirit resources with semantic labels and stable numerals.
- `EmptyState` and `LoadingState`: consistent messaging and loading feedback.

Do not create a new panel, button, modal, or progress style in a screen stylesheet when a shared primitive covers the behavior.

## Rarity

| Rarity | Token | Required communication |
| --- | --- | --- |
| Common | `--rarity-common` | Text label + neutral frame |
| Uncommon | `--rarity-uncommon` | Text label + green frame |
| Rare | `--rarity-rare` | Text label + blue frame |
| Epic | `--rarity-epic` | Text label + violet frame |
| Legendary | `--rarity-legendary` | Text label + antique-gold frame |
| Mythic | `--rarity-mythic` | Text label + seal-red frame |

Rarity must never rely on glow or color alone. Animation is limited to legendary and mythic reveals and is removed under `prefers-reduced-motion`.

## Status effects

Statuses use icon + name + duration + stacks (when applicable) + positive/negative/neutral classification. Canonical category tokens are `--status-positive`, `--status-negative`, `--status-neutral`, `--status-control`, and `--status-shield`.

## Village accents

- Ashen Leaf: ember and burnt orange.
- Stormveil: storm teal and rain silver.
- Frostfang: frost blue and cold silver.
- Moonshadow: restrained midnight violet and cold lavender.

Village accents appear in current-screen context, selected navigation, crests, map markers, and affiliation surfaces. They never recolor destructive or success actions.

## Motion

Use `--motion-instant` (80ms), `--motion-fast` (120ms), `--motion-normal` (180ms), `--motion-slow` (280ms), and `--motion-scene` (400ms). Motion may reinforce selection, button presses, resource changes, and reward reveals. It must not delay input or shift layout. Reduced-motion mode collapses transitions and animations.

## Responsive rules

- `560px`: compact phone adjustments.
- `800px`: deliberate mobile shell, bottom navigation, stacked content, and full-width sheets.
- `980px`: tablet/desktop shell boundary; dense side rails only appear above this width.
- `981–1100px`: compact desktop layouts stack wide inventory and training groups instead of shrinking controls below readable widths.
- `1280px`: wide-desktop density adjustment and maximum active content width on ultrawide displays.

Desktop rails use bounded widths rather than open-ended viewport percentages, and player-facing body copy targets 15px or larger. Extra ultrawide space becomes quiet framing instead of longer lines or stretched controls.

Item sheets show gameplay decisions first: slot, level, action cost, range, damage, cooldown, value, meaningful traits, and passive bonuses. Internal authoring flags and zero-value metadata are omitted.

Mobile controls target at least 44×44px. Primary actions remain visible, no page requires horizontal document scrolling, and fixed navigation includes safe-area padding.

Full-viewport feature surfaces must respect the shell contract. Lobby states keep the screen context and navigation; active combat hides shell navigation to dedicate the viewport to HUD, board, actions, and log. Fixed mobile chat surfaces begin below the context header and end above bottom navigation. Feature scenes such as Pet Yard participate in the center column rather than creating a second page-level scroller.

## Accessibility

- Preserve semantic buttons, navigation, headings, labels, dialogs, and progress roles.
- Every interactive element receives a visible `:focus-visible` state.
- Modals trap focus, restore the trigger, and close with Escape when dismissal is allowed.
- State and rarity include text or icon treatment in addition to color.
- The final theme supports reduced motion, forced colors, tabular metrics, and practical high contrast.

## Correct usage

```tsx
<Panel surface="steel">
  <ProgressBar label="Chakra" value={character.chakra} max={character.maxChakra} tone="chakra" />
  <Button variant="primary" loading={saving} loadingLabel="Equipping…">Equip</Button>
</Panel>
```

## Avoid

- Hardcoded hex values in new player-facing components.
- Gold on every border or heading.
- Village color as a semantic state.
- Emoji as a permanent icon when the existing icon package contains a suitable glyph.
- Rounded SaaS cards, giant blur shadows, constant glow, or hover-only critical information.
- New one-off modal, tab, empty, or loading patterns.
