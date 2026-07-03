# Legacy System — onboarding / tutorial copy

Reusable player-facing copy for the Legacy System, saved for when the **new-player
tutorial** is edited to introduce Legacies. The canonical launch announcement also
lives in code at `shinobij.client/src/data/patch-notes.ts` (version
`2026.07.02-legacy`) and shows as the in-game "What's New" popup.

## Design rules the copy MUST keep

- **Never mention rank or rarity.** A Legacy's rarity/rank is owner/admin-only and
  is hidden from every player surface. Describe Legacies as *earned identity paths*,
  never "common/rare/legendary/mythic". Single violet accent (`#c084fc`) everywhere.
- **It opens at Level 50.** The Wandering Sage only finds level-50+ players, so
  tutorial copy for a *new* player should **tease** it as a far-off goal, not present
  it as something they can do now.
- **A Legacy is permanent** — one per character, forever. Set that expectation.
- **Earned, not bought.** Legacies open from how you actually play — never purchased,
  grinded, or RNG'd. (Ties into the balanced-PvP pillar.)

## Where the tutorial lives (for wiring later)

- Onboarding step machine: `shinobij.client/src/lib/onboarding-step.ts`
- Coaches / hints: `components/OnboardingCoach.tsx`, `components/SparCoach.tsx`,
  `components/ScreenHint.tsx`
- For a richer beat, the VN authoring system (admin VN editor + `TriggeredVisualNovel`)
  can carry a short scene — mirror `lib/legacy-sage-vn.ts`.

---

## One-liner (hint / tooltip)

> Prove yourself out in the world, and at Level 50 a Wandering Sage will offer you a
> **Legacy** — a permanent path all your own.

## Short new-player blurb (coach card)

> **Legacies** are a third path, earned — not bought. Keep playing the way you play:
> your battles, missions, and choices are quietly shaping which paths will open to you.
> At **Level 50**, a Wandering Sage starts appearing on the world map with an offer.
> You may only ever accept **one**, so there's no rush — the right path will feel like
> yours when you see it.

## Full launch announcement (from patch-notes.ts)

**The Legacy System**

A third path opens beside your bloodline. Somewhere out there a Wandering Sage has
started watching shinobi who've proven themselves — and when he finds you, he'll offer
you a Legacy: a permanent identity earned by how you've lived.

- **A Wandering Sage walks the roads** — At Level 50, a hooded stranger begins appearing
  on the world map. He has been reading your battles, missions, and choices, and offers
  you the legacies your life has opened. Accepting one is permanent — you may only ever
  hold a single Legacy, forever — so choose the path that feels like yours. Turning him
  down is always free; he'll find you again.
- **A signature technique, all your own** — Every Legacy carries its own signature jutsu.
  Prove your path through its trials and it becomes yours: a dedicated 16th technique
  that sits outside your fifteen-jutsu loadout, always at your side, that no other
  shinobi can wield.
- **Trials, stages, and titles** — Your Legacy deepens through five stages, each earned
  by an in-world trial its emissary sets for you — and each stage grants a title the
  whole world can see on your nameplate. Accept a Legacy and you're granted a handful of
  Aura Stones on the spot to mark the moment.
- **The world remembers** — A living Hall of Legends now records the shinobi who shaped
  the world, the Ages it passes through, and the first to walk each path. Your Legacy,
  its stage, and its earned titles show on your profile and in the tavern for everyone
  to see.
- **How to find your path** — Legacies are never bought or grinded — they open based on
  what you actually do. Keep playing the way you play. Below Level 50, watch for whispers
  about the path you're carving; at 50, the Sage will come looking for you.
