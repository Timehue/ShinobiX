import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfflineNoticeDigestCard } from "./OfflineNoticeDigestHost";
import { buildOfflineNoticeDigest } from "../lib/offline-notices";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function render(notices: unknown): string {
    return renderToStaticMarkup(
        React.createElement(OfflineNoticeDigestCard, {
            digest: buildOfflineNoticeDigest(notices, NOW),
            onClose: () => { /* not exercised by static markup */ },
        }),
    );
}

test("the whole inbox is ONE dialog with ONE dismiss", () => {
    const html = render(Array.from({ length: 10 }, (_, i) => ({
        kind: "sleeper-kill" as const, by: `Raider${i}`, sector: 10 + i, at: NOW - i * HOUR,
    })));
    assert.equal(html.match(/<li /g)?.length, 10, "all ten notices are listed");
    assert.equal(html.match(/<button/g)?.length, 1, "and there is exactly one thing to click");
    assert.match(html, /role="alertdialog"/);
    assert.match(html, /While you were away/);
});

test("the actionable notice leads, and is flagged", () => {
    const html = render([
        { kind: "sleeper-kill", by: "Raiden", sector: 17, at: NOW - 10 * HOUR },
        { kind: "village-unfed", by: "Moonshadow Village", village: "Moonshadow Village", sector: 12, at: NOW - 3 * DAY },
        { kind: "bounty-claimed", by: "Kenji", sector: 0, at: NOW - 5 * 60 * 1000, amount: 12000 },
    ]);
    const first = html.indexOf("Moonshadow Village marched hungry");
    const second = html.indexOf("Kenji collected");
    const third = html.indexOf("Raiden ambushed");
    assert.ok(first > 0 && first < second && second < third, "actionable first, then newest first");
    assert.match(html, /away-notice away-notice-action/);
    assert.match(html, /Act on this/);
    // Grave news is marked apart from routine news.
    assert.match(html, /away-notice away-notice-grave/);
});

test("every line carries its relative time", () => {
    const html = render([
        { kind: "sleeper-kill", by: "Raiden", sector: 17, at: NOW - 2 * DAY },
        { kind: "merc-raid", by: "Frostfang mercenaries", sector: 9, at: NOW - 3 * HOUR },
    ]);
    assert.match(html, /away-notice-when">2d ago</);
    assert.match(html, /away-notice-when">3h ago</);
});
