# Hollow Gate Shrine — Dungeon Asset Drop-In

Drop a Kenney CC0 tilemap atlas here as **`tilemap.png`** to use as the
default texture for shrine wall / room-floor / corridor-floor / door tiles.

## Recommended pack

[Kenney — Roguelike Caves & Dungeons](https://kenney.nl/assets/roguelike-caves-dungeons)
(520 assets, CC0, free)

## How to use

1. Download the pack from the link above.
2. Inside the ZIP, find the main tilemap PNG (usually called something like
   `tilemap_packed.png` or `tilemap.png`). It's the big sheet containing
   every tile in a grid.
3. Save / rename it to **`tilemap.png`** and drop it in this folder:
   ```
   shinobij.client/public/assets/dungeon/tilemap.png
   ```
4. Reload the browser. The shrine view will auto-slice 4 tiles from
   the atlas (wall, room floor, corridor floor, door) on first load and
   use them as the default texture for the dungeon.

## How tile-picking works

Coordinates are configured in `App.tsx` near the top of the App function:

```ts
const KENNEY_ATLAS_TILES = {
    tilemap: "/assets/dungeon/tilemap.png",
    tileSize: 16,
    wall:           { x: 8, y: 2 },
    roomFloor:      { x: 10, y: 5 },
    corridorFloor:  { x: 14, y: 6 },
    door:           { x: 26, y: 4 },
};
```

Each `{ x, y }` is the tile's column / row in the atlas (0-indexed). If a
specific tile looks wrong, just bump the numbers and rebuild.

## Override priority

The renderer reads in this order — first match wins:

1. **Admin-generated image** in shared KV (`sharedImages["shrine:tile-X"]`)
2. **Atlas slice** from `tilemap.png` (extracted on App init)
3. **CSS gradient fallback** (no asset needed; works out of the box)

So this drop-in just upgrades the *baseline* — admins can still override
any tile by generating their own art in the Hollow Gate admin panel.

## License

Kenney assets are CC0 — public domain, no attribution required, ship them
freely.
