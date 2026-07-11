import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import {
    RIFT_ACCEPT_MARKER, RIFT_DESCEND_MARKER, RIFT_GIVER_PREFIX,
    nextRift, synthRiftGiver, riftTargetSector, riftEventConfig,
    riftIntroEvent, riftDescentEvent, riftBySynthId, riftByDescentEventId, isRiftDescentEventId,
} from "./hollow-rifts";
import { hollowRifts } from "../data/hollow-rifts";
import { builtinAis } from "./combat-ai";

function mkChar(overrides: Partial<Character>): Character {
    return { name: "Tester", level: 40, totalAiKills: 0, activeRiftQuest: null, riftCooldownUntil: 0, ...overrides } as unknown as Character;
}

test("nextRift gates on level, an active rift, and the post-clear cooldown", () => {
    const rift = hollowRifts[0];
    assert.equal(nextRift(mkChar({ level: rift.levelReq }))?.id, rift.id);
    assert.equal(nextRift(mkChar({ level: rift.levelReq - 1 })), null);              // under level
    assert.equal(nextRift(mkChar({ level: 99, activeRiftQuest: { id: rift.id, targetSector: 5, stage: "travel", baseline: 0, bossName: rift.bossName } })), null); // one at a time
    assert.equal(nextRift(mkChar({ level: 99, riftCooldownUntil: Date.now() + 60_000 })), null); // cooling down
});

test("nextRift rotates by LEVEL BAND so higher tiers surface, spanning 15-90", () => {
    // Every level 15..90 has at least one eligible rift, and the offered one is in band.
    for (let lvl = 15; lvl <= 90; lvl++) {
        const r = nextRift(mkChar({ level: lvl, name: "Cov" }));
        assert.ok(r, `level ${lvl} has an eligible rift`);
        assert.ok(lvl >= r!.levelReq && lvl <= r!.levelMax, `level ${lvl} -> ${r!.id} (band ${r!.levelReq}-${r!.levelMax})`);
    }
    // Below the intro floor (L15) no rift is offered yet.
    assert.equal(nextRift(mkChar({ level: 14, name: "New" })), null);
    // The L15 intro rift is the ONLY thing a low-level player sees, and it is the legacy-teaching one.
    for (let lvl = 15; lvl <= 25; lvl++) {
        assert.equal(nextRift(mkChar({ level: lvl, name: "Lo" }))?.id, "rift-legacy-echo", `level ${lvl} -> intro rift`);
    }
    // A high-level player is never handed the L15 intro or the L30 stalker.
    assert.notEqual(nextRift(mkChar({ level: 88, name: "Hi" }))?.id, "rift-legacy-echo");
    assert.notEqual(nextRift(mkChar({ level: 88, name: "Hi" }))?.id, "rift-hollow-stalker");
    // Bands are well-formed (min <= max) and the set spans up to 90+.
    for (const r of hollowRifts) assert.ok(r.levelReq <= r.levelMax, `${r.id}: band ${r.levelReq}-${r.levelMax}`);
    assert.ok(hollowRifts.some((r) => r.levelMax >= 90), "at least one rift reaches level 90");
});

test("every rift's boss AI exists in builtinAis and is a boss", () => {
    for (const rift of hollowRifts) {
        const boss = builtinAis.find((a) => a.id === rift.bossAiId);
        assert.ok(boss, `${rift.id}: boss ${rift.bossAiId} not in builtinAis`);
        assert.equal(boss!.isBossAi, true, `${rift.id}: boss must be flagged isBossAi`);
    }
});

test("riftEventConfig is a free-entry, short, themed event gate", () => {
    const rift = hollowRifts[0];
    const cfg = riftEventConfig(rift);
    assert.equal(cfg.id, rift.id);           // run.variant.id → completion hook keys off it
    assert.equal(cfg.maxFloor, rift.floors);
    assert.ok(cfg.maxFloor >= 1 && cfg.maxFloor <= 3);
    assert.equal(cfg.bossAiId, rift.bossAiId);
    assert.equal(cfg.bossName, rift.bossName);
    assert.equal(cfg.keyCost, 0);            // quest-granted, free
    assert.equal(cfg.requiresUnlock, false); // the quest is the gate
});

test("synthRiftGiver is a non-hostile roaming quest NPC", () => {
    const rift = hollowRifts[0];
    const w = synthRiftGiver(rift, 20);
    assert.equal(w.id, `${RIFT_GIVER_PREFIX}${rift.slug}`);
    assert.equal(w.verb, "quest");
    assert.equal(riftBySynthId(w.id)?.id, rift.id);
    assert.ok(w.homeTile >= 0 && w.homeTile <= 143);
});

test("riftTargetSector is deterministic, wilderness-ranged, skips villages", () => {
    const villages = new Set([11, 31, 38, 47]);
    for (const p of ["Aki", "Rill", "player-two"]) {
        const s = riftTargetSector(p, "rift-hollow-stalker");
        assert.equal(s, riftTargetSector(p, "rift-hollow-stalker"));
        assert.ok(s >= 1 && s <= 55 && !villages.has(s));
    }
});

test("intro names the target sector and carries the accept sentinel; descent carries the descend sentinel", () => {
    const rift = hollowRifts[0];
    const intro = riftIntroEvent(rift, 47, "shadow");
    const descent = riftDescentEvent(rift, "shadow");
    // %sector was substituted (a sector reference appears; the raw token does not).
    const introText = intro.vnPages!.flatMap((p) => p.dialogue).join(" ");
    assert.ok(introText.includes("sector 47"), "intro references the target sector");
    assert.ok(!introText.includes("%sector"), "no unsubstituted token");
    const introChoices = intro.vnPages![intro.vnPages!.length - 1].choices ?? [];
    assert.equal(introChoices.filter((c) => c.trait === RIFT_ACCEPT_MARKER).length, 1);
    const descentChoices = descent.vnPages![descent.vnPages!.length - 1].choices ?? [];
    assert.equal(descentChoices.filter((c) => c.trait === RIFT_DESCEND_MARKER).length, 1);
    assert.equal(isRiftDescentEventId(descent.id), true);
    assert.equal(riftByDescentEventId(descent.id)?.id, rift.id);
});
