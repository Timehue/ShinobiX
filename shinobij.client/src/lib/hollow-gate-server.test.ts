import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character, HollowGateShrineRun, HollowGateAugmentOffer } from "../types/character";
import {
    hollowGateServerEnabled,
    computeHollowGateHaul,
    applyServerSettle,
    applyHollowGateRunEndLocal,
    buildAugmentPickerEvent,
    shouldResumeAugmentPicker,
} from "./hollow-gate-server";

function char(overrides: Record<string, unknown>): Character {
    return { name: "Rin", ryo: 0, auraDust: 0, auraStones: 0, boneCharms: 0, fateShards: 0, honorSeals: 0, hollowShards: 0, ...overrides } as unknown as Character;
}
function run(entry: Record<string, number> | undefined): HollowGateShrineRun {
    return { entryCurrencies: entry } as unknown as HollowGateShrineRun;
}

test("flag defaults OFF (no window in node, and never throws)", () => {
    assert.equal(hollowGateServerEnabled(), false);
});

test("computeHollowGateHaul = current − entry, floored at 0", () => {
    const haul = computeHollowGateHaul(char({ ryo: 1400, hollowShards: 30, fateShards: 1 }), { ryo: 1000, hollowShards: 0, fateShards: 5 });
    assert.equal(haul.ryo, 400);
    assert.equal(haul.hollowShards, 30);
    assert.equal(haul.fateShards, 0); // spent below entry → never negative
});

test("computeHollowGateHaul with no entry snapshot treats entry as 0", () => {
    const haul = computeHollowGateHaul(char({ ryo: 250 }), undefined);
    assert.equal(haul.ryo, 250);
});

test("applyServerSettle mirrors entry + server credit; only touches credited keys", () => {
    const reconciled = applyServerSettle(
        char({ ryo: 999999, hollowShards: 999999, fateShards: 7 }),
        { ryo: 1000, hollowShards: 0, fateShards: 5 },
        { ryo: 400, hollowShards: 50 }, // server clamped these; fateShards omitted
    );
    assert.equal((reconciled as Record<string, number>).ryo, 1400);          // entry 1000 + credited 400
    assert.equal((reconciled as Record<string, number>).hollowShards, 50);    // entry 0 + credited 50 (clamped down from 999999)
    assert.equal((reconciled as Record<string, number>).fateShards, 7);       // untouched (not in credited)
});

test("applyServerSettle never touches non-currency fields", () => {
    const c = char({ ryo: 10, level: 42, name: "Rin" });
    const reconciled = applyServerSettle(c, { ryo: 5 }, { ryo: 3 }) as Record<string, unknown>;
    assert.equal(reconciled.level, 42);
    assert.equal(reconciled.name, "Rin");
    assert.equal(reconciled.ryo, 8);
});

test("applyHollowGateRunEndLocal: extract keeps everything and clears the run", () => {
    const after = applyHollowGateRunEndLocal(char({ ryo: 1500, hollowShards: 40 }), run({ ryo: 1000, hollowShards: 0 }), "extract", 0.5);
    assert.equal((after as Record<string, number>).ryo, 1500);
    assert.equal((after as Record<string, number>).hollowShards, 40);
    assert.equal((after as Record<string, unknown>).hollowGateRun, null);
});

test("applyHollowGateRunEndLocal: death claws back (1 − retention) of the haul", () => {
    // retention 0.5 → lose 50% of the +500 ryo / +40 shards earned this run.
    const after = applyHollowGateRunEndLocal(char({ ryo: 1500, hollowShards: 40 }), run({ ryo: 1000, hollowShards: 0 }), "death", 0.5);
    assert.equal((after as Record<string, number>).ryo, 1500 - 250);
    assert.equal((after as Record<string, number>).hollowShards, 40 - 20);
    assert.equal((after as Record<string, unknown>).hollowGateRun, null);
});

test("applyHollowGateRunEndLocal: higher retention keeps strictly more on death", () => {
    // Greedy Hands raises retention; the claw-back loses floor(earned × (1 − retention)).
    const lo = applyHollowGateRunEndLocal(char({ ryo: 1500 }), run({ ryo: 1000 }), "death", 0.5);
    const hi = applyHollowGateRunEndLocal(char({ ryo: 1500 }), run({ ryo: 1000 }), "death", 0.8);
    assert.equal((lo as Record<string, number>).ryo, 1250, "0.5 retention loses half of the +500 earned");
    assert.ok((hi as Record<string, number>).ryo > (lo as Record<string, number>).ryo, "0.8 retention keeps more than 0.5");
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
