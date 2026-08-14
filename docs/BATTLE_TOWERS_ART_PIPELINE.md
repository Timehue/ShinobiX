# Battle Towers art pipeline

Battle Towers uses a dedicated, versioned art pack. New Tower art must not
replace shared PvP, Solo PvE, mission, or world assets.

## Visual language

- Mood: tactical, dangerous, heroic; painterly dark-fantasy ninja realism.
- Palette: charcoal and midnight teal, with icy cyan, ember orange, and
  restrained royal violet for encounter escalation.
- Silhouettes must remain legible at combat-HUD size. Bosses need a distinct
  head/shoulder shape and one dominant phase color.
- Do not use franchise characters, logos, clan marks, text, watermarks, or
  baked-in UI.
- Keep key faces and landmarks inside the middle 80% so responsive crops are
  safe. Reserve low-detail negative space where lobby copy is expected.

## Asset classes

| Class | Preferred source | Runtime format | UI treatment |
| --- | --- | --- | --- |
| Lobby key art | 16:9 master, at least 1600 px wide | WebP, 80–86 quality | Decorative background with contrast gradient |
| Enemy portrait | 1:1 master, at least 512 px | WebP | Role badge and accessible actor name supplied by UI |
| Boss portrait/phase | 1:1 master, at least 768 px | WebP | Phase ring; never reused as an ordinary grunt |
| Board floor | Top-down, tile-neutral master | WebP | Cosmetic only; hex geometry remains server-authored |
| Object/hazard | Transparent cutout or clean tile | WebP/PNG | Must have a non-color telegraph in the board UI |

## Publishing contract

1. Add a new versioned filename under `shinobij.client/src/assets/towers`;
   never overwrite a shipped source asset.
2. Register it in the Tower-only art manifest. An unknown authored visual key is
   a content error and must render an explicit missing-art treatment rather than
   silently impersonating another enemy.
3. Compress the runtime copy, retain the generated/source master outside the
   runtime bundle, and verify desktop plus narrow mobile crops.
4. Art is presentation only. Floor IDs, hitboxes, targets, hazards, and phase
   state continue to come from the authoritative session.
5. Run the Tower visual contract tests and a browser smoke before publishing.

## Generated key art provenance

- Runtime asset: `shinobij.client/src/assets/towers/battle-towers-key-art-v1.webp`
- Master: OpenAI image generation output, 2026-08-10, 1672×941.
- Direction: a four-shinobi tactical squad approaches a multi-biome ascension
  tower whose tiers foreshadow the Warden, Ravager, Revenant, and Sovereign;
  calm upper-left negative space is reserved for lobby copy.
- Existing `spire.webp` and the four shipped boss portraits were used only as
  visual-continuity references.
