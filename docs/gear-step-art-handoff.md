# Upgrade gear artwork handoff

> **Status: finished (2026-10-07).** All 110 pictures are in the game. The owner chose to make every
> drop a whole new weapon or armor design instead of a refined copy of its base, so the "same
> item, slightly better" brief below is superseded. Each piece also has its own shinobi name, written
> from its finished art, in `shared/gear-step-names.ts`. The importer and manifest remain for any
> future replacement of a picture.

This is everything needed to have ChatGPT draw the artwork for the upgrade gear
(the half point weapon and armor drops). Until a piece has its own art, the game
shows the art of the item it upgrades, so nothing is broken while this is in
progress. Each finished picture replaces that one stand in.

**The job: 110 pictures.** 65 weapons and 45 armor pieces, which is 30 base items
with 3 to 5 upgrade pieces each. Every row, with its exact name, file name and a
ready to paste prompt, is in [`gear-step-art-manifest.csv`](gear-step-art-manifest.csv).
Open it in a spreadsheet and work down it.

## What the player sees

An upgrade piece is the same item as the one it upgrades, a little stronger. The
art has to say that at a glance: same object, same pose, same colours, slightly
more refined. It must never look like a new design, and it must never look as good
as the next tier up. A weapon ladder reads like this:

> Rustfang Kunai (14) → Whetted (14.5) → Honed (15) → Tempered (15.5) → Folded (16) → Shadow Forged (16.5) → Rare weapons (17 and up)

Look at the base item and the next tier item side by side before starting a
series. Every piece in between should sit visibly between the two.

## The picture itself

- **One item, centred, nothing else.** No hands, no person, no stand, no floor, no shadow, no text, no frame, no border.
- **Square.** Any square size from 1024 up is fine. The game shrinks it to 320 by 320.
- **Flat solid magenta background, `#FF00FF`.** Every prompt in the manifest already says this. The import script removes the magenta and leaves a clean cutout. Please do not ask ChatGPT for a transparent background: it comes back as either a hazy film or an opaque backdrop, and neither can be cleaned up reliably.
- **No magenta or hot pink on the item itself**, so the cutout has nothing to confuse. Purple is fine.
- **The item fills about 90 percent of the frame and is never cropped.** The import script rejects any picture where the item touches the edge.
- **Match the existing style.** Open the reference image for the row. It is a dark, painted fantasy game icon: weathered iron and aged bronze, navy cloth wrapping, strong light from the upper left, a little surface wear. Weapons are drawn on a diagonal (tip to the lower left, handle to the upper right). Armor is shown from a slight three quarter front angle.
- **No hyphens in any lettering or names.** There is no lettering on these pictures anyway.

## What each rung adds

Every rung keeps everything the base item already has and adds only this.

### Weapons, five rungs (Common and Epic)

| Rung | What changes |
| --- | --- |
| Whetted | A fresh edge. Cleaned, a bright new bevel, rust and chips mostly gone, tidy grip wrap. |
| Honed | A fine polished edge with a crisp highlight along the blade, tight neat wrapping, fittings polished. |
| Tempered | A visible wavy temper line along the edge, a faint blue steel sheen, clean bronze fittings, richer wrap colour. |
| Folded | Folded steel: fine layered grain lines in the metal, crisp bright edge, bronze or silver fittings with a little engraving. |
| Shadow Forged | Dark blackened forged steel with a bright edge, engraved fittings, and a very faint cool glow only along the cutting edge. |

### Weapons, three rungs (Rare)

Honed, Tempered and Folded, exactly as above. Rare weapons already look good, so
the three changes are small.

### Armor, three rungs (every quality)

| Rung | What changes |
| --- | --- |
| Mended | Neat clean stitching over old tears, a few new patches, replaced cords and buckles, colours a little cleaner. |
| Lacquered | A clean glossy lacquer sheen on plates and leather, polished edges and fasteners, deeper colours. |
| Ironstitched | Extra iron thread stitching along the seams and added riveted plate edging, all metal crisp and bright. |

### The ceiling

No upgrade piece may use the things reserved for Legendary and named gear:
**no aura, no flames, no floating sparks, no glowing runes, no lightning.** The
only glow allowed anywhere is the faint cool edge light on Shadow Forged. If a
result looks like it belongs in the Legendary shop, redo it plainer.

## The workflow that keeps a series consistent

Do one ChatGPT conversation per base item (30 conversations).

1. Attach the base item's reference image (path in the manifest and in the tables below).
2. Paste the prompt for rung 1 from the manifest. Generate.
3. For rung 2, attach the base image **and** the rung 1 result, paste the rung 2 prompt, and add: "Slightly more refined than the attached previous rung, same pose and framing."
4. Repeat up the ladder. Generate one picture per message.
5. Save each good result as `<stepId>.png`, using the `file_name` column exactly. For example `rustfang-kunai-s1.png`. Put them all in one folder.

If a result changes the shape of the item, the pose, or the colour family, throw it
away and regenerate rather than trying to edit it: asking ChatGPT to tweak a
finished picture tends to repaint the whole thing.

## Check a series before moving on

Line up the base, every rung, and the next tier item, then shrink the lineup to
about 64 pixels wide each. The steps should still read as a gentle climb at that
size, because that is how the bag shows them. If two neighbouring rungs look the
same at 64 pixels, push the difference a little harder (still inside the ceiling).

## Getting them into the game

Check a folder first without writing anything:

```bash
node --import tsx scripts/gear-step-art.mjs import C:/path/to/folder --dry
```

Then import for real:

```bash
node --import tsx scripts/gear-step-art.mjs import C:/path/to/folder
```

For each picture the script removes the background (any flat colour works, magenta
is best), crops to the item, fits it on a 320 by 320 transparent canvas, saves it
as `shinobij.client/public/items/step-<id>-v1.webp` (about 20 to 30 KB), and adds
the id to `shared/gear-step-art-ready.ts`. That list is what switches a piece from
its base item's art to its own. Pictures it rejects are listed with the reason:
`the item touches the edge of the picture` means regenerate with more margin, and
`nothing left after removing the background` means the background was not flat.
You can import a few at a time. Run it again as more arrive.

When some are imported, run the tests (`npm test` from the repo root). The art
test fails if the ready list and the files on disk ever disagree. Commit the new
`.webp` files together with `shared/gear-step-art-ready.ts`.

Two things the art does not touch: names, values and descriptions come from
`shared/gear-steps.ts`, and the server catalog does not carry images, so no catalog
regeneration is needed.

## Order of work

Players unlock a tier's pieces by buying or crafting an item of that tier, so the
lowest tiers are seen first and by the most players:

1. Common weapons (25 pieces) and Standard armor (15 pieces)
2. Reinforced armor (15 pieces) and Rare weapons (15 pieces)
3. Rare armor (15 pieces) and Epic weapons (25 pieces)

## The base items

Reference image paths are relative to `shinobij.client/public`.

### Weapons

| Base item | Tier | Pieces | Values | Reference image |
| --- | --- | --- | --- | --- |
| Rustfang Kunai | Common weapons | 5 | 14.5 to 16.5 EP | `/items/starter-rustfang-kunai-v2.webp` |
| Training Katana | Common weapons | 5 | 14.5 to 16.5 EP | `/items/shop-training-katana-v1.webp` |
| Ash Wrapped Tanto | Common weapons | 5 | 14.5 to 16.5 EP | `/items/shop-ash-wrapped-tanto-v1.webp` |
| Rookie Chain Sickle | Common weapons | 5 | 14.5 to 16.5 EP | `/items/shop-rookie-chain-sickle-v1.webp` |
| Cracked Bone Dagger | Common weapons | 5 | 14.5 to 16.5 EP | `/items/shop-cracked-bone-dagger-v1.webp` |
| Mistfang Tanto | Rare weapons | 3 | 17.5 to 18.5 EP | `/items/shop-mistfang-tanto-v1.webp` |
| Ashen Leaf Saber | Rare weapons | 3 | 17.5 to 18.5 EP | `/items/shop-ashen-leaf-saber-v1.webp` |
| Riverbone Spear | Rare weapons | 3 | 17.5 to 18.5 EP | `/items/shop-riverbone-spear-v1.webp` |
| Iron Fang Knuckles | Rare weapons | 3 | 17.5 to 18.5 EP | `/items/shop-iron-fang-knuckles-v1.webp` |
| Blue Thread Dagger | Rare weapons | 3 | 17.5 to 18.5 EP | `/items/shop-blue-thread-dagger-v1.webp` |
| Stormcoil Kusarigama | Epic weapons | 5 | 19.5 to 21.5 EP | `/items/shop-stormcoil-kusarigama-v1.webp` |
| Moonshadow Needleblade | Epic weapons | 5 | 19.5 to 21.5 EP | `/items/shop-moonshadow-needleblade-v1.webp` |
| Frostbite Cleaver | Epic weapons | 5 | 19.5 to 21.5 EP | `/items/shop-frostbite-cleaver-v1.webp` |
| Ashglass Katana | Epic weapons | 5 | 19.5 to 21.5 EP | `/items/shop-ashglass-katana-v1.webp` |
| Spirit Leech Wakizashi | Epic weapons | 5 | 19.5 to 21.5 EP | `/items/shop-spirit-leech-wakizashi-v1.webp` |

### Armor (head, body, waist, legs, feet in each quality)

| Base item | Tier | Pieces | Values | Reference image |
| --- | --- | --- | --- | --- |
| Cloth Hood | Standard armor | 3 | 1.5% to 2.5% | `/items/shop-cloth-hood-v1.webp` |
| Cloth Robe | Standard armor | 3 | 1.5% to 2.5% | `/items/shop-cloth-robe-v1.webp` |
| Cloth Sash | Standard armor | 3 | 1.5% to 2.5% | `/items/shop-cloth-sash-v1.webp` |
| Cloth Pants | Standard armor | 3 | 1.5% to 2.5% | `/items/shop-cloth-pants-v1.webp` |
| Cloth Sandals | Standard armor | 3 | 1.5% to 2.5% | `/items/shop-cloth-sandals-v1.webp` |
| Leather Headband | Reinforced armor | 3 | 3.5% to 4.5% | `/items/shop-leather-headband-v1.webp` |
| Reinforced Vest | Reinforced armor | 3 | 3.5% to 4.5% | `/items/shop-reinforced-vest-v1.webp` |
| Leather Belt | Reinforced armor | 3 | 3.5% to 4.5% | `/items/shop-leather-belt-v1.webp` |
| Padded Leggings | Reinforced armor | 3 | 3.5% to 4.5% | `/items/shop-padded-leggings-v1.webp` |
| Shinobi Boots | Reinforced armor | 3 | 3.5% to 4.5% | `/items/shop-shinobi-boots-v1.webp` |
| Iron Kabuto | Rare armor | 3 | 5.5% to 6.5% | `/items/shop-iron-kabuto-v1.webp` |
| Rare Chest Plate | Rare armor | 3 | 5.5% to 6.5% | `/items/shop-rare-chest-plate-v1.webp` |
| Chain Obi | Rare armor | 3 | 5.5% to 6.5% | `/items/shop-chain-obi-v1.webp` |
| Rare Greaves | Rare armor | 3 | 5.5% to 6.5% | `/items/shop-rare-greaves-v1.webp` |
| Rare Tabi | Rare armor | 3 | 5.5% to 6.5% | `/items/shop-rare-tabi-v1.webp` |

(The real item is spelled Ash-Wrapped Tanto in the game. The table drops the
hyphen only to keep this document's wording hyphen free; use the manifest's
`base_name` for the exact name.)

## Regenerating the manifest

If a base item is added or renamed, rebuild the CSV from the live catalog:

```bash
node --import tsx scripts/gear-step-art.mjs manifest
```

`scripts/gear-step-art.test.mjs` fails if the committed CSV is out of date.
