/*
 * battle-log colorizer — classification + numeric tokenization.
 * Covers the real line formats emitted by both engines (PvE Arena.tsx and the
 * PvP server api/pvp/move.ts) and the deliberate ordering overlaps.
 */
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { classifyBattleLogLine, tokenizeBattleLogLine, interpolateFlavor, glyphForBattleLogLine, groupBattleLogActions } from "./battle-log-format";

describe("classifyBattleLogLine — core categories (user-mandated)", () => {
    it("heal numbers → green/heal", () => {
        assert.equal(classifyBattleLogLine("Heal: Raiko restores 750 HP."), "heal");
        assert.equal(classifyBattleLogLine("Siphon: Mira heals 200 HP."), "heal");
        assert.equal(classifyBattleLogLine("Lifesteal: Raiko heals on hit for 2 turns."), "heal");
        assert.equal(classifyBattleLogLine("Raiko absorbs 180 HP."), "heal");
        assert.equal(classifyBattleLogLine("Raiko's armor steals 50 HP."), "heal");
        assert.equal(classifyBattleLogLine("Increase Heal: Raiko's healing is increased by 30% for 2 turns."), "heal");
    });

    it("damage numbers → red/damage", () => {
        assert.equal(classifyBattleLogLine("1355 damage to Mira."), "damage");
        assert.equal(classifyBattleLogLine("Damage Dealt: Mira takes 1355 damage."), "damage");
        assert.equal(classifyBattleLogLine("Mira bleeds 120 (Wound)."), "damage");
        assert.equal(classifyBattleLogLine("Mira takes 90 Poison damage."), "damage");
        assert.equal(classifyBattleLogLine("Mira drained 60 HP+chakra."), "damage");
        assert.equal(classifyBattleLogLine("Raiko takes 200 reflected damage."), "damage");
        assert.equal(classifyBattleLogLine("Pierce: bypasses defenses."), "damage");
    });

    it("increase/decrease damage → blue/dmgmod (NOT red, even though they contain 'damage')", () => {
        assert.equal(classifyBattleLogLine("+30% Damage Given: Raiko for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("+21% Damage Given (stack 1/2): Raiko for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("-30% Damage Given: Mira for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("+30% Damage Taken: Mira for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("-30% Damage Taken: Raiko for 2 turns."), "dmgmod");
        assert.equal(classifyBattleLogLine("Increase Damage Taken: Mira takes 30% more damage from you."), "dmgmod");
        assert.equal(classifyBattleLogLine("Decrease Damage Given: Mira deals 30% less damage for 2 rounds."), "dmgmod");
        assert.equal(classifyBattleLogLine("Ignition: Mira +30% damage taken for 2 turns."), "dmgmod");
    });
});

describe("classifyBattleLogLine — other tag colors", () => {
    it("shields / barriers / reflect setup → shield", () => {
        assert.equal(classifyBattleLogLine("Shield: Raiko gains 750 shield."), "shield");
        assert.equal(classifyBattleLogLine("Barrier: Raiko blocks hex 12 for 2 turns."), "shield");
        assert.equal(classifyBattleLogLine("Reflect: Raiko reflects 30% damage for 2 turns."), "shield");
        assert.equal(classifyBattleLogLine("450 absorbed by Mira's shield."), "shield");
    });

    it("absorb (converts damage into healing) → heal, not shield/damage", () => {
        assert.equal(classifyBattleLogLine("Absorb: Raiko converts 30% incoming damage for 2 turns."), "heal");
    });

    it("control → amber", () => {
        assert.equal(classifyBattleLogLine("Stun: Mira loses 40 AP next turn."), "control");
        assert.equal(classifyBattleLogLine("Push: Mira is pushed 2 tile(s)."), "control");
        assert.equal(classifyBattleLogLine("Pull: Mira is pulled 1 tile(s)."), "control");
        assert.equal(classifyBattleLogLine("Bloodline Seal: Mira's bloodline is sealed."), "control");
        assert.equal(classifyBattleLogLine("Elemental Seal: Mira's elemental jutsu are sealed."), "control");
    });

    it("prevents → teal (incl. the 'Debuff Prevent blocks' line)", () => {
        assert.equal(classifyBattleLogLine("Debuff Prevent: Raiko for 2 turns."), "prevent");
        assert.equal(classifyBattleLogLine("Buff Prevent: Mira cannot gain positive effects for 2 turns."), "prevent");
        assert.equal(classifyBattleLogLine("Stun Prevent: Raiko is immune to Stun for 2 turns."), "prevent");
        assert.equal(classifyBattleLogLine("Mira's Debuff Prevent blocks Poison Cloud."), "prevent");
    });

    it("tempo → violet", () => {
        assert.equal(classifyBattleLogLine("Copy: Raiko copied Shield, Reflect from Mira."), "tempo");
        assert.equal(classifyBattleLogLine("Mirror: Raiko copies Stun onto Mira."), "tempo");
        assert.equal(classifyBattleLogLine("Lag: each of Mira's actions costs 10 more AP next round."), "tempo");
        assert.equal(classifyBattleLogLine("Overclock: each of Raiko's actions costs 10 less AP next round."), "tempo");
    });

    it("system → gold (cast headers, rounds, win/turn-end)", () => {
        assert.equal(classifyBattleLogLine("--- Round 3 ---"), "system");
        assert.equal(classifyBattleLogLine("Raiko uses Cyclone Cutter: Whirling blades of wind carve the air."), "system");
        assert.equal(classifyBattleLogLine("⚔️ Raiko wins!"), "system");
        assert.equal(classifyBattleLogLine("Raiko ends their turn."), "system");
        assert.equal(classifyBattleLogLine("Raiko moves."), "system");
    });

    it("unknown lines fall back to effect", () => {
        assert.equal(classifyBattleLogLine("Something unexpected happens."), "effect");
        assert.equal(classifyBattleLogLine(""), "effect");
    });
});

describe("tokenizeBattleLogLine — numeric emphasis", () => {
    it("splits out integers, commas, percents, and ~approx", () => {
        const segs = tokenizeBattleLogLine("Heal: Raiko restores 1,355 HP.");
        assert.deepEqual(segs.filter(s => s.isNumber).map(s => s.text), ["1,355"]);

        const pct = tokenizeBattleLogLine("+30% Damage Given: Raiko for 2 turns.");
        assert.deepEqual(pct.filter(s => s.isNumber).map(s => s.text), ["30%", "2"]);

        const approx = tokenizeBattleLogLine("Poison: Mira takes ~90/round for 2 turns.");
        assert.deepEqual(approx.filter(s => s.isNumber).map(s => s.text), ["~90", "2"]);
    });

    it("reassembles to the original (trimmed) text", () => {
        const line = "Damage Dealt: Mira takes 1355 damage.";
        assert.equal(tokenizeBattleLogLine(line).map(s => s.text).join(""), line);
    });

    it("a line with no numbers is one plain segment", () => {
        const segs = tokenizeBattleLogLine("Pierce: bypasses defenses.");
        assert.equal(segs.length, 1);
        assert.equal(segs[0]!.isNumber, false);
    });
});

describe("glyphForBattleLogLine — category marker", () => {
    it("each category maps to a distinct, non-empty glyph", () => {
        const g = {
            heal: glyphForBattleLogLine("Heal: Raiko restores 750 HP."),
            damage: glyphForBattleLogLine("1355 damage to Mira."),
            shield: glyphForBattleLogLine("Shield: Raiko gains 750 shield."),
            control: glyphForBattleLogLine("Stun: Mira loses 40 AP next turn."),
            system: glyphForBattleLogLine("--- Round 3 ---"),
        };
        for (const v of Object.values(g)) assert.ok(v && v.length > 0);
        // distinct across these five
        assert.equal(new Set(Object.values(g)).size, 5);
    });
});

describe("groupBattleLogActions — owner-attributed grouping", () => {
    it("keeps both labeled Overload stacks under the same cast", () => {
        const { actions } = groupBattleLogActions([
            "Raiko uses Overload: Power surges through the user.",
            "+21% Damage Given (stack 1/2): Raiko for 2 turns.",
            "+21% Damage Given (stack 2/2): Raiko for 2 turns.",
        ], "Raiko", "Mira");

        assert.equal(actions.length, 1);
        assert.deepEqual(actions[0]!.effectLines, [
            "+21% Damage Given (stack 1/2): Raiko for 2 turns.",
            "+21% Damage Given (stack 2/2): Raiko for 2 turns.",
        ]);
    });

    it("groups a cast's effect lines under the caster, numbering real casts", () => {
        const { actions } = groupBattleLogActions([
            "Raiko uses Lightning Lance: Lightning pierces the air.",
            "Damage Dealt: Mira takes 450 damage.",
            "Raiko's shield blocks 100 damage.", // MUST stay an effect, not a new action
            "Mira uses Fireball: Flames roar.",
            "Damage Dealt: Raiko takes 300 damage.",
        ], "Raiko", "Mira");

        assert.equal(actions.length, 2);
        assert.equal(actions[0]!.role, "player");
        assert.equal(actions[0]!.actor, "Raiko");
        assert.equal(actions[0]!.actionNumber, 1);
        assert.equal(actions[0]!.headline, "Lightning Lance: Lightning pierces the air.");
        assert.equal(actions[0]!.effectLines.length, 2); // damage + shield-block
        assert.equal(actions[1]!.role, "enemy");
        assert.equal(actions[1]!.actor, "Mira");
        assert.equal(actions[1]!.actionNumber, 2);
    });

    it("treats basic attacks as casts and turn/win narration as ownerless-by-side", () => {
        const { actions } = groupBattleLogActions([
            "Raiko attacks Mira for 245 damage.",
            "Mira ends their turn.",
            "⚔️ Raiko wins!",
        ], "Raiko", "Mira");

        assert.equal(actions[0]!.actionNumber, 1);
        assert.equal(actions[0]!.actor, "Raiko");
        assert.equal(actions[1]!.actor, ""); // turn-pass: slim narration
        assert.equal(actions[1]!.role, "enemy"); // colored by side
        assert.equal(actions[2]!.actor, ""); // win banner
        assert.equal(actions[2]!.role, "system"); // "⚔️"-led → no side
    });

    it("continues cast numbering across rounds via startActionNumber", () => {
        const r1 = groupBattleLogActions(["Raiko uses A: x."], "Raiko", "Mira", 0);
        const r2 = groupBattleLogActions(["Mira uses B: y."], "Raiko", "Mira", r1.nextActionNumber);
        assert.equal(r1.actions[0]!.actionNumber, 1);
        assert.equal(r2.actions[0]!.actionNumber, 2);
    });

    it("skips round separators", () => {
        const { actions } = groupBattleLogActions(["--- Round 2 ---", "Raiko uses A: x."], "Raiko", "Mira");
        assert.equal(actions.length, 1);
    });
});

describe("interpolateFlavor — %user / %target substitution", () => {
    it("replaces the default tokens with the combatant names", () => {
        assert.equal(interpolateFlavor("Fireball strikes %target", "Raiko", "Mira"), "Fireball strikes Mira");
        assert.equal(interpolateFlavor("%user vanishes and reappears.", "Raiko", "Mira"), "Raiko vanishes and reappears.");
        assert.equal(interpolateFlavor("%user crushes %target with %user's fist.", "Raiko", "Mira"), "Raiko crushes Mira with Raiko's fist.");
    });

    it("leaves token-free flavor untouched", () => {
        const text = "A spear of compressed water lances forward with crushing force.";
        assert.equal(interpolateFlavor(text, "Raiko", "Mira"), text);
    });
});
