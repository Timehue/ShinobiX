import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character, HollowGateShrineRun, HollowGateAugmentOffer } from "../types/character";
import {
    hollowGateServerEnabled,
    startHollowGateServerRun,
    reconcileHollowGateSettle,
    buildAugmentPickerEvent,
    shouldResumeAugmentPicker,
    hollowGateAugmentEffects,
} from "./hollow-gate-server";

test("start retry reuses one idempotency request id", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: Array<Record<string, unknown>> = [];
    let attempt = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        attempt += 1;
        if (attempt === 1) throw new Error("lost response");
        return new Response(JSON.stringify({ ok: true, token: "sealed-token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;
    try {
        const result = await startHollowGateServerRun("Rin", 5);
        assert.equal(result?.token, "sealed-token");
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0].requestId, bodies[1].requestId);
        assert.match(String(bodies[0].requestId), /^[A-Za-z0-9:_-]{8,96}$/);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("start recovery sends the persisted request id unchanged", async () => {
    const originalFetch = globalThis.fetch;
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return new Response(JSON.stringify({ ok: true, token: "sealed-token" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }) as typeof fetch;
    try {
        await startHollowGateServerRun("Rin", 5, undefined, "hg-start-recovery-123");
        assert.equal(body.requestId, "hg-start-recovery-123");
    } finally {
        globalThis.fetch = originalFetch;
    }
});

function char(overrides: Record<string, unknown>): Character {
    return { name: "Rin", ryo: 0, auraDust: 0, auraStones: 0, boneCharms: 0, fateShards: 0, honorSeals: 0, hollowShards: 0, ...overrides } as unknown as Character;
}
test("flag defaults OFF (no window in node, and never throws)", () => {
    assert.equal(hollowGateServerEnabled(), false);
});

test("reconcileHollowGateSettle prefers the complete committed character", () => {
    const local = char({ ryo: 999999, hollowShards: 999999, level: 2 });
    const committed = char({ ryo: 1400, hollowShards: 50, level: 3 });
    const reconciled = reconcileHollowGateSettle(local, {
        ok: true,
        credited: { ryo: 999999 },
        character: committed,
    });
    assert.equal(reconciled.ryo, 1400);
    assert.equal(reconciled.hollowShards, 50);
    assert.equal(reconciled.level, 3);
});

test("shouldResumeAugmentPicker: true only for a tokened run with offers and no choice yet", () => {
    const offers: HollowGateAugmentOffer[] = [{ id: "keen-edge", label: "Keen Edge", description: "x", rarity: "common" }];
    // Re-present: token + offers + not yet chosen (e.g. refreshed during the pick).
    assert.equal(shouldResumeAugmentPicker({ runToken: "t", augmentOffers: offers } as unknown as HollowGateShrineRun), true);
    // Already chose → no re-present.
    assert.equal(shouldResumeAugmentPicker({ runToken: "t", augmentOffers: offers, chosenAugment: offers[0] } as unknown as HollowGateShrineRun), false);
    // Token-less (fallback) run → nothing to resume.
    assert.equal(shouldResumeAugmentPicker({ augmentOffers: offers } as unknown as HollowGateShrineRun), false);
    // Token but no offers rolled → nothing to present.
    assert.equal(shouldResumeAugmentPicker({ runToken: "t", augmentOffers: [] } as unknown as HollowGateShrineRun), false);
    // No run at all.
    assert.equal(shouldResumeAugmentPicker(null), false);
    assert.equal(shouldResumeAugmentPicker(undefined), false);
});

function runWithAugment(id: string, combat?: { kind: string; value: number }): HollowGateShrineRun {
    return { chosenAugment: { id, label: id, description: "x", rarity: "rare", combat } } as unknown as HollowGateShrineRun;
}

test("hollowGateAugmentEffects: no augment / no run → all-neutral", () => {
    const n = hollowGateAugmentEffects(null);
    assert.deepEqual(n, { enemyHpMult: 1, enemyStatMult: 1, enemyHpShavePct: 0, noRetreat: false, noKeeperHeal: false });
    assert.deepEqual(hollowGateAugmentEffects({ runToken: "t" } as unknown as HollowGateShrineRun), n, "tokened run without a chosen augment is still neutral");
});

test("hollowGateAugmentEffects: Greedy Pact makes the enemy tougher (HP+stats up)", () => {
    const e = hollowGateAugmentEffects(runWithAugment("greedy-pact", { kind: "enemyPower", value: 0.3 }));
    assert.equal(e.enemyHpMult, 1.3);
    assert.equal(e.enemyStatMult, 1.3);
    assert.equal(e.enemyHpShavePct, 0);
});

test("hollowGateAugmentEffects: Keen Edge (+dmg) → enemy enters with proportionally less HP", () => {
    const e = hollowGateAugmentEffects(runWithAugment("keen-edge", { kind: "damageBonus", value: 0.2 }));
    assert.ok(Math.abs(e.enemyHpShavePct - 0.2 / 1.2) < 1e-9, "0.2/(1+0.2) shave");
    assert.equal(e.enemyHpMult, 1, "never buffs the player via the shared engine");
});

test("hollowGateAugmentEffects: Warded Step → enemy hits softer (stat mult < 1, floored at 0.5)", () => {
    assert.equal(hollowGateAugmentEffects(runWithAugment("warded-step", { kind: "roleShield", value: 0.15 })).enemyStatMult, 0.85);
    assert.equal(hollowGateAugmentEffects(runWithAugment("warded-step", { kind: "roleShield", value: 0.9 })).enemyStatMult, 0.5, "clamped");
});

test("hollowGateAugmentEffects: Berserker = enemy HP shave + noRetreat; Treasure Sense = noKeeperHeal", () => {
    const b = hollowGateAugmentEffects(runWithAugment("berserkers-gamble", { kind: "damageBonus", value: 0.1 }));
    assert.equal(b.enemyHpShavePct, 0.1);
    assert.equal(b.noRetreat, true);
    const t = hollowGateAugmentEffects(runWithAugment("treasure-sense"));
    assert.equal(t.noKeeperHeal, true);
    assert.equal(t.enemyHpMult, 1, "treasure-sense has no battle stat effect");
});

test("hollowGateAugmentEffects: shave is always clamped to [0,0.9]", () => {
    const e = hollowGateAugmentEffects(runWithAugment("berserkers-gamble", { kind: "damageBonus", value: 5 }));
    assert.ok(e.enemyHpShavePct <= 0.9 && e.enemyHpShavePct >= 0);
});

test("buildAugmentPickerEvent renders one choice per offer with rare→danger tone", () => {
    const offers: HollowGateAugmentOffer[] = [
        { id: "keen-edge", label: "Keen Edge", description: "x", rarity: "common" },
        { id: "greedy-pact", label: "Greedy Pact", description: "x", rarity: "rare", riskLabel: "Enemies +30% power" },
    ];
    const picked: string[] = [];
    const ev = buildAugmentPickerEvent(offers, (o) => picked.push(o.id));
    assert.equal(ev.kind, "shrine");
    assert.equal(ev.choices.length, 2);
    assert.equal(ev.choices[0].tone, "primary");
    assert.equal(ev.choices[1].tone, "danger");
    assert.match(ev.choices[1].label, /Greedy Pact — Enemies \+30% power/);
    ev.choices[1].onSelect();
    assert.deepEqual(picked, ["greedy-pact"]);
});
