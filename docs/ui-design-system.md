# ShinobiX UI Design System

A lightweight, token-based design system that unifies the look of the game. It
was introduced to replace ad-hoc styling (603 distinct hardcoded colours, 102
spacing values, 24 breakpoints, 59 button classes, 6 modal patterns, 7 tab-bar
styles) with a small, consistent, documented foundation.

## Files

| File | Role |
|---|---|
| `src/styles/tokens.css` | **Source of truth.** Primitive palette + semantic tokens + spacing / radius / type / shadow / z scales. Imported first. |
| `src/styles/ui.css` | Styles for the shared primitives (`.ui-btn`, `.ui-modal-*`, `.ui-tab`, …) + global polish (scrollbars, text selection). |
| `src/components/ui/*` | React primitives: `Button`, `Modal`, `Tabs`, `CloseButton`, `BackButton`, `EmptyState`, `LoadingState`, `SectionHeader`, `Pill`. |
| `src/styles/late-normalize.css` | Loaded **last** (via `main.tsx`); re-skins legacy cross-cutting chrome (close/back buttons, empty text) to the token look without touching markup. |

## Token tiers (best practice)

1. **Primitive** — named by what they *are*: `--slate-400`, `--gold-500`, `--sp-4`,
   `--r-md`, `--fs-lg`. These are the raw palette/scales and are grounded in the
   exact values the game already used, so adopting them is visually lossless.
2. **Semantic** — named by *intent*: `--text`, `--text-dim`, `--surface`,
   `--border`, `--accent`, `--danger`, `--success`, `--info`. **Components should
   reference these**, not raw primitives or hex.

### Colour
Neutrals follow the Tailwind `slate` ramp (`--slate-50 … --slate-950`). The brand
gold family (previously 11 near-identical hexes) is unified to `--gold-200 …
--gold-700`, with `--gold` = `--gold-500` (`#facc15`). Status families: `--red-*`,
`--green-*`, `--blue-*`/`--cyan-*`, `--purple-*`.

### Spacing — 8-point grid
`--sp-1:4px` `--sp-2:8px` `--sp-3:12px` `--sp-4:16px` `--sp-5:20px` `--sp-6:24px`
`--sp-8:32px` `--sp-10:40px` `--sp-12:48px` `--sp-16:64px` …
Rule of thumb: 8px between related items, 16–24px between groups (internal ≤ external).

### Radius
`--r-xs:4` `--r-sm:6` `--r-md:8` `--r-lg:12` `--r-xl:16` `--r-pill:999px` `--r-full:50%`.

### Type — modular scale (Major Third, 16px base)
`--fs-2xs:10` `--fs-xs:12` `--fs-sm:13` `--fs-base:14` `--fs-md:16` `--fs-lg:20`
`--fs-xl:25` `--fs-2xl:31` `--fs-3xl:clamp(34,5vw,52)`. Fonts: `--font-body`
(Trebuchet), `--font-display` (Cinzel), `--font-mono`.

## Responsive breakpoints (standard set)

CSS can't put variables in `@media`, so use these canonical values everywhere
(mobile-first; 3–4 breakpoints per best practice, not 24):

| Name | Value | Target |
|---|---|---|
| sm | `560px` | small phones |
| md | `800px` | phone / small-tablet boundary (primary mobile cutoff) |
| lg | `980px` | tablet / desktop boundary (primary desktop cutoff) |
| xl | `1280px` | wide desktop |

`800` and `980` are the values already dominant in the codebase; new media
queries should snap to one of the four above rather than introducing new ones
(the legacy 420/480/520/600/640/720/760/768/820/860/900/979/1100/1150/1180
values should be migrated toward these as screens are touched).

## Using the primitives

```tsx
import { Button, Modal, Tabs, EmptyState, LoadingState } from "../components/ui";

<Button variant="primary" onClick={...}>Begin</Button>
<Button variant="danger" size="sm">Delete</Button>

<Modal open={open} onClose={close} title="Confirm" size="sm">…</Modal>

<Tabs tabs={[{id:"play",label:"Play"},{id:"deck",label:"Deck"}]} active={tab} onChange={setTab} />

{loading ? <LoadingState>Loading floors…</LoadingState>
 : items.length === 0 ? <EmptyState icon="🗒️" title="Nothing here">No missions yet.</EmptyState>
 : items.map(...)}
```

## Adoption guidance (for future screen migration)

- **New** screens/components: use tokens + primitives from the start. Never add a
  new bespoke button/modal/tab class.
- **Existing** screens: migrate opportunistically when you touch one. Replace raw
  `Loading…`/empty text with `LoadingState`/`EmptyState`; replace one-off modals
  with `Modal`; replace tab bars with `Tabs` (keep per-feature accent identity —
  themed tabs like Card Clash's jade or the Council's purple are intentional).
- Prefer `var(--token)` over hardcoded hex/px. Slate greys, the gold family, and
  status colours all have exact-match tokens.

> Note: per-screen visual migration should be verified live (the in-game screens
> require the API backend + a logged-in character). The token/primitive/normalize
> layers above are global and were verified against the start screen and the
> offline battle harnesses.
