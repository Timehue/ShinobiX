import { test } from "node:test";
import assert from "node:assert/strict";
import {
    pveDifficultyBand,
    pveDifficultyStatMultiplier,
    pveDifficultyHpMultiplier,
    pveAiMasteryForLevel,
    pveEnemyHitCap,
    pveGuardedEnemyHit,
    pveIsBurstJutsuAp,
    pveEasyBandHoldsBurst,
    pveEasyBandAllowsLethal,
} from "./pve-difficulty";

// ── Band brackets (the agreed difficulty curve, inclusive upper bounds) ──────
// 1–30 easy (protected onboarding) · 31–50 medium · 51–90 hard · 91–100 peer.
test("difficulty bands use inclusive bracket boundaries", () => {
    assert.equal(pveDifficultyBand(1), "easy");
    assert.equal(pveDifficultyBand(30), "easy", "30 is the top of easy");
    assert.equal(pveDifficultyBand(31), "medium", "31 starts medium");
    assert.equal(pveDifficultyBand(50), "medium", "50 is the top of medium");
    assert.equal(pveDifficultyBand(51), "hard", "51 starts hard");
    assert.equal(pveDifficultyBand(90), "hard", "90 is the top of hard");
    assert.equal(pveDifficultyBand(91), "peer", "91 starts peer");
    assert.equal(pveDifficultyBand(100), "peer");
});

// ── Band strength curve: sub-peer bands are weaker; peer is untouched ────────
// The owner's note was "the AI are too strong in every category besides 90-100".
// Stat AND HP multipliers must climb monotonically and stay < their peer value
// below 90, while the peer band (the one that's "supposed to be this strong")
// keeps its full stat (×1.3) and full HP (×1.0).
test("stat multiplier weakens sub-peer bands and leaves peer at full strength", () => {
    assert.ok(pveDifficultyStatMultiplier(10) < pveDifficultyStatMultiplier(40), "easy < medium");
    assert.ok(pveDifficultyStatMultiplier(40) < pveDifficultyStatMultiplier(70), "medium < hard");
    assert.ok(pveDifficultyStatMultiplier(70) < pveDifficultyStatMultiplier(95), "hard < peer");
    assert.equal(pveDifficultyStatMultiplier(95), 1.3, "peer keeps its full ×1.3");
});

test("HP multiplier makes sub-peer foes less tanky and leaves peer at full HP", () => {
    assert.ok(pveDifficultyHpMultiplier(10) < 1, "easy foes soak fewer hits");
    assert.ok(pveDifficultyHpMultiplier(10) < pveDifficultyHpMultiplier(40), "easy < medium");
    assert.ok(pveDifficultyHpMultiplier(40) < pveDifficultyHpMultiplier(70), "medium < hard");
    assert.ok(pveDifficultyHpMultiplier(70) < pveDifficultyHpMultiplier(95), "hard < peer");
    assert.equal(pveDifficultyHpMultiplier(95), 1.0, "peer keeps its full HP pool");
});

// ── AI mastery is tied to the enemy's level, not hard-coded to max 50 ────────
test("AI mastery scales with enemy level and caps at the mastery ceiling", () => {
    assert.equal(pveAiMasteryForLevel(8), 8, "a level-8 D-rank casts under-mastered");
    assert.equal(pveAiMasteryForLevel(1), 1);
    assert.equal(pveAiMasteryForLevel(50), 50);
    assert.equal(pveAiMasteryForLevel(95), 50, "hard/peer AIs reach full mastery (cap 50)");
    assert.equal(pveAiMasteryForLevel(0), 1);
    assert.equal(pveAiMasteryForLevel(Number.NaN), 1);
});

// ── Single-hit cap by band ──────────────────────────────────────────────────
test("enemy hit cap clamps early-band damage to a fraction of player HP", () => {
    // Easy band (the reported repro: level-3 player, 300 HP). 20% of 300 = 60.
    assert.equal(pveEnemyHitCap(8, 300), 60);
    assert.equal(pveEnemyHitCap(35, 1000), 300);  // medium 30%
    assert.equal(pveEnemyHitCap(70, 2000), 900);  // hard 45%
    assert.equal(pveEnemyHitCap(95, 5000), Infinity); // peer uncapped
});

test("hit cap survives junk HP and never returns a sub-1 ceiling", () => {
    assert.ok(pveEnemyHitCap(8, 0) >= 1);
    assert.ok(pveEnemyHitCap(8, Number.NaN) >= 1);
});

// ── Regression: easy-band AI cannot one-shot a full-health low-level player ──
test("easy-band AI cannot one-shot a full-health player at any low level", () => {
    const maxHp = 300; // ~level-3 pool; cap is a fraction so the exact value is moot
    for (const level of [1, 3, 10, 20, 30]) {
        const guard = { enemyLevel: level, playerMaxHp: maxHp, playerHpTurnStart: maxHp, dealtThisTurn: 0 };
        const hit = pveGuardedEnemyHit(9999, guard); // a would-be ~1600 nuke
        assert.ok(hit < maxHp, `level ${level}: a single hit (${hit}) must not empty the bar`);
        assert.ok(maxHp - hit >= 1, `level ${level}: player must survive the hit`);
    }
});

// ── Mercy floor: above 50% HP, an easy-band turn cannot kill ─────────────────
test("easy-band mercy: a player above 50% HP cannot die in one enemy turn", () => {
    const maxHp = 300;
    const startHp = 200; // > 50%
    let dealt = 0;
    // Simulate a multi-hit turn (direct hit + DoT tick) all at max raw damage.
    for (let i = 0; i < 4; i++) {
        const hit = pveGuardedEnemyHit(9999, { enemyLevel: 20, playerMaxHp: maxHp, playerHpTurnStart: startHp, dealtThisTurn: dealt });
        dealt += hit;
    }
    assert.ok(dealt < startHp, `total turn damage ${dealt} must leave the >50% player alive`);
    assert.ok(startHp - dealt >= 1, "player keeps at least 1 HP");
});

// ── Low-level (<=10) stronger mercy: no kill unless started below 25% ────────
test("levels <=10: enemy cannot kill a player who started the turn above 25% HP", () => {
    const maxHp = 300; // 25% = 75
    const aboveQuarter = pveGuardedEnemyHit(9999, { enemyLevel: 5, playerMaxHp: maxHp, playerHpTurnStart: 80, dealtThisTurn: 0 });
    assert.ok(80 - aboveQuarter >= 1, "started above 25% → survives");

    // Started below 25% → the protection lifts and the per-hit cap can finish them.
    const belowQuarter = pveGuardedEnemyHit(9999, { enemyLevel: 5, playerMaxHp: maxHp, playerHpTurnStart: 60, dealtThisTurn: 0 });
    assert.ok(belowQuarter >= 60, "started below 25% → killable (no mercy floor)");
});

// ── Per-turn cap bounds cumulative damage in easy/medium ────────────────────
test("easy-band per-turn cap bounds cumulative damage (~30% of max HP)", () => {
    const maxHp = 1000;
    let dealt = 0;
    for (let i = 0; i < 5; i++) {
        dealt += pveGuardedEnemyHit(9999, { enemyLevel: 15, playerMaxHp: maxHp, playerHpTurnStart: maxHp, dealtThisTurn: dealt });
    }
    assert.ok(dealt <= 300, `cumulative ${dealt} must stay within the ~30% turn cap`);
});

// ── Hard band now also bounds a full enemy turn (was uncapped) ───────────────
test("hard-band per-turn cap bounds a chained turn (~70% of max HP)", () => {
    const maxHp = 2000;
    let dealt = 0;
    for (let i = 0; i < 5; i++) {
        dealt += pveGuardedEnemyHit(9999, { enemyLevel: 70, playerMaxHp: maxHp, playerHpTurnStart: maxHp, dealtThisTurn: dealt });
    }
    assert.ok(dealt <= 1400, `cumulative ${dealt} must stay within the ~70% hard turn cap`);
    assert.ok(maxHp - dealt >= 1, "a healthy player survives a single hard-band turn");
});

// ── Peer band is uncapped (endgame PvE plays like a real duel) ───────────────
test("peer band passes raw damage through unchanged", () => {
    const hit = pveGuardedEnemyHit(1650, { enemyLevel: 95, playerMaxHp: 4000, playerHpTurnStart: 4000, dealtThisTurn: 0 });
    assert.equal(hit, 1650);
});

// ── Item 1: easy-band AI behaviour pacing ───────────────────────────────────
test("burst jutsu = AP >= 60", () => {
    assert.equal(pveIsBurstJutsuAp(60), true);
    assert.equal(pveIsBurstJutsuAp(40), false);
    assert.equal(pveIsBurstJutsuAp(20), false);
});

test("easy band holds burst for the opening rounds, then releases it", () => {
    assert.equal(pveEasyBandHoldsBurst(8, 1), true, "round 1: hold");
    assert.equal(pveEasyBandHoldsBurst(8, 2), true, "round 2: hold");
    assert.equal(pveEasyBandHoldsBurst(8, 3), false, "round 3: release");
    assert.equal(pveEasyBandHoldsBurst(8, 7), false);
    // Outside the easy band the AI never holds back.
    assert.equal(pveEasyBandHoldsBurst(45, 1), false, "medium never holds");
    assert.equal(pveEasyBandHoldsBurst(95, 1), false, "peer never holds");
});

test("easy band only goes for the kill when the player is already low", () => {
    assert.equal(pveEasyBandAllowsLethal(8, 1.0), false, "full HP: no lethal intent");
    assert.equal(pveEasyBandAllowsLethal(8, 0.5), false, "half HP: still measured");
    assert.equal(pveEasyBandAllowsLethal(8, 0.25), true, "<=25%: finish allowed");
    assert.equal(pveEasyBandAllowsLethal(8, 0.1), true);
    // Outside the easy band the AI always plays to win.
    assert.equal(pveEasyBandAllowsLethal(60, 1.0), true);
    assert.equal(pveEasyBandAllowsLethal(95, 1.0), true);
});
