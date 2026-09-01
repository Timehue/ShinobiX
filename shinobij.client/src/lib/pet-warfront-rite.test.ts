import { test } from "node:test";
import assert from "node:assert/strict";
import {
    RITE_BAND_SIZE,
    RITE_BOND_BY_ROLE,
    RITE_BOND_MAX_ATTACK,
    RITE_BOND_MAX_HP,
    RITE_BOND_RESONANCE,
    RITE_CLASHES_TO_WIN,
    RITE_FRONT_SLOTS,
    RITE_MAX_CLASHES,
    RITE_MIN_ENTRY_HP,
    aiRitePlan,
    isValidRiteBand,
    isValidRitePlan,
    riteBandProblem,
    riteBond,
    riteVerdict,
    runWarfrontRite,
    sanitizeRitePlan,
    type RitePlan,
} from "./pet-warfront-rite";
import type { Pet, PetJutsu } from "../types/pet";

const j = (o: Partial<PetJutsu>): PetJutsu => ({ name: "m", power: 90, cooldown: 2, currentCooldown: 0, kind: "damage", ...o } as PetJutsu);
const mk = (o: Partial<Pet>): Pet => ({
    id: "x", name: "x", rarity: "rare", level: 20, xp: 0, maxLevel: 100,
    hp: 1000, attack: 100, defense: 50, speed: 90, element: "None",
    jutsus: [j({ name: "Strike", kind: "damage", power: 100 }), j({ name: "Bolt", kind: "burn", power: 90 })],
    ...o,
} as Pet);

const ELEMENTS = ["Fire", "Water", "Wind", "Earth"] as const;
const band = (prefix: string, tweak: (i: number) => Partial<Pet> = () => ({})): Pet[] =>
    Array.from({ length: RITE_BAND_SIZE }, (_, i) => mk({
        id: `${prefix}${i}`, name: `${prefix}${i}`, element: ELEMENTS[i % ELEMENTS.length], ...tweak(i),
    }));

const SEEDS = [1, 7, 42, 2024, 99999, 31337];

// ── The match ───────────────────────────────────────────────────────────────

test("a Rite is deterministic — same bands, seed and plan reproduce the same clashes", () => {
    for (const seed of SEEDS) {
        const run = () => runWarfrontRite(band("b"), band("r"), seed, { formation: [2, 0, 3, 1], reformAfterClash: null, reform: null });
        const a = run();
        const b = run();
        assert.equal(a.winner, b.winner, `seed ${seed} winner diverged`);
        assert.deepEqual(
            a.clashes.map((c) => [c.blueStanding, c.redStanding, c.winner, c.ticks]),
            b.clashes.map((c) => [c.blueStanding, c.redStanding, c.winner, c.ticks]),
            `seed ${seed} chain diverged`,
        );
    }
});

test("every Rite is a best-of-three that stops as soon as it is decided", () => {
    for (const seed of SEEDS) {
        const result = runWarfrontRite(band("b"), band("r"), seed);
        assert.ok(result.clashes.length >= 1 && result.clashes.length <= RITE_MAX_CLASHES,
            `clash count out of range: ${result.clashes.length}`);
        assert.ok(result.blueRounds <= RITE_CLASHES_TO_WIN && result.redRounds <= RITE_CLASHES_TO_WIN,
            "neither side may bank more rounds than it takes to win");
        // A side reaching the win threshold must end the match immediately.
        if (result.blueRounds >= RITE_CLASHES_TO_WIN || result.redRounds >= RITE_CLASHES_TO_WIN) {
            const decidedAt = result.clashes.findIndex((_, i) => {
                let b = 0;
                let r = 0;
                for (let k = 0; k <= i; k++) {
                    if (result.clashes[k].winner === "blue") b++;
                    else if (result.clashes[k].winner === "red") r++;
                }
                return b >= RITE_CLASHES_TO_WIN || r >= RITE_CLASHES_TO_WIN;
            });
            assert.equal(decidedAt, result.clashes.length - 1, "the match continued after it was already won");
        }
    }
});

test("all four pets a side fight in every clash — nobody sits out", () => {
    for (const seed of SEEDS) {
        for (const clash of runWarfrontRite(band("b"), band("r"), seed).clashes) {
            assert.equal(clash.blue.length, RITE_BAND_SIZE, "blue must field its whole band");
            assert.equal(clash.red.length, RITE_BAND_SIZE, "red must field its whole band");
            assert.deepEqual(clash.blue.map((c) => c.lane), [0, 1, 2, 3], "lanes must be dense and ordered");
        }
    }
});

test("the clash is scored on pets left standing", () => {
    for (const seed of SEEDS) {
        for (const clash of runWarfrontRite(band("b"), band("r"), seed).clashes) {
            assert.equal(clash.blueStanding, clash.blue.filter((c) => c.exitHp > 0).length);
            assert.equal(clash.redStanding, clash.red.filter((c) => c.exitHp > 0).length);
            if (clash.blueStanding > clash.redStanding) assert.equal(clash.winner, "blue");
            if (clash.redStanding > clash.blueStanding) assert.equal(clash.winner, "red");
        }
    }
});

test("the match winner is the side that took more clashes", () => {
    for (const seed of SEEDS) {
        const result = runWarfrontRite(band("b"), band("r"), seed);
        if (result.blueRounds > result.redRounds) assert.equal(result.winner, "blue");
        else if (result.redRounds > result.blueRounds) assert.equal(result.winner, "red");
        else assert.equal(result.winner, null);
    }
});

test("wounds carry between clashes, and the fallen return wounded rather than dead", () => {
    let carried = 0;
    let returned = 0;
    for (const seed of SEEDS) {
        const result = runWarfrontRite(band("b"), band("r"), seed);
        for (let i = 1; i < result.clashes.length; i++) {
            const before = result.clashes[i - 1];
            const now = result.clashes[i];
            for (const side of ["blue", "red"] as const) {
                for (const entry of now[side]) {
                    const previous = before[side].find((c) => c.slot === entry.slot);
                    if (!previous) continue;
                    if (previous.exitHp > 0) {
                        // A survivor carries its wound forward, then REGROUPS:
                        // it walks in on more than it walked out with, but never
                        // on more than full. Regrouping restores health only —
                        // see RITE_REGROUP for why a best-of-three needs it.
                        assert.ok(entry.entryHp >= previous.exitHp - 1e-9,
                            `seed ${seed} clash ${i}: survivor got WORSE between clashes (${previous.exitHp} -> ${entry.entryHp})`);
                        assert.ok(entry.entryHp <= 1 + 1e-9,
                            `seed ${seed} clash ${i}: survivor regrouped past full (${entry.entryHp})`);
                        if (previous.exitHp < 1 - 1e-9) {
                            assert.ok(entry.entryHp > previous.exitHp,
                                `seed ${seed} clash ${i}: a wounded survivor recovered nothing`);
                        }
                        carried++;
                    } else {
                        // A fallen pet RETURNS — permadeath would make clash two
                        // a foregone conclusion.
                        assert.ok(entry.entryHp > 0, "a fallen pet must return to the field");
                        assert.ok(entry.entryHp < 1, "a fallen pet must return wounded, not whole");
                        returned++;
                    }
                }
            }
        }
    }
    assert.ok(carried > 0, "no wound was ever carried forward — the mechanism is dead");
    assert.ok(returned > 0, "nobody ever fell and returned — the fixture never exercises the rule");
});

test("entry health is always a usable fraction, never zero or above full", () => {
    for (const seed of SEEDS) {
        for (const clash of runWarfrontRite(band("b"), band("r"), seed).clashes) {
            for (const c of [...clash.blue, ...clash.red]) {
                assert.ok(c.entryHp >= RITE_MIN_ENTRY_HP - 1e-9, `entry ${c.entryHp} below the floor`);
                assert.ok(c.entryHp <= 1 + 1e-9, `entry ${c.entryHp} above full`);
                assert.ok(c.exitHp >= 0 && c.exitHp <= 1 + 1e-9, `exit ${c.exitHp} out of range`);
            }
        }
    }
});

// ── Formation ───────────────────────────────────────────────────────────────

test("the committed formation decides who holds the front line", () => {
    const blue = band("b");
    const plan: RitePlan = { formation: [3, 1, 0, 2], reformAfterClash: null, reform: null };
    const result = runWarfrontRite(blue, band("r"), 4242, plan);
    const front = result.clashes[0].blue.filter((c) => c.lane < RITE_FRONT_SLOTS).map((c) => c.petId);
    assert.deepEqual(front, [blue[3].id, blue[1].id], "the first two entries in the formation ARE the front line");
});

test("formation actually changes the fight, or the tactics are decoration", () => {
    // Same four pets, same opponent, same seed — only the lanes differ.
    const blue = band("b", (i) => ({ hp: 900 + i * 120, attack: 90 + i * 12, defense: 40 + i * 9 }));
    const red = band("r", (i) => ({ hp: 900 + i * 120, attack: 90 + i * 12, defense: 40 + i * 9 }));
    let differed = 0;
    for (const seed of SEEDS) {
        const a = runWarfrontRite(blue, red, seed, { formation: [0, 1, 2, 3], reformAfterClash: null, reform: null });
        const b = runWarfrontRite(blue, red, seed, { formation: [3, 2, 1, 0], reformAfterClash: null, reform: null });
        const sameShape = a.winner === b.winner
            && a.clashes.length === b.clashes.length
            && a.clashes.every((c, i) => c.blueStanding === b.clashes[i].blueStanding);
        if (!sameShape) differed++;
    }
    assert.ok(differed > 0, "reversing the formation changed nothing across every seed — the front line is inert");
});

test("a reform leaves every clash BEFORE it byte-identical", () => {
    // The mid-match re-form UI depends on this. It shows the player clash one,
    // takes their decision, then RECOMPUTES the whole match around the new plan.
    // If a reform could disturb an earlier clash, the fight they just watched
    // would silently change underneath them.
    const blue = band("b");
    const red = band("r");
    const base: RitePlan = { formation: [0, 1, 2, 3], reformAfterClash: null, reform: null };
    for (const seed of SEEDS) {
        const plain = runWarfrontRite(blue, red, seed, base);
        const reformed = runWarfrontRite(blue, red, seed, { ...base, reformAfterClash: 0, reform: [3, 2, 1, 0] });
        assert.equal(
            JSON.stringify(plain.clashes[0].blue.map((c) => [c.slot, c.lane, c.entryHp, c.exitHp])),
            JSON.stringify(reformed.clashes[0].blue.map((c) => [c.slot, c.lane, c.entryHp, c.exitHp])),
            `seed ${seed}: the reform disturbed clash one`,
        );
        assert.equal(plain.clashes[0].ticks, reformed.clashes[0].ticks, `seed ${seed}: clash one changed length`);
        assert.equal(plain.clashes[0].winner, reformed.clashes[0].winner, `seed ${seed}: clash one changed winner`);
    }
});

test("a reform actually changes the line it is attached to", () => {
    const blue = band("b");
    const red = band("r");
    const base: RitePlan = { formation: [0, 1, 2, 3], reformAfterClash: null, reform: null };
    let changed = 0;
    for (const seed of SEEDS) {
        const reformed = runWarfrontRite(blue, red, seed, { ...base, reformAfterClash: 0, reform: [3, 2, 1, 0] });
        if (reformed.clashes.length < 2) continue;
        const front = reformed.clashes[1].blue.filter((c) => c.lane < RITE_FRONT_SLOTS).map((c) => c.slot);
        assert.deepEqual(front, [3, 2], `seed ${seed}: the reformed front line was not adopted`);
        changed++;
    }
    assert.ok(changed > 0, "no seed produced a second clash — the fixture never exercises the reform");
});

test("plan validation accepts formations and rejects everything else", () => {
    assert.ok(isValidRitePlan({ formation: [0, 1, 2, 3], reformAfterClash: null, reform: null }));
    assert.ok(isValidRitePlan({ formation: [3, 2, 1, 0], reformAfterClash: 1, reform: [0, 1, 2, 3] }));
    assert.ok(!isValidRitePlan({ formation: [0, 1, 2], reformAfterClash: null, reform: null }), "wrong length");
    assert.ok(!isValidRitePlan({ formation: [0, 0, 2, 3], reformAfterClash: null, reform: null }), "duplicate lane");
    assert.ok(!isValidRitePlan({ formation: [0, 1, 2, 9], reformAfterClash: null, reform: null }), "out of range");
    assert.ok(!isValidRitePlan({ formation: [0, 1, 2, 3], reformAfterClash: 99, reform: null }), "reform past the last clash");
    assert.ok(!isValidRitePlan({ formation: [0, 1, 2, 3], reformAfterClash: 0, reform: [0, 0, 1, 2] }), "illegal reform");
    assert.ok(!isValidRitePlan(null), "null plan");
});

test("a tampered plan degrades to the default formation instead of throwing", () => {
    const sanitized = sanitizeRitePlan({ formation: [9, 9, 9, 9], reformAfterClash: 400, reform: null });
    assert.deepEqual(sanitized.formation, [0, 1, 2, 3]);
    assert.equal(sanitized.reformAfterClash, null);
    const result = runWarfrontRite(band("b"), band("r"), 5, sanitized);
    assert.ok(result.clashes.length >= 1, "a sanitized plan must still produce a legal match");
});

test("the AI plan is a legal formation derived from the seed alone", () => {
    const red = band("r", (i) => ({ hp: 700 + i * 250, defense: 30 + i * 20 }));
    for (const seed of SEEDS) {
        const plan = aiRitePlan(red, seed);
        assert.ok(isValidRitePlan(plan), `seed ${seed} produced an illegal AI formation`);
        assert.deepEqual(aiRitePlan(red, seed), plan, "AI plan must be deterministic");
    }
    // It leads with its most durable pet — the readable line, which the harness
    // shows is not the optimal one, so a thinking player stays ahead of it.
    assert.equal(aiRitePlan(red, 1).formation[0], 3, "the most durable pet should hold the front");
});

// ── Bands ───────────────────────────────────────────────────────────────────

test("a stronger band reliably beats a weaker one", () => {
    const strong = band("s", () => ({ hp: 1700, attack: 155, defense: 85 }));
    const weak = band("w", () => ({ hp: 650, attack: 65, defense: 25 }));
    let wins = 0;
    for (const seed of SEEDS) if (runWarfrontRite(strong, weak, seed).winner === "blue") wins++;
    assert.ok(wins >= SEEDS.length - 1, `the stronger band only won ${wins}/${SEEDS.length}`);
});

test("band legality: composition is NOT policed, four distinct pets to select", () => {
    // Owner ruling 2026-09-01: there is no element requirement. A mono-element
    // band is a bad matchup the player may knowingly take, not an illegal one —
    // the gate that used to block it protected players from the type chart
    // working correctly. Guard the ABSENCE so it cannot be reintroduced.
    const mono = Array.from({ length: RITE_BAND_SIZE }, (_, i) => mk({ id: `m${i}`, element: "Fire" }));
    assert.equal(isValidRiteBand(mono), true, "a single-element band may enter — composition is the player's call");
    assert.equal(riteBandProblem(mono), null, "a mono-element band must not be blocked or scolded");
    assert.equal(isValidRiteBand(band("ok")), true);
    assert.equal(riteBandProblem(band("ok")), null);

    // Duplicate ids are legal for the ENGINE (the rival band cycles a three-pet
    // pool into four slots) but not for a player picking their own four.
    const twin = mk({ id: "twin", element: "Wind" });
    const dupes = [mk({ id: "a", element: "Fire" }), mk({ id: "b", element: "Earth" }), { ...twin }, { ...twin }];
    assert.equal(isValidRiteBand(dupes), true, "the engine tolerates a repeated species");
    assert.match(riteBandProblem(dupes) ?? "", /one slot/);
});

test("a band that fields the same species twice still resolves by slot", () => {
    const twin = mk({ id: "twin", name: "Twin", element: "Wind" });
    const duplicated = [
        mk({ id: "solo-a", name: "A", element: "Fire" }),
        mk({ id: "solo-b", name: "B", element: "Earth" }),
        { ...twin }, { ...twin },
    ];
    const result = runWarfrontRite(band("b"), duplicated, 4242);
    for (const clash of result.clashes) {
        assert.deepEqual(clash.red.map((c) => c.slot), [0, 1, 2, 3], "each slot is tracked independently of its id");
    }
});

// ── Bonds ───────────────────────────────────────────────────────────────────

test("a lone pet receives no bond", () => {
    const bond = riteBond(mk({ id: "solo" }), []);
    assert.equal(bond.hpMult, 1);
    assert.equal(bond.attackMult, 1);
    assert.deepEqual(bond.contributions, []);
});

test("each ally contributes by its role", () => {
    const champion = mk({ id: "champ", element: "Fire", role: "assassin" });
    const bond = riteBond(champion, [
        { pet: mk({ id: "d", element: "Water", role: "defender" }), slot: 1 },
        { pet: mk({ id: "s", element: "Wind", role: "sage" }), slot: 2 },
    ]);
    const expected = 1 + RITE_BOND_BY_ROLE.defender.hp + RITE_BOND_BY_ROLE.sage.hp;
    assert.ok(Math.abs(bond.hpMult - expected) < 1e-9, `hp ${bond.hpMult} != ${expected}`);
    assert.equal(bond.attackMult, 1, "neither role grants attack");
    assert.deepEqual(bond.contributions.map((c) => c.role), ["defender", "sage"]);
});

test("an ally sharing the recipient's element bonds half again as hard", () => {
    const champion = mk({ id: "champ", element: "Fire", role: "defender" });
    const plain = riteBond(champion, [{ pet: mk({ id: "a", element: "Water", role: "assassin" }), slot: 1 }]);
    const resonant = riteBond(champion, [{ pet: mk({ id: "a", element: "Fire", role: "assassin" }), slot: 1 }]);
    assert.ok(Math.abs((resonant.attackMult - 1) - (plain.attackMult - 1) * RITE_BOND_RESONANCE) < 1e-9,
        "resonance did not scale the contribution");
    assert.equal(resonant.contributions[0].resonant, true);
    assert.equal(plain.contributions[0].resonant, false);
});

test("bonds are capped so a lucky band cannot make a clash a formality", () => {
    const champion = mk({ id: "champ", element: "Fire", role: "defender" });
    const sages = Array.from({ length: 8 }, (_, i) => ({ pet: mk({ id: `s${i}`, element: "Fire", role: "sage" }), slot: i + 1 }));
    assert.equal(riteBond(champion, sages).hpMult, RITE_BOND_MAX_HP);
    const blades = Array.from({ length: 8 }, (_, i) => ({ pet: mk({ id: `a${i}`, element: "Fire", role: "assassin" }), slot: i + 1 }));
    assert.equal(riteBond(champion, blades).attackMult, RITE_BOND_MAX_ATTACK);
});

test("every combatant records the bond it fought under", () => {
    for (const seed of SEEDS) {
        for (const clash of runWarfrontRite(band("b"), band("r"), seed).clashes) {
            for (const c of [...clash.blue, ...clash.red]) {
                assert.ok(c.bond.hpMult >= 1 && c.bond.hpMult <= RITE_BOND_MAX_HP, `hp bond ${c.bond.hpMult}`);
                assert.ok(c.bond.attackMult >= 1 && c.bond.attackMult <= RITE_BOND_MAX_ATTACK, `atk bond ${c.bond.attackMult}`);
                assert.equal(c.bond.contributions.length, RITE_BAND_SIZE - 1, "every other bandmate contributes");
            }
        }
    }
});

// ── Pacing + settlement ─────────────────────────────────────────────────────

test("match length lands in the autobattler band, not the ten-minute lane war", () => {
    const lengths = SEEDS.map((seed) => runWarfrontRite(band("b"), band("r"), seed).totalSeconds);
    const median = [...lengths].sort((a, b) => a - b)[Math.floor(lengths.length / 2)];
    assert.ok(median >= 15, `median combat time ${median.toFixed(1)}s is implausibly short`);
    assert.ok(median <= 240, `median combat time ${median.toFixed(1)}s exceeds the 4-minute ceiling`);
    for (const seconds of lengths) {
        assert.ok(seconds <= 320, `a match ran ${seconds.toFixed(1)}s of pure combat`);
    }
});

test("the verdict view drops snapshots but keeps everything settlement needs", () => {
    const result = runWarfrontRite(band("b"), band("r"), 909);
    const verdict = riteVerdict(result);
    assert.equal(verdict.winner, result.winner);
    assert.equal(verdict.clashCount, result.clashes.length);
    assert.equal(verdict.blueRounds, result.blueRounds);
    assert.equal(verdict.redRounds, result.redRounds);
    assert.ok(!("clashes" in (verdict as Record<string, unknown>)), "verdict must not carry snapshot streams");
    assert.ok(JSON.stringify(verdict).length < 400, "verdict must stay small enough to seal");
});

test("the MVP is credited to the pet that dealt the killing blow", () => {
    // REGRESSION. This shipped awarding an MVP in 0 of 25 matches despite 155
    // enemy KOs, because a `ko` event names the pet that FELL — `actorId` is
    // always "enemy-<lane>" there — while the crediting code read it as the
    // killer and looked for "player-<lane>". Nothing covered the MVP, so the
    // result screen silently never showed one.
    const seeds = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
    let awarded = 0;
    let decisive = 0;
    for (const seed of seeds) {
        const result = runWarfrontRite(band("b"), band("r"), seed);
        // Only matches where blue actually downed someone can have an MVP.
        const blueDownedSomeone = result.clashes.some((clash) =>
            clash.result.events.some((event) => event.type === "ko" && event.side === "enemy"));
        if (!blueDownedSomeone) continue;
        decisive++;
        if (result.mvpSlot !== null) awarded++;
        if (result.mvpSlot !== null) {
            assert.ok(result.mvpSlot >= 0 && result.mvpSlot < RITE_BAND_SIZE,
                `mvpSlot ${result.mvpSlot} is outside the band`);
            assert.equal(result.mvpPetId, String(band("b")[result.mvpSlot]?.id ?? ""),
                "mvpPetId must name the pet in mvpSlot");
        }
    }
    assert.ok(decisive > 0, "no seed produced an enemy KO — the fixture is wrong, not the code");
    assert.equal(awarded, decisive,
        `only ${awarded} of ${decisive} matches with an enemy KO awarded an MVP`);
});
