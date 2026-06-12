/*
 * battle-log colorizer — classification + numeric tokenization.
 * Covers the real line formats emitted by both engines (PvE Arena.tsx and the
 * PvP server api/pvp/move.ts) and the deliberate ordering overlaps.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifyBattleLogLine, tokenizeBattleLogLine, interpolateFlavor } from "./battle-log-format";

describe("classifyBattleLogLine — core categories (user-mandated)", () => {
    it("heal numbers → green/heal", () => {
        assert.equal(classifyBattleLogLine("Heal: Naruto restores 750 HP."), "heal");
        assert.equal(classifyBattleLogLine("Siphon: Sasuke heals 200 HP."), "heal");
        assert.equal(classifyBattleLogLine("Lifesteal: Naruto heals on hit for 2 turns."), "heal");
        assert.equal(classifyBattleLogLine("Naruto absorbs 180 HP."), "heal");
        assert.equal(classifyBattleLogLine("Naruto's armor steals 50 HP."), "heal");
        assert.equal(classifyBattleLogLine("Increase Heal: Naruto's healing is increased by 30% for 2 turns."), "heal");
    });

    it("damage numbers → red/damage", () => {
        assert.equal(classifyBattleLogLine("1355 damage to Sasuke."), "damage");
        assert.equal(classifyBattleLogLine("Damage Dealt: Sasuke takes 1355 damage."), "damage");
        assert.equal(classifyBattleLogLine("Sasuke bleeds 120 (Wound)."), "damage");
        assert.equal(classifyBattleLogLine("Sasuke takes 90 Poison damage."), "damage");
        assert.equal(classifyBattleLogLine("Sasuke drained 60 HP+chakra."), "damage");
        assert.equal(classifyBattleLogLine("Naruto takes 200 reflected damage."), "damage");
        assert.equal(classifyBattleLogLine("Pierce: bypasses defenses."), "damage");
    });

    it("increase/decrease damage → blue/dmgmod (NOT red, even though they contain 'damage')", () => {
        assert.equal(classifyBattleLogLine("+30% Damage Given: Naruto for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("-30% Damage Given: Sasuke for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("+30% Damage Taken: Sasuke for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("-30% Damage Taken: Naruto for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("Increase Damage Taken: Sasuke takes 30% more damage from you."), "dmgmod");
        assert.equal(classifyBattleLogLine("Decrease Damage Given: Sasuke deals 30% less damage for 2 rounds."), "dmgmod");
        assert.equal(classifyBattleLogLine("Ignition: Sasuke +30% damage taken for 2 turns."), "dmgmod");
    });
});

describe("classifyBattleLogLine — other tag colors", () => {
    it("shields / barriers / reflect setup → shield", () => {
        assert.equal(classifyBattleLogLine("Shield: Naruto gains 750 shield."), "shield");
        assert.equal(classifyBattleLogLine("Barrier: Naruto blocks hex 12 for 2 turns."), "shield");
        assert.equal(classifyBattleLogLine("Reflect: Naruto reflects 30% damage for 2 turns."), "shield");
        assert.equal(classifyBattleLogLine("450 absorbed by Sasuke's shield."), "shield");
    });

    it("absorb (converts damage into healing) → heal, not shield/damage", () => {
        assert.equal(classifyBattleLogLine("Absorb: Naruto converts 30% incoming damage for 2 turns."), "heal");
    });

    it("control → amber", () => {
        assert.equal(classifyBattleLogLine("Stun: Sasuke loses 40 AP next turn."), "control");
        assert.equal(classifyBattleLogLine("Push: Sasuke is pushed 2 tile(s)."), "control");
        assert.equal(classifyBattleLogLine("Pull: Sasuke is pulled 1 tile(s)."), "control");
        assert.equal(classifyBattleLogLine("Bloodline Seal: Sasuke's bloodline is sealed."), "control");
        assert.equal(classifyBattleLogLine("Elemental Seal: Sasuke's elemental jutsu are sealed."), "control");
    });

    it("prevents → teal (incl. the 'Debuff Prevent blocks' line)", () => {
        assert.equal(classifyBattleLogLine("Debuff Prevent: Naruto for 2 turns."), "prevent");
        assert.equal(classifyBattleLogLine("Buff Prevent: Sasuke cannot gain positive effects for 2 turns."), "prevent");
        assert.equal(classifyBattleLogLine("Stun Prevent: Naruto is immune to Stun for 2 turns."), "prevent");
        assert.equal(classifyBattleLogLine("Sasuke's Debuff Prevent blocks Poison Cloud."), "prevent");
    });

    it("tempo → violet", () => {
        assert.equal(classifyBattleLogLine("Copy: Naruto copied Shield, Reflect from Sasuke."), "tempo");
        assert.equal(classifyBattleLogLine("Mirror: Naruto copies Stun onto Sasuke."), "tempo");
        assert.equal(classifyBattleLogLine("Lag: Sasuke's actions cost 20% more AP for 1 turn."), "tempo");
        assert.equal(classifyBattleLogLine("Overclock: Naruto's actions cost 20% less AP for 1 turn."), "tempo");
    });

    it("system → gold (cast headers, rounds, win/turn-end)", () => {
        assert.equal(classifyBattleLogLine("--- Round 3 ---"), "system");
        assert.equal(classifyBattleLogLine("Naruto uses Cyclone Cutter: Whirling blades of wind carve the air."), "system");
        assert.equal(classifyBattleLogLine("⚔️ Naruto wins!"), "system");
        assert.equal(classifyBattleLogLine("Naruto ends their turn."), "system");
        assert.equal(classifyBattleLogLine("Naruto moves."), "system");
    });

    it("unknown lines fall back to effect", () => {
        assert.equal(classifyBattleLogLine("Something unexpected happens."), "effect");
        assert.equal(classifyBattleLogLine(""), "effect");
    });
});

describe("tokenizeBattleLogLine — numeric emphasis", () => {
    it("splits out integers, commas, percents, and ~approx", () => {
        const segs = tokenizeBattleLogLine("Heal: Naruto restores 1,355 HP.");
        assert.deepEqual(segs.filter(s => s.isNumber).map(s => s.text), ["1,355"]);

        const pct = tokenizeBattleLogLine("+30% Damage Given: Naruto for 2 turns.");
        assert.deepEqual(pct.filter(s => s.isNumber).map(s => s.text), ["30%", "2"]);

        const approx = tokenizeBattleLogLine("Poison: Sasuke takes ~90/round for 2 turns.");
        assert.deepEqual(approx.filter(s => s.isNumber).map(s => s.text), ["~90", "2"]);
    });

    it("reassembles to the original (trimmed) text", () => {
        const line = "Damage Dealt: Sasuke takes 1355 damage.";
        assert.equal(tokenizeBattleLogLine(line).map(s => s.text).join(""), line);
    });

    it("a line with no numbers is one plain segment", () => {
        const segs = tokenizeBattleLogLine("Pierce: bypasses defenses.");
        assert.equal(segs.length, 1);
        assert.equal(segs[0]!.isNumber, false);
    });
});

describe("interpolateFlavor — %user / %target substitution", () => {
    it("replaces the default tokens with the combatant names", () => {
        assert.equal(interpolateFlavor("Fireball strikes %target", "Naruto", "Sasuke"), "Fireball strikes Sasuke");
        assert.equal(interpolateFlavor("%user vanishes and reappears.", "Naruto", "Sasuke"), "Naruto vanishes and reappears.");
        assert.equal(interpolateFlavor("%user crushes %target with %user's fist.", "Naruto", "Sasuke"), "Naruto crushes Sasuke with Naruto's fist.");
    });

    it("leaves token-free flavor untouched", () => {
        const text = "A spear of compressed water lances forward with crushing force.";
        assert.equal(interpolateFlavor(text, "Naruto", "Sasuke"), text);
    });
});
