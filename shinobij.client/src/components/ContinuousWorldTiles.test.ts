import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContinuousWorldTiles } from "./ContinuousWorldTiles";
import { sectorExits } from "../../../shared/sector-links";
import { sameContinuousWorldPeersProps, type ContinuousWorldPeersProps } from "../lib/world-peer-roster";

// App re-renders every second while vitals regenerate (App.tsx idle-regen
// interval). These layers must not reconcile on a render that changes nothing
// they draw, and must still draw exactly what they drew when inline.
const root = join(process.cwd(), "shinobij.client", "src", "components");
const REACT_MEMO = Symbol.for("react.memo");
// tsx compiles this suite's JSX with the classic runtime.
(globalThis as typeof globalThis & { React: typeof React }).React = React;

test("the 144-tile grid is memoized with default (shallow) props comparison", () => {
    const tiles = ContinuousWorldTiles as unknown as { $$typeof: symbol; compare: unknown };
    assert.equal(tiles.$$typeof, REACT_MEMO);
    assert.equal(tiles.compare, null, "a custom comparator could skip a real tile/ready/exit change");
});

test("the grid's inputs from ContinuousWorldSector are stable across a vitals-only render", () => {
    const sector = readFileSync(join(root, "ContinuousWorldSector.tsx"), "utf8");
    assert.match(sector, /const go = useCallback\([^;]*engine\.current\?\.go\(sector, tile\);[^;]*\}, \[\]\);/);
    assert.match(sector, /<ContinuousWorldTiles sector=\{props\.sector\} playerTile=\{props\.playerTile\} onPainting=\{onPainting\} ready=\{ready\} roadExits=\{props\.roadExits\} go=\{go\} \/>/);
    // WorldMap passes sectorExits(selectedSector): one constant array per sector.
    assert.equal(sectorExits(9), sectorExits(9));
});

test("the grid renders 144 tap targets with the current tile, exits and readiness", () => {
    const exits = sectorExits(9);
    assert.ok(exits.length > 0, "fixture sector needs a road exit");
    const clicks: Array<[number, number]> = [];
    const html = renderToStaticMarkup(createElement(ContinuousWorldTiles, {
        sector: 9, playerTile: 78, onPainting: true, ready: false, roadExits: exits, go: (s, t) => { clicks.push([s, t]); },
    }));
    assert.equal(html.match(/<button /g)?.length, 144);
    assert.equal(html.match(/sector-player-tile/g)?.length, 1);
    assert.match(html, /tabindex="0"[^>]*sector-player-tile[^>]*aria-label="Current tile row 7 column 7"/);
    assert.equal(html.match(/disabled=""/g)?.length, 144);
    assert.ok(html.includes("Cross to "), "exit tiles are labelled as crossings");
    const offPainting = renderToStaticMarkup(createElement(ContinuousWorldTiles, {
        sector: 9, playerTile: 78, onPainting: false, ready: true, roadExits: exits, go: () => {},
    }));
    assert.equal(offPainting.includes("sector-player-tile"), false);
    assert.equal(offPainting.includes("disabled"), false);
});

test("the world peer layer is memoized by content, so a rebuilt-but-equal sleeper list skips it", () => {
    const images = { "avatar:aya": "a.webp" };
    const base: ContinuousWorldPeersProps = { sector: 9, selfName: "Rookie", sharedImages: images,
        sleepers: [{ name: "Aya", tile: 4, level: 12, sleeping: true, avatar: "a.webp" }] };
    // WorldMap's render builds a fresh array of fresh objects each time.
    assert.equal(sameContinuousWorldPeersProps(base, { ...base, sleepers: base.sleepers.map(s => ({ ...s })) }), true);
    assert.equal(sameContinuousWorldPeersProps(base, { ...base, sleepers: [{ ...base.sleepers[0], tile: 5 }] }), false);
    assert.equal(sameContinuousWorldPeersProps(base, { ...base, sleepers: [{ ...base.sleepers[0], level: 13 }] }), false);
    assert.equal(sameContinuousWorldPeersProps(base, { ...base, sleepers: [{ ...base.sleepers[0], avatar: "b.webp" }] }), false);
    assert.equal(sameContinuousWorldPeersProps(base, { ...base, sleepers: [] }), false);
    assert.equal(sameContinuousWorldPeersProps(base, { ...base, sector: 10 }), false);
    assert.equal(sameContinuousWorldPeersProps(base, { ...base, selfName: "Other" }), false);
    assert.equal(sameContinuousWorldPeersProps(base, { ...base, sharedImages: { ...images } }), false);
});

test("the peer layer keeps its own live subscription and 2 s poll (memo never gates presence)", () => {
    const peers = readFileSync(join(root, "ContinuousWorldPeers.tsx"), "utf8");
    assert.match(peers, /export const ContinuousWorldPeers = memo\(function ContinuousWorldPeers\(/);
    assert.match(peers, /\}, sameContinuousWorldPeersProps\);/);
    assert.match(peers, /const live = useLiveSectorPlayers\(\);/);
    assert.match(peers, /timer = setTimeout\(\(\) => void poll\(\), 2000\)/);
});
