import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CASTLE_SECTORS, MAX_WILD_SECTOR, OUTSKIRTS_SECTORS, remapLegacySector, sectorArtKey } from "../../../shared/sector-geo";
import { SECTOR_EXITS, sectorExits } from "../../../shared/sector-links";
import { SHRINE_DEFS } from "../../../shared/shrines";
import { riftTargetSector } from "../lib/hollow-rifts";
import { hollowRifts } from "./hollow-rifts";
import { HOME_SECTORS } from "./war-map-sectors";
import {
    RIFT_BY_ART,
    STRONGHOLD_BY_ART,
    riftPlacement,
    strongholdPlacement,
    type BoardPoint,
} from "./sector-structure-placements";

// ── Where each marker can appear, derived from what the game actually uses ──────
// Stronghold: WorldMap shows it wherever the owner is not the viewer's village, and
// ownership only exists on the 32 home war sectors (captures change WHO owns one).
const STRONGHOLD_SECTORS = Object.values(HOME_SECTORS).flat();
// Rift, today: riftTargetSector's range — every wild sector except the outskirts
// gates and the castle.
const CURRENT_RIFT_SECTORS = Array.from({ length: MAX_WILD_SECTOR }, (_, index) => index + 1)
    .filter((sector) => !OUTSKIRTS_SECTORS.includes(sector) && !CASTLE_SECTORS.includes(sector));
// Rift, from an old save: before the 2026-07-29 renumbering riftTargetSector drew
// from 1..55 by range alone — it did NOT skip the outskirts. A quest accepted then is
// remapped when read (api/sector/_rift-quest.ts → remapLegacySector), which can land
// it on an outskirts gate or the castle: sectors today's function never returns.
const PRE_RENUMBERING_RIFT_TARGET_MAX = 55;
const LEGACY_RIFT_SECTORS = [...new Set(
    Array.from({ length: PRE_RENUMBERING_RIFT_TARGET_MAX }, (_, index) => remapLegacySector(index + 1))
        .filter((sector) => sector >= 1 && sector <= MAX_WILD_SECTOR),
)];
const RIFT_SECTORS = [...new Set([...CURRENT_RIFT_SECTORS, ...LEGACY_RIFT_SECTORS])].sort((a, b) => a - b);

// ── The rendered footprints, in board fractions, at the two sizes that matter ───
// MIRRORS styles/index/29-clan-exchange-storefront.css (the last test fails if those
// rules change). Both markers are square and sized clamp(<min>px, 13%, <max>px), so
// they are 13% of the board on tablet and desktop — but on a phone the MINIMUM wins
// and they grow as a share of the board. The smallest supported board is 318px: the
// 360x640 viewport of the chromium-compact e2e project, measured 2026-09-10. There a
// 58px Stronghold is 18.2% of the board, not 13%.
//
// Shrine standees are clamp(64px, 14%, 116px) WIDE, but their height follows each
// shrine's own art. Measured, the tallest (Shrine of the Ancients) is 1.35x its width
// on desktop and 1.81x at the phone floor; the envelopes below contain every shrine.
type Scale = Readonly<{
    label: string;
    /** The board's width in px — tiles are inset by the grid's fixed-px padding. */
    boardPx: number;
    stronghold: number;
    rift: number;
    shrineWidth: number;
    shrineHeight: number;
    /** Desktop keeps a comfort margin and counts the nameplate. On the phone floor
     *  only a PHYSICAL overlap of the marker itself fails: a 92px "Sector
     *  Stronghold" pill is 29% of a 318px board and cannot clear everything, and it
     *  is pointer-events:none so it never intercepts a tap. */
    nameplate: number;
    margin: Readonly<{ gate: number; arrival: number; shrine: number; pair: number }>;
}>;
const PHONE_FLOOR_BOARD_PX = 318;
const SCALES: readonly Scale[] = [
    {
        // 612px is the 1366x768 board — the smaller of desktop and tablet (706px),
        // so its fixed-px grid inset is the larger share of the board.
        label: "desktop/tablet", boardPx: 612,
        stronghold: 0.13, rift: 0.13, shrineWidth: 0.14, shrineHeight: 0.14 * 1.4, nameplate: 0.03,
        margin: { gate: 0.035, arrival: 0.01, shrine: 0.03, pair: 0.03 },
    },
    {
        label: "phone floor (318px board)", boardPx: PHONE_FLOOR_BOARD_PX,
        stronghold: 58 / PHONE_FLOOR_BOARD_PX, rift: 56 / PHONE_FLOOR_BOARD_PX,
        shrineWidth: 64 / PHONE_FLOOR_BOARD_PX, shrineHeight: (64 / PHONE_FLOOR_BOARD_PX) * 1.85, nameplate: 0,
        margin: { gate: 0, arrival: 0, shrine: 0, pair: 0 },
    },
];

type Box = Readonly<{ x0: number; y0: number; x1: number; y1: number }>;
const footprint = (point: BoardPoint, width: number, anchor: number, nameplate: number): Box => {
    const x = point.left / 100;
    const y = point.top / 100;
    return { x0: x - width / 2, x1: x + width / 2, y0: y - anchor * width, y1: y + (1 - anchor) * width + nameplate };
};
const strongholdBox = (scale: Scale, sector: number) => footprint(strongholdPlacement(sector), scale.stronghold, 0.78, scale.nameplate);
const riftBox = (scale: Scale, sector: number) => footprint(riftPlacement(sector), scale.rift, 0.62, scale.nameplate);
const shrineBox = (scale: Scale, left: number, top: number): Box => ({
    x0: left / 100 - scale.shrineWidth / 2, x1: left / 100 + scale.shrineWidth / 2,
    y0: top / 100 - 0.62 * scale.shrineHeight, y1: top / 100 + 0.38 * scale.shrineHeight,
});
const grow = (box: Box, by: number): Box => ({ x0: box.x0 - by, y0: box.y0 - by, x1: box.x1 + by, y1: box.y1 + by });
// The REAL tile, not a twelfth of the board: the grid is inset by a fixed 4px of
// padding with 1px gaps (layout/adaptive-stages.css; pinned by the last test), so
// edge tiles — where every gate and arrival tile lives — sit further in than 1/12
// would say. On the 318px board the west arrival tile really ends at 17.2%, not
// 16.7%, which is exactly the side a marker approaches it from.
const GRID_PAD_PX = 4;
const GRID_GAP_PX = 1;
const tileBox = (scale: Scale, tile: number): Box => {
    const size = (scale.boardPx - 2 * GRID_PAD_PX - 11 * GRID_GAP_PX) / 12;
    const x0 = (GRID_PAD_PX + (tile % 12) * (size + GRID_GAP_PX)) / scale.boardPx;
    const y0 = (GRID_PAD_PX + Math.floor(tile / 12) * (size + GRID_GAP_PX)) / scale.boardPx;
    return { x0, y0, x1: x0 + size / scale.boardPx, y1: y0 + size / scale.boardPx };
};
const overlaps = (a: Box, b: Box) =>
    Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

/** Everything fixed on a sector's board that a marker must not stand on. */
function keepOut(scale: Scale, sector: number): { label: string; box: Box }[] {
    const zones: { label: string; box: Box }[] = [];
    for (const exit of sectorExits(sector)) {
        zones.push({ label: `road-exit gate (tile ${exit.tile})`, box: grow(tileBox(scale, exit.tile), scale.margin.gate) });
    }
    // Where arriving players ACTUALLY stand: the destinationTile of every exit, from
    // any sector, that leads here — the game's own value (one tile in), not a guess.
    for (const exit of SECTOR_EXITS) {
        if (exit.destinationSector !== sector) continue;
        zones.push({ label: `arrival tile ${exit.destinationTile} (from ${exit.sector})`, box: grow(tileBox(scale, exit.destinationTile), scale.margin.arrival) });
    }
    for (const shrine of SHRINE_DEFS) {
        if (shrine.sector === sector) zones.push({ label: `shrine ${shrine.id}`, box: grow(shrineBox(scale, shrine.left, shrine.top), scale.margin.shrine) });
    }
    return zones;
}

/** Every rule a placement breaks — collected, not thrown, so one run lists them all. */
function placementProblems(scale: Scale, sector: number, kind: string, box: Box): string[] {
    const problems: string[] = [];
    const edge = scale.margin.gate > 0 ? { x: 0.03, top: 0.06, bottom: 0.985 } : { x: 0, top: 0, bottom: 1 };
    if (!(box.x0 >= edge.x && box.x1 <= 1 - edge.x && box.y0 >= edge.top && box.y1 <= edge.bottom)) {
        problems.push(`sector ${sector}: the ${kind} spills off the board`);
    }
    for (const zone of keepOut(scale, sector)) {
        if (overlaps(box, zone.box)) problems.push(`sector ${sector}: the ${kind} stands on the ${zone.label}`);
    }
    return problems;
}
const report = (scale: Scale, problems: string[]) =>
    `[${scale.label}] ${problems.length} problem(s):\n  ${problems.join("\n  ")}`;

test("every sector a Stronghold can appear in has a placement tuned to its own art", () => {
    const missing = STRONGHOLD_SECTORS.filter((sector) => !(sectorArtKey(sector) in STRONGHOLD_BY_ART));
    assert.deepEqual(missing, [], `no tuned Stronghold placement for sector(s): ${missing.join(", ")}`);
});

test("every sector a Rift can open in — including from a pre-renumbering save — has a tuned placement", () => {
    const missing = RIFT_SECTORS.filter((sector) => !(sectorArtKey(sector) in RIFT_BY_ART));
    assert.deepEqual(missing, [], `no tuned Rift placement for sector(s): ${missing.join(", ")}`);
    // Pin the legacy set so a change to the renumbering map is noticed here.
    const legacyOnly = LEGACY_RIFT_SECTORS.filter((sector) => !CURRENT_RIFT_SECTORS.includes(sector)).sort((a, b) => a - b);
    assert.deepEqual(legacyOnly, [1, 9, 17, 26, 51], "the sectors only an old save can open a rift in have changed");
});

// The current domain is derived from the same constants riftTargetSector uses, which
// would miss a change to its LOGIC. So also ask the function itself: across enough
// player/rift pairs to hit every sector it can return, each has a tuned placement.
test("riftTargetSector never returns a sector without a tuned Rift placement", () => {
    const seen = new Set<number>();
    for (let player = 0; player < 4000; player += 1) {
        for (const rift of hollowRifts) seen.add(riftTargetSector(`player-${player}`, rift.id));
    }
    const untuned = [...seen].filter((sector) => !(sectorArtKey(sector) in RIFT_BY_ART)).sort((a, b) => a - b);
    assert.deepEqual(untuned, [], `riftTargetSector returned sector(s) with no tuned placement: ${untuned.join(", ")}`);
    assert.deepEqual([...seen].sort((a, b) => a - b), CURRENT_RIFT_SECTORS, "the sweep should reach every current rift sector and no other");
});

test("no placement is left over for art that no eligible sector shows", () => {
    const strongholdArt = new Set(STRONGHOLD_SECTORS.map(sectorArtKey));
    const riftArt = new Set(RIFT_SECTORS.map(sectorArtKey));
    const staleStronghold = Object.keys(STRONGHOLD_BY_ART).map(Number).filter((art) => !strongholdArt.has(art));
    const staleRift = Object.keys(RIFT_BY_ART).map(Number).filter((art) => !riftArt.has(art));
    assert.deepEqual(staleStronghold, [], `Stronghold placements for art no stronghold sector uses: ${staleStronghold.join(", ")}`);
    assert.deepEqual(staleRift, [], `Rift placements for art no rift sector uses: ${staleRift.join(", ")}`);
});

for (const scale of SCALES) {
    test(`[${scale.label}] every Stronghold stands on the board, off its gates, arrival tiles and shrine`, () => {
        const problems = STRONGHOLD_SECTORS.flatMap((sector) => placementProblems(scale, sector, "Stronghold", strongholdBox(scale, sector)));
        assert.deepEqual(problems, [], report(scale, problems));
    });

    test(`[${scale.label}] every Rift opens on the board, off its gates, arrival tiles and shrine`, () => {
        const problems = RIFT_SECTORS.flatMap((sector) => placementProblems(scale, sector, "Rift", riftBox(scale, sector)));
        assert.deepEqual(problems, [], report(scale, problems));
    });

    test(`[${scale.label}] where both can appear at once, the Rift and the Stronghold never touch`, () => {
        const both = STRONGHOLD_SECTORS.filter((sector) => RIFT_SECTORS.includes(sector));
        assert.ok(both.length > 0, "expected sectors that can host both");
        const problems = both
            .filter((sector) => overlaps(grow(strongholdBox(scale, sector), scale.margin.pair), riftBox(scale, sector)))
            .map((sector) => `sector ${sector}: the Rift and the Stronghold overlap`);
        assert.deepEqual(problems, [], report(scale, problems));
    });
}

// Placements keep the markers off gates, arrival tiles and shrines, but NOT off story
// field objectives: those are per-quest, and a rift can open in any sector. What
// keeps an objective reachable is stacking — it must paint (and take taps) above
// every standing structure, or a Rift parked on its tile can stall a Reckoning.
test("story field objectives stack above every standing structure", () => {
    const css = readFileSync(new URL("../styles/index/29-clan-exchange-storefront.css", import.meta.url), "utf8");
    const zIndexOf = (selector: string) => {
        const start = css.indexOf(`${selector} {`);
        assert.ok(start >= 0, `missing CSS rule ${selector}`);
        const match = /z-index:\s*(\d+)/u.exec(css.slice(start, css.indexOf("}", start)));
        assert.ok(match, `${selector} sets no z-index`);
        return Number(match[1]);
    };
    const objective = zIndexOf("button.atlas-landmark.sector-story-field-marker");
    for (const structure of [".sector-vault-standee", ".sector-rift-standee", ".sector-shrine-standee"]) {
        assert.ok(objective > zIndexOf(structure), `a story objective (z ${objective}) must stack above ${structure} (z ${zIndexOf(structure)})`);
    }
});

// The collision math above is only true while it matches what the CSS paints. If a
// width, a minimum, or an anchor changes, this fails — re-derive the footprints (and
// re-check the placements) rather than loosening the numbers here.
test("the footprint geometry matches the CSS that paints the markers", () => {
    const css = readFileSync(new URL("../styles/index/29-clan-exchange-storefront.css", import.meta.url), "utf8");
    const rule = (selector: string) => {
        const start = css.indexOf(`${selector} {`);
        assert.ok(start >= 0, `missing CSS rule ${selector}`);
        return css.slice(start, css.indexOf("}", start));
    };
    const stronghold = rule(".sector-vault-standee");
    const rift = rule(".sector-rift-standee");
    const shrine = rule(".sector-shrine-standee");
    assert.match(stronghold, /width:\s*clamp\(58px,\s*13%,/u, "Stronghold width is no longer clamp(58px, 13%, …)");
    assert.match(stronghold, /transform:\s*translate\(-50%,\s*-78%\)/u, "Stronghold base anchor is no longer -78%");
    assert.match(rift, /width:\s*clamp\(56px,\s*13%,/u, "Rift width is no longer clamp(56px, 13%, …)");
    assert.match(rift, /transform:\s*translate\(-50%,\s*-62%\)/u, "Rift base anchor is no longer -62%");
    assert.match(shrine, /width:\s*clamp\(64px,\s*14%,/u, "Shrine standee width is no longer clamp(64px, 14%, …)");
    assert.match(shrine, /transform:\s*translate\(-50%,\s*-62%\)/u, "Shrine standee anchor is no longer -62%");

    // The tile grid the gate/arrival boxes are computed from (GRID_PAD_PX, GRID_GAP_PX).
    const layout = readFileSync(new URL("../styles/layout/adaptive-stages.css", import.meta.url), "utf8");
    const gridStart = layout.indexOf(".map-instance .instance-frame > main.tile-scene > .pixel-map {");
    assert.ok(gridStart >= 0, "missing the sector grid rule in layout/adaptive-stages.css");
    const grid = layout.slice(gridStart, layout.indexOf("}", gridStart));
    assert.match(grid, /\bgap:\s*1px;/u, `sector grid gap is no longer ${GRID_GAP_PX}px`);
    assert.match(grid, /\bpadding:\s*var\(--sp-1\);/u, "sector grid padding is no longer var(--sp-1)");
    const tokens = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
    assert.match(tokens, /--sp-1:\s*4px;/u, `--sp-1 is no longer ${GRID_PAD_PX}px`);
});
