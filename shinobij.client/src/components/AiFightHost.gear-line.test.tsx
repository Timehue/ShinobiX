import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// AiFightHost reaches for localStorage at import time through world state.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
};
// The component file relies on Vite's automatic JSX runtime; the plain node runner compiles it classic.
(globalThis as Record<string, unknown>).React = React;
const { AiFightResultCard } = await import("./AiFightHost");
import type { AiFightSettleResult } from "../lib/ai-fight-settle";

const settled = (extra: Partial<AiFightSettleResult> = {}): AiFightSettleResult => ({
    settled: true, outcome: "win", ryo: 120, statPoints: 1, capped: false, replayed: false,
    character: null, fetchMissionsCredited: [], ...extra,
});
const render = (settleResult: AiFightSettleResult | null, settleState: "idle" | "pending" | "settled" | "failed" = "settled") =>
    renderToStaticMarkup(
        <AiFightResultCard won draw={false} settleState={settleState} settleResult={settleResult} opponentName="Wolf"
            worldEncounter={false} spar={false} onRetry={() => {}} onExit={() => {}} />,
    );

test("a win that granted an upgrade gear piece names it with the other winnings", () => {
    const html = render(settled({ gearDropItemId: "rustfang-kunai-s1" }));
    assert.ok(html.includes("+120 ryo"), "the ordinary winnings are still shown");
    assert.ok(html.includes('data-testid="ai-fight-gear-drop"'));
    assert.match(html, /Upgrade gear found: Redthread Kunai · Damage 14\.5 EP, up from 14 on the Rustfang Kunai/);
});

test("an armor piece shows its damage reduction", () => {
    assert.match(render(settled({ gearDropItemId: "reinforced-vest-s1" })), /Upgrade gear found: Amberhide Vest · [\d.]+% damage reduction, up from [\d.]+% on the Reinforced Vest/);
});

test("no gear line without a drop, while tallying, after a failure, or on a replayed reward", () => {
    assert.ok(!render(settled()).includes("ai-fight-gear-drop"));
    assert.ok(!render(settled({ gearDropItemId: "rustfang-kunai-s1" }), "pending").includes("ai-fight-gear-drop"));
    assert.ok(!render(null, "failed").includes("ai-fight-gear-drop"));
    assert.ok(!render(settled({ gearDropItemId: "rustfang-kunai-s1", replayed: true })).includes("ai-fight-gear-drop"));
});

test("an id that is not an upgrade piece is never announced", () => {
    assert.ok(!render(settled({ gearDropItemId: "rustfang-kunai" })).includes("ai-fight-gear-drop"));
    assert.ok(!render(settled({ gearDropItemId: "not-an-item" })).includes("ai-fight-gear-drop"));
});
