# Shinobi Journey UI Asset Needs

The Veiled Steel rollout uses restrained CSS materials and the repository's existing art. The items below are the production assets still needed; no lore-specific symbol has been fabricated as a final asset.

| Screen / system | Purpose | Size / aspect | Visual description | Priority | Current fallback | Performance constraint |
| --- | --- | --- | --- | --- | --- | --- |
| Global shell / village identity | Four official village crests | Square SVG; 64px and 128px exports | Original Ashen Leaf, Stormveil, Frostfang, and Moonshadow marks with a shared angular silhouette language | Required | Village accent edge + existing game icon | SVG under 12KB each; no embedded raster |
| Inventory / equipment | Character equipment silhouette | 3:4 transparent SVG or WebP, 720×960 source | Neutral masked shinobi mannequin with clear head/body/hand/waist/leg/foot placement | Required | CSS-built silhouette | WebP under 120KB or SVG under 35KB |
| Combat statuses | Unified status glyph set | 24px SVG grid; 48px source | Buff, debuff, DoT, HoT, control, shield, seal, stealth, wound, afterburn, stun, reflect, cooldown | Required | Existing mixed icon components and text labels | Prefer SVG symbols; entire set under 80KB |
| Item rarity | Rarity frame corner marks | 16–24px SVG motifs | Six non-color patterns that pair with common through mythic labels | Optional | Colored frame + readable rarity label | One SVG sprite under 30KB |
| World and war maps | Non-color sector state markers | 32px and 48px SVG | Owned, hostile, contested, locked, current location, active conflict, reward available | Required | Existing marker symbols, labels, and color | Sprite under 40KB; crisp at 1× mobile |
| World Map / Hollow Gate | Optional landmark illustration | Square WebP, 256×256 source | Original broken-gate shrine silhouette matching the world atlas lighting | Optional | Veiled Steel portal glyph and labelled fallback marker | WebP under 45KB; lazy loaded with the map chunk |
| Visual novel | Dialogue frame ornaments | 9-slice SVG or CSS mask | Restrained knot/seal corners for dialogue, narration, system, and supernatural voice variants | Optional | Veiled Steel panel surface | Under 25KB total; no full-screen raster frame |
| Legacy / bloodline | Original ceremonial crest frames | Square SVG, 256px source | Lineage ring and permanent-choice seal frame without franchise-derived symbols | Optional | Spirit and prestige CSS surfaces | Under 30KB each; no continuous animation |
| UI audio | Interaction audio hooks | 20–150ms OGG/WebM clips | Confirm, cancel, equip, purchase, reward, rank-up, error, combat action, story choice | Optional | Silent `data-*`/component event hooks | Under 20KB each; lazy load outside first paint |

All final assets need named authorship/licensing metadata. Large decorative art must be responsive, lazy loaded, and supplied as optimized WebP/AVIF where the existing pipeline supports it.
