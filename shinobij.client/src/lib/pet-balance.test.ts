import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pet, PetJutsu, PetRarity } from "../types/pet";
import {
    petTemplateArchetype,
    applyArchetypeKit,
    mythicSignatureMechanic,
    balanceBuiltInPetTemplate,
    mergePetJutsuSlots,
    applyAuthoredPetJutsus,
    capPetStats,
    gainPetXp,
    PET_LEVEL_GROWTH,
    type PetTemplateArchetype,
} from "./pet-balance";
import { rawPetPool } from "../data/pet-pool";
import { petStatCaps, balancedPetBaseStats } from "../data/pet-stats";

// The Phase-12 archetype mechanics — the kinds the rarity budget caps.
const NEW_MECH = new Set<PetJutsu["kind"]>(["wound", "mark", "slow", "haste", "taunt", "push", "pull"]);
const BUDGET: Record<PetRarity, number> = { standard: 0, rare: 1, legendary: 2, mythic: 99 };

const pool = rawPetPool.map(balanceBuiltInPetTemplate);
const byRarity = (r: PetRarity) => pool.filter(p => p.rarity === r);
const newMechCount = (p: Pet) => p.jutsus.filter(j => NEW_MECH.has(j.kind)).length;

// ── petTemplateArchetype ─────────────────────────────────────────────────

test("petTemplateArchetype is deterministic and returns a valid sub-role for any input", () => {
    const ALL: PetTemplateArchetype[] = ["tank", "bruiser", "striker", "kite", "control", "support", "assassin"];
    assert.equal(petTemplateArchetype("Fire", 0), petTemplateArchetype("Fire", 0));
    assert.ok(ALL.includes(petTemplateArchetype(undefined, 3)));
    assert.ok(ALL.includes(petTemplateArchetype("None", 3)));
    // Negative/large variants wrap cleanly (no out-of-bounds).
    assert.ok(petTemplateArchetype("Water", 123).length > 0);
});

test("each element spreads across multiple roles", () => {
    for (const el of ["Fire", "Water", "Wind", "Lightning", "Earth"] as const) {
        const roles = new Set<PetTemplateArchetype>();
        for (let v = 0; v < 10; v++) roles.add(petTemplateArchetype(el, v));
        assert.ok(roles.size >= 2, `${el} should span ≥2 roles, got ${[...roles]}`);
    }
});

// ── applyArchetypeKit ────────────────────────────────────────────────────

const synthKit = (): PetJutsu[] => [
    { name: "X Strike", power: 50, cooldown: 2, currentCooldown: 0, kind: "damage" },
    { name: "X Util1", power: 30, cooldown: 4, currentCooldown: 0, kind: "barrier" },
    { name: "X Util2", power: 0, cooldown: 5, currentCooldown: 0, kind: "movelock" },
    { name: "X Dash", power: 0, cooldown: 3, currentCooldown: 0, kind: "move" },
];

test("applyArchetypeKit never touches the damage or move slots", () => {
    const out = applyArchetypeKit(synthKit(), "assassin", "legendary", "X");
    assert.equal(out[0].kind, "damage");
    assert.equal(out[0].name, "X Strike");
    assert.equal(out[3].kind, "move");
    assert.equal(out[3].name, "X Dash");
});

test("legendary budget grants exactly the archetype's two mechanics", () => {
    const a = applyArchetypeKit(synthKit(), "assassin", "legendary", "X");
    assert.deepEqual([a[1].kind, a[2].kind], ["mark", "wound"]);
    // Control is ranged → push (peel), NOT pull; bruiser is melee → pull (anti-kite).
    const c = applyArchetypeKit(synthKit(), "control", "legendary", "X");
    assert.deepEqual([c[1].kind, c[2].kind], ["slow", "push"]);
    const b = applyArchetypeKit(synthKit(), "bruiser", "legendary", "X");
    assert.deepEqual([b[1].kind, b[2].kind], ["wound", "pull"]);
    const t = applyArchetypeKit(synthKit(), "tank", "legendary", "X");
    assert.deepEqual([t[1].kind, t[2].kind], ["taunt", "shield"]);
});

test("standard gets zero new mechanics (basic kinds only)", () => {
    for (const arch of ["tank", "bruiser", "striker", "kite", "control", "support", "assassin"] as PetTemplateArchetype[]) {
        const out = applyArchetypeKit(synthKit(), arch, "standard", "X");
        assert.equal(out.filter(j => NEW_MECH.has(j.kind)).length, 0, `${arch} standard`);
    }
});

test("support stays sustain-focused — one mechanic, keeps a heal, no control/offense", () => {
    const leg = applyArchetypeKit(synthKit(), "support", "legendary", "X");
    assert.ok(leg.some(j => j.kind === "heal"));
    assert.ok(!leg.some(j => ["wound", "mark", "slow", "pull"].includes(j.kind)));
});

test("pure-status kinds are pinned to 0 power; power-bearing kinds keep a seed", () => {
    const out = applyArchetypeKit(synthKit(), "striker", "rare", "X"); // mark (status) + debuff (power)
    const mark = out.find(j => j.kind === "mark")!;
    assert.equal(mark.power, 0);
    const debuff = out.find(j => j.kind === "debuff")!;
    assert.ok(debuff.power > 0);
});

// ── Pool-wide invariants (all 140 built-ins) ──────────────────────────────

test("every non-mythic pet respects its rarity's new-mechanic budget", () => {
    for (const p of pool) {
        if (p.rarity === "mythic") continue;
        assert.ok(newMechCount(p) <= BUDGET[p.rarity], `${p.id} ${p.name}: ${newMechCount(p)} > ${BUDGET[p.rarity]}`);
    }
});

test("standard pets carry no new mechanics at all", () => {
    for (const p of byRarity("standard")) assert.equal(newMechCount(p), 0, `${p.name}`);
});

test("every pet keeps exactly one move slot and at least one offensive option", () => {
    const OFFENSE = new Set<PetJutsu["kind"]>(["damage", "dot", "wound", "push", "pull", "lifesteal", "crush", "burn"]);
    for (const p of pool) {
        assert.equal(p.jutsus.filter(j => j.kind === "move").length, 1, `${p.name} move slots`);
        assert.ok(p.jutsus.some(j => OFFENSE.has(j.kind)), `${p.name} has no offense`);
    }
});

test("every jutsu power stays within the rarity cap (no balance blowups)", () => {
    for (const p of pool) {
        const cap = petStatCaps[p.rarity].jutsuPower;
        for (const j of p.jutsus) assert.ok(j.power <= cap, `${p.name}/${j.name}: ${j.power} > ${cap}`);
    }
});

test("the redesign preserves slot COUNT per non-mythic template (save-merge stays aligned)", () => {
    // standard 3 base + special + signature = 5; rare 4 base +2 = 6; legendary 4 base +2 = 6.
    const expect: Record<string, number> = { standard: 5, rare: 6, legendary: 6 };
    for (const p of pool) {
        if (p.rarity === "mythic") continue;
        assert.equal(p.jutsus.length, expect[p.rarity], `${p.name} (${p.rarity}) slot count`);
    }
});

// ── Mythic signature mechanic ─────────────────────────────────────────────

test("mythicSignatureMechanic returns a themed move for every mythic and null otherwise", () => {
    assert.equal(mythicSignatureMechanic("Abyssal Oni Hound")?.kind, "wound");
    assert.equal(mythicSignatureMechanic("Ancient Frost Titan")?.kind, "taunt");
    assert.equal(mythicSignatureMechanic("Eclipse Kitsune")?.kind, "haste");
    assert.equal(mythicSignatureMechanic("Not A Pet"), null);
});

test("each mythic gains its appended mechanic while keeping its hand-crafted damage", () => {
    const oni = pool.find(p => p.name === "Abyssal Oni Hound")!;
    assert.ok(oni.jutsus.some(j => j.name === "Abyssal Rend" && j.kind === "wound"));
    assert.ok(oni.jutsus.some(j => j.name === "Abyss Bite" && j.kind === "damage")); // inline kit preserved
    const titan = pool.find(p => p.name === "Ancient Frost Titan")!;
    assert.ok(titan.jutsus.some(j => j.kind === "taunt"));
    assert.ok(titan.jutsus.some(j => j.name === "Glacier Crush" && j.kind === "damage"));
});

test("re-balancing is idempotent — no duplicate appended mechanic", () => {
    const oni = pool.find(p => p.name === "Abyssal Oni Hound")!;
    const twice = balanceBuiltInPetTemplate(oni);
    assert.equal(twice.jutsus.filter(j => j.name === "Abyssal Rend").length, 1);
});

// ── Signature uniqueness + strength (mythics + apex legendaries) ──────────

test("every elemental pet keeps a flagged signature, and it is the strongest move in its kit", () => {
    for (const p of pool) {
        const sig = p.jutsus.find(j => j.signature);
        assert.ok(sig, `${p.name} has no signature`);
        const maxPower = Math.max(...p.jutsus.map(j => j.power));
        assert.equal(sig!.power, maxPower, `${p.name}: signature ${sig!.power} not the strongest (${maxPower})`);
    }
});

test("each mythic keeps a UNIQUE flagship signature name (no two mythics share one)", () => {
    const sigs = pool.filter(p => p.rarity === "mythic").map(p => p.jutsus.find(j => j.signature)!.name);
    assert.equal(new Set(sigs).size, sigs.length, `duplicate mythic signatures: ${sigs}`);
    assert.ok(sigs.every(n => n.length > 0), "every mythic has a named signature");
});

test("apex legendaries get a unique, stronger signature than a normal legendary", () => {
    const apexNames = ["Inferno Chimera", "Tidelord Leviathan", "Storm Roc", "Thunder Raiju", "Titan Golem"];
    const sigPower = (name: string) => pool.find(p => p.name === name)!.jutsus.find(j => j.signature)!.power;
    const normalLegendary = sigPower("Glacier Wolf"); // not in the apex set
    for (const name of apexNames) {
        const p = pool.find(x => x.name === name)!;
        const sig = p.jutsus.find(j => j.signature)!;
        assert.ok(/:/.test(sig.name), `${name} apex signature should be a flagship name, got ${sig.name}`);
        assert.ok(sig.power > normalLegendary, `${name} signature ${sig.power} should beat a normal legendary's ${normalLegendary}`);
        assert.ok(sig.power < 152, `${name} signature should stay below the mythic 152`);
    }
});

// ── Phase 12c: save migration (mergePetJutsuSlots) ────────────────────────

const jt = (over: Partial<PetJutsu>): PetJutsu => ({ name: "X", power: 0, cooldown: 3, currentCooldown: 0, kind: "damage", ...over });

test("migration: a legacy pet ADOPTS the redesigned utility kind but keeps its leveled power", () => {
    // Old saved standard pet (pre-redesign generic kit) — note the leveled powers.
    const legacy = [
        jt({ name: "Red Fox Strike", kind: "damage", power: 210, cooldown: 3 }),   // leveled
        jt({ name: "Red Fox Guard", kind: "barrier", power: 160, cooldown: 5 }),    // legacy utility
        jt({ name: "Red Fox Dash", kind: "move", power: 0, cooldown: 4 }),
    ];
    // New template (bruiser re-theme): slot 1 became a wound; +special +signature.
    const template = [
        jt({ name: "Red Fox Strike", kind: "damage", power: 60, cooldown: 3 }),
        jt({ name: "Red Fox Rending Maul", kind: "wound", power: 65, cooldown: 5 }),
        jt({ name: "Red Fox Dash", kind: "move", power: 0, cooldown: 4 }),
        jt({ name: "Searing Mark", kind: "burn", power: 40, cooldown: 5, rounds: 2 }),
        jt({ name: "Cinder Devour", kind: "lifesteal", power: 90, cooldown: 4, signature: true }),
    ];
    const out = mergePetJutsuSlots(legacy, template);
    assert.equal(out.length, 5);
    // Utility slot adopts the redesign (kind + name)…
    assert.equal(out[1].kind, "wound");
    assert.equal(out[1].name, "Red Fox Rending Maul");
    // …while the player's higher leveled power survives (investment preserved).
    assert.equal(out[1].power, 160);
    assert.equal(out[0].kind, "damage");
    assert.equal(out[0].power, 210); // leveled damage power kept
    assert.equal(out[2].kind, "move");
    // New trailing slots backfill from the template.
    assert.equal(out[3].kind, "burn");
    assert.equal(out[4].kind, "lifesteal");
    assert.equal(out[4].signature, true);
    assert.ok(out.every(j => j.currentCooldown === 0));
});

test("migration: a power-0 legacy utility becoming a power-bearing kind takes the template power", () => {
    const legacy = [jt({ name: "Bind", kind: "movelock", power: 0 })];
    const template = [jt({ name: "Rend", kind: "wound", power: 70 })];
    assert.equal(mergePetJutsuSlots(legacy, template)[0].power, 70);
});

test("migration is idempotent — an already-migrated kit is unchanged in kind", () => {
    const fox = pool.find(p => p.id === "standard-0")!;        // already-balanced template
    const once = mergePetJutsuSlots(fox.jutsus, fox.jutsus);
    assert.deepEqual(once.map(j => j.kind), fox.jutsus.map(j => j.kind));
    assert.deepEqual(once.map(j => j.name), fox.jutsus.map(j => j.name));
});

test("migration keeps an extra player-only slot when the template has fewer", () => {
    const legacy = [jt({ name: "A", kind: "damage" }), jt({ name: "B", kind: "heal", power: 50 }), jt({ name: "C", kind: "move" })];
    const template = [jt({ name: "A2", kind: "damage" })];
    const out = mergePetJutsuSlots(legacy, template);
    assert.equal(out.length, 3);
    assert.equal(out[1].kind, "heal"); // no template slot → player slot kept
    assert.equal(out[2].kind, "move");
});

// ── Admin-published (authored) kit (applyAuthoredPetJutsus) ────────────────

test("authored: a slot adopts the admin effect AND power exactly (WYSIWYG, even a decrease)", () => {
    const authored = [
        jt({ name: "Storm Fang", kind: "damage", power: 120, cooldown: 3 }),    // renamed + recooled
        jt({ name: "Tengu Focus", kind: "buff", power: 30, cooldown: 3 }),
    ];
    const out = applyAuthoredPetJutsus(authored);
    assert.equal(out[0].name, "Storm Fang");
    assert.equal(out[0].cooldown, 3);          // admin effect wins
    assert.equal(out[0].power, 120);           // admin power wins exactly — no Math.max with a leveled 250
    assert.ok(out.every(j => j.currentCooldown === 0));
});

test("authored: an admin REMOVAL shortens the kit to the template length", () => {
    const authored = [jt({ name: "A", kind: "damage", power: 60 })];   // admin deleted B and C
    const out = applyAuthoredPetJutsus(authored);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "A");
    assert.equal(out[0].power, 60);             // admin power is authoritative
});

test("authored: an admin ADDITION backfills a trailing slot from the template", () => {
    const authored = [jt({ name: "A", kind: "damage", power: 60 }), jt({ name: "Newfang", kind: "crush", power: 90, cooldown: 4 })];
    const out = applyAuthoredPetJutsus(authored);
    assert.equal(out.length, 2);
    assert.equal(out[0].power, 60);             // admin power, not a stale leveled power
    assert.equal(out[1].name, "Newfang");
    assert.equal(out[1].kind, "crush");
    assert.equal(out[1].power, 90);             // new slot → template power
});

test("authored merge is idempotent", () => {
    const authored = [jt({ name: "A", kind: "damage", power: 60 }), jt({ name: "B", kind: "mark", power: 0, cooldown: 4, rounds: 3 })];
    const once = applyAuthoredPetJutsus(authored);
    const twice = applyAuthoredPetJutsus(once);
    assert.deepEqual(twice.map(j => j.name), authored.map(j => j.name));
    assert.deepEqual(twice.map(j => j.kind), authored.map(j => j.kind));
    assert.deepEqual(twice.map(j => j.power), authored.map(j => j.power));
});

// ── Uncapped, base-anchored, level-gated training (training revamp) ────────

const stdPet = (over: Partial<Pet> = {}): Pet => ({ ...byRarity("standard")[0], level: 1, xp: 0, maxLevel: 100, ...over });
// XP needed to climb `n` levels from level 1 (petXpNeeded = max(100, level*100)).
const xpForLevels = (n: number) => Array.from({ length: n }, (_, i) => Math.max(100, (i + 1) * 100)).reduce((a, b) => a + b, 0);

test("capPetStats no longer ceilings HP/ATK/DEF/SPD but still caps jutsu power", () => {
    const huge = capPetStats(stdPet({
        hp: 99999, attack: 5000, defense: 4000, speed: 3000,
        jutsus: byRarity("standard")[0].jutsus.map(j => ({ ...j, power: j.power > 0 ? 99999 : 0 })),
    }));
    assert.equal(huge.hp, 99999);
    assert.equal(huge.attack, 5000);
    assert.equal(huge.defense, 4000);
    assert.equal(huge.speed, 3000);
    const cap = petStatCaps.standard.jutsuPower;
    for (const j of huge.jutsus) assert.ok(j.power <= cap, `jutsu ${j.name}: ${j.power} > ${cap}`);
});

test("gainPetXp channels base-anchored growth into the trained stat (strength → ATK only)", () => {
    const pet = stdPet();
    const out = gainPetXp(pet, xpForLevels(5), "strength"); // 5 level-ups, all → attack
    assert.equal(out.level, 6);
    const b = balancedPetBaseStats.standard;
    assert.equal(out.attack - pet.attack, Math.round(b.attack * PET_LEVEL_GROWTH * 5));
    assert.equal(out.hp - pet.hp, 0);        // strength doesn't grow the other stats
    assert.equal(out.defense - pet.defense, 0);
    assert.equal(out.speed - pet.speed, 0);
});

test("bond / untrained XP grows all four stats — rotation avoids rounding small stats to zero", () => {
    const pet = stdPet();
    const out = gainPetXp(pet, xpForLevels(4), "bond"); // reaches level 5: one level each to def/spd/hp/atk
    const b = balancedPetBaseStats.standard;
    assert.equal(out.hp - pet.hp, Math.round(b.hp * PET_LEVEL_GROWTH));
    assert.equal(out.attack - pet.attack, Math.round(b.attack * PET_LEVEL_GROWTH));
    assert.equal(out.defense - pet.defense, Math.round(b.defense * PET_LEVEL_GROWTH));
    assert.equal(out.speed - pet.speed, Math.round(b.speed * PET_LEVEL_GROWTH));
    assert.ok(out.attack - pet.attack >= 1, "small-base ATK still grows (no round-to-zero)");
});

test("a max-level pet gains no stats from further training XP (the level-100 ceiling)", () => {
    const maxed = stdPet({ level: 100, xp: 0 });
    const out = gainPetXp(maxed, xpForLevels(3), "strength");
    assert.equal(out.level, 100);
    assert.equal(out.attack, maxed.attack);
    assert.equal(out.hp, maxed.hp);
});
