import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SectorIntelCard } from "./SectorIntelCard";
import type { SectorIntelPlateView } from "../lib/village-intel";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

/*
 * Cheap render coverage for the Intel card. Per CLAUDE.md a component change is
 * gated on the two Playwright suites, which cost minutes; these three renders
 * cost milliseconds and catch the shape regressions (a swallowed reveal, a flat
 * tier pill, a lost unscouted note) long before a browser is opened.
 *
 * Presentation only — every string arrives already written by the projection in
 * lib/village-intel, so this file asserts what the card DOES with the view, not
 * what the view says.
 */

const base: SectorIntelPlateView = {
    loading: false,
    tierLabel: "Unscouted",
    tier: "none",
    tierPillClass: "",
    expiryLabel: null,
    reveal: null,
    unscoutedNotes: [],
    payoffLines: [],
    scoutedByLines: [],
};

const render = (intel: SectorIntelPlateView) =>
    renderToStaticMarkup(React.createElement(SectorIntelCard, { intel }));

test("the loading shell announces itself as busy and shows nothing else", () => {
    const html = render({ ...base, loading: true, tierLabel: "Intel", unscoutedNotes: ["should not render"] });
    assert.match(html, /aria-busy="true"/, "a screen reader must not read a half-filled card as final");
    assert.match(html, /Gathering intel/);
    assert.doesNotMatch(html, /should not render/, "the body is withheld until the first response lands");
});

test("an unscouted sector renders every note it was given, and no reveal block", () => {
    const html = render({
        ...base,
        unscoutedNotes: ["Explore here to scout the sector.", "Scouting reveals the garrison."],
        tierLabel: "Unscouted",
    });
    assert.doesNotMatch(html, /aria-busy/, "a settled card is not busy");
    assert.match(html, /Explore here to scout the sector\./);
    assert.match(html, /Scouting reveals the garrison\./);
    assert.doesNotMatch(html, /Garrison/, "nothing is revealed below the scouted threshold");
    assert.match(html, /sector-status-pill/);
});

test("a revealed tier renders the garrison, pool, structures and expiry — with a tier-coloured pill", () => {
    const html = render({
        ...base,
        tier: "infiltrated",
        tierLabel: "Infiltrated",
        tierPillClass: "is-fighting",
        expiryLabel: "Intel goes cold in 2d",
        reveal: {
            garrison: "open",
            garrisonLabel: "Open to assault",
            garrisonAlert: true,
            poolLine: "Pool 40/120 used today",
            structures: [{ key: "ramparts", name: "Ramparts", level: 2 }],
            structuresLabel: "Ramparts L2",
        },
        unscoutedNotes: ["must not appear once revealed"],
        scoutedByLines: ["Frostfang Village has infiltrated this sector."],
    });

    assert.match(html, /sector-status-pill is-fighting">Infiltrated</, "the tier is the point of the card — the pill must carry its colour");
    assert.match(html, /Open to assault/);
    assert.match(html, /sector-intel-alert/, "an assaultable garrison is an alarm, not a status");
    assert.match(html, /Pool 40\/120 used today/);
    assert.match(html, /Ramparts L2/);
    assert.match(html, /Intel goes cold in 2d/);
    assert.doesNotMatch(html, /must not appear once revealed/);
    // scoutedBy lines sit OUTSIDE the reveal branch, so they render either way.
    assert.match(html, /Frostfang Village has infiltrated this sector\./);
});

test("a revealed sector with no owner village says so instead of dropping the row", () => {
    const html = render({
        ...base,
        tier: "scouted",
        tierLabel: "Scouted · 140 pts",
        tierPillClass: "is-traveling",
        reveal: {
            garrison: "none",
            garrisonLabel: "No siege",
            garrisonAlert: false,
            poolLine: "Pool untouched today",
            structures: null,
            structuresLabel: null,
        },
    });
    assert.match(html, /No owner village — no structures to reveal\./);
    assert.doesNotMatch(html, /sector-intel-alert/, "a quiet garrison is not an alarm");
    assert.match(html, /is-traveling">Scouted · 140 pts</);
});

test("the payoff block tells the EARNER what their intel bought, and hides when empty", () => {
    const revealed = {
        garrison: "none" as const,
        garrisonLabel: "No siege",
        garrisonAlert: false,
        poolLine: "Pool untouched today",
        structures: null,
        structuresLabel: null,
    };
    const withPayoff = render({
        ...base,
        tier: "mapped",
        tierLabel: "Mapped",
        reveal: revealed,
        payoffLines: [
            "Mapped — your Kage's war declare here starts at 175 WR instead of 250 WR, 75 WR saved.",
            "At 500 intel it is Infiltrated, and the declare starts at 125 WR.",
        ],
    });
    assert.match(withPayoff, /What your intel bought/);
    assert.match(withPayoff, /75 WR saved/);
    assert.match(withPayoff, /At 500 intel it is Infiltrated/);
    assert.match(withPayoff, /sector-intel-payoff/);

    // No payoff to report (an unscouted sector) renders no heading at all —
    // never an empty box with a dangling title.
    const withoutPayoff = render({ ...base, reveal: revealed, tier: "scouted", tierLabel: "Scouted" });
    assert.doesNotMatch(withoutPayoff, /What your intel bought/);
    assert.doesNotMatch(withoutPayoff, /sector-intel-payoff/);
});

test("the payoff block never renders while the first fetch is still in flight", () => {
    const html = render({ ...base, loading: true, payoffLines: ["should not render"] });
    assert.doesNotMatch(html, /should not render/);
    assert.doesNotMatch(html, /What your intel bought/);
});

test("the scoutedBy warning survives a card that reveals nothing", () => {
    // A sector the viewer's village OWNS: the viewer has no intel of their own
    // to show, but a rival probing it is the loudest thing this card can carry.
    const html = render({
        ...base,
        unscoutedNotes: ["Your village owns this sector."],
        scoutedByLines: ["Frostfang Village has mapped this sector."],
    });
    assert.match(html, /Frostfang Village has mapped this sector\./);
    assert.match(html, /Your village owns this sector\./);
});
