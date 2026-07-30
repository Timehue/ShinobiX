/*
 * Shared KEYART floor style — the single source of truth for every top-down
 * sector board (numbered sectors, village outer-territory boards, Death's Gate).
 *
 * Extracted 2026-07-29 because the style had already drifted into three copies
 * (gen-sector-art.mjs's old world-map-illustration FLOOR_PRE/POST, a verbatim
 * copy of it in gen-village-outskirts.mjs, and the keyart rewrite in
 * restyle-floors-keyart.mjs). Divergent copies are exactly what produced a
 * fleet where some boards matched the world map and others did not — so every
 * generator now imports from here.
 *
 * The style targets src/assets/Maps/world_map.webp: painterly, dense, weathered
 * palette, atmospheric haze. The composition + camera rules are what make a
 * board playable and are non-negotiable.
 *
 * PROMPT LAWS baked in (each one cost a reroll sweep to learn):
 *  #1  Negation backfires — never name what must be absent in the CONTENT.
 *  #13 Naming a vertical landmark drops the camera to eye level with a sky, so
 *      every prompt restates landmarks in overhead terms.
 *  #14 The painterly framing pulls EUROPEAN architecture unless the East-Asian
 *      vocabulary is named explicitly.
 *  #15 "Silent, still and empty" is not enough at this detail density; figures
 *      must be named out.
 *  #17 The PALETTE clause outweighs the content sentence, so it is per-region —
 *      a hardcoded green/teal palette repainted every ash field as a valley.
 *  #18 "moonlit" summons a literal moon (and its sky), so moon/sun are named
 *      out in the camera guard.
 */

export const PALETTE = {
    volcano: 'a naturalistic weathered colour palette of black and charcoal volcanic rock, grey ash, dusty umber grit and glowing molten orange, with almost no green and no blue water',
    darktemple: 'a naturalistic weathered colour palette of near-black scorched stone, cold slate grey, deep violet shadow and faint ember gold, with almost no green',
    frostfang: 'a naturalistic weathered colour palette of white snow, pale blue shadow, glacier teal ice and cold slate grey stone',
    frostborder: 'a naturalistic weathered colour palette of white snow, pale blue ice, cold slate stone and muted sage where green land shows through',
    moonshadow: 'a naturalistic weathered colour palette of violet and amethyst foliage, indigo shadow, pale silver-grey stone and dark teal water',
    carnival: 'a naturalistic weathered colour palette of pale sand, dry golden grass, sun-bleached stone and warm dusk amber, with festival reds and teals as accents',
};
export const DEFAULT_PALETTE = 'a naturalistic weathered colour palette of sage and olive greens, dusty tan earth, slate grey stone and deep teal water';

export const keyartPre = (region) => 'A richly detailed painterly fantasy map illustration of one small location, drawn in the exact style of an epic AAA fantasy world map: fine intricate brushwork, dense hand-painted detail across every part of the terrain, '
    + (PALETTE[region] ?? DEFAULT_PALETTE)
    + ', soft atmospheric haze giving quiet depth, diffuse dramatic daylight with long gentle shadows, and an oil-painted texture over the whole image. CAMERA: seen from DIRECTLY OVERHEAD with the camera pointing straight down at the ground — a true overhead plan view, like a satellite or drone photograph taken straight down. Only the TOPS of things are visible: tree canopies from above, roofs from above, the upper faces of rocks and walls. Vertical surfaces are almost entirely hidden — building fronts, walls and stairs are NOT seen face-on, and every structure is read by its ROOF. The ground plane stays flat and level across the whole picture, and the terrain fills the entire frame from edge to edge and continues past all four edges, exactly like an aerial photograph of a larger landscape — no part of the image is empty background. ';

export const KEYART_POST = ' COMPOSITION: the whole map is densely filled and reads as ONE connected, believable place — winding paths link every area so the eye flows naturally across it, terrain features break up the space, and the points of interest sit naturally along the routes. NO large empty areas and NO empty middle — every part of the map carries painted detail, texture and small features — BUT keep the paths and clearings as clear, open, walkable lanes. Features blend and connect into one another: NO isolated objects floating in empty space, NO evenly-spaced grid of props. ONE consistent painterly illustrated style across the entire image, matching an epic fantasy world map: intricate, atmospheric, naturalistic colour, weathered and lived-in, with rich fine detail everywhere. CAMERA DISCIPLINE: absolutely NO sky, NO clouds, NO moon, NO sun, NO horizon line, NO distant background scenery, NO mountains rising against a sky, NO side view, NO elevation view, NO eye-level or three-quarter perspective, NO camera tilted up toward a horizon, NO building facades or staircases seen face-on, NO vanishing-point perspective — the view looks straight DOWN and shows ground only. Absolutely NO characters, NO people, NO humans, NO text, NO words, NO UI, NO HUD, NO minimap, NO grid lines, NO hex tiles, NO tile outlines, NO markers, NO icons, NO arrows, NO labels, NO frame, NO border, NO vignette, NO watermark. This is a PAINTING, not a render: NOT a 3D render, NOT smooth plastic or clay shading, NOT a toy diorama, NOT simple rounded low-detail shapes, NOT bright candy colour, NOT cel-shaded, NOT outlined cartoon linework, NOT flat vector art, NOT pixel art, NOT photoreal. The artwork fills the entire frame edge to edge.';

export const DARK_REGIONS = new Set(['volcano', 'darktemple']);
export const DARK_LINE = ' The glowing light sources in the scene cast warm light across the ground so the whole terrain stays lit and readable in rich painted detail, never flat black.';
export const OVERHEAD_LANDMARK_LINE = ' Every building, gate, tower, shrine and temple here is seen from DIRECTLY ABOVE: you see the shape of its roof and the ground around it, never its front wall or its steps face-on. Every cliff, ridge and mountain is seen from above as a mass of rock and snow lying on the ground, never as a peak standing against a sky.';
export const ARCHITECTURE_LINE = ' All architecture is East-Asian shinobi-fantasy: sweeping tiled pagoda roofs with upturned eaves, dark timber beams and paper screens, torii gates, stone lanterns and tiled courtyard walls. There are NO European buildings — no church spires, no stone manor houses, no castle keeps, no half-timbered cottages.';
export const NO_FIGURES_LINE = ' The place is completely deserted: there is not a single person, figure, silhouette or animal anywhere in the image, not even a tiny distant one on a path.';

/** Assemble a full floor prompt from a region + a content sentence. */
export function buildFloorPrompt(region, content) {
    return keyartPre(region) + content + ' The whole place is silent, still and empty.'
        + OVERHEAD_LANDMARK_LINE + ARCHITECTURE_LINE + NO_FIGURES_LINE
        + (DARK_REGIONS.has(region) ? DARK_LINE : '') + KEYART_POST;
}
