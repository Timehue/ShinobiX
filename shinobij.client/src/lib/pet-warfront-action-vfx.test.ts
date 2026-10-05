import assert from "node:assert/strict";
import test from "node:test";
import { rawPetPool } from "../data/pet-pool";
import { balanceBuiltInPetTemplate } from "./pet-balance";
import { runWarfrontRite } from "./pet-warfront-rite";
import { buildWarfrontActionTimeline, warfrontActionProgress } from "./pet-warfront-action-vfx";

test("Turtle Duck, melee and ranged pets retain a visible action for every contact", () => {
    const band = ["Turtle Duck", "Stone Turtle", "Blue Frog", "Ashen Crow"].map((name, i) => ({
        ...balanceBuiltInPetTemplate(rawPetPool.find((pet) => pet.name === name)!), id: `blue-${i}`,
    }));
    const result = runWarfrontRite(band, band.map((pet, i) => ({ ...pet, id: `red-${i}` })), 23);
    for (const clash of result.clashes) {
        const elements = new Map([...clash.blue.map((entry) => [`player-${entry.lane}`, band[entry.slot].element] as const),
            ...clash.red.map((entry) => [`enemy-${entry.lane}`, band[entry.slot].element] as const)]);
        const before = JSON.stringify(clash.result);
        const timeline = buildWarfrontActionTimeline(clash.result, elements);
        for (const event of clash.result.events) {
            if (!["hit", "whiff", "heal", "shield"].includes(event.type) || !event.targetId) continue;
            const action = timeline[event.t].find((entry) => entry.actorId === event.actorId);
            assert.ok(action, `${event.actorId} ${event.type} at ${event.t} must be visible`);
            assert.equal(action.contact, event.t);
            assert.equal(action.element, event.element ?? elements.get(event.actorId));
            assert.ok(timeline[Math.max(0, event.t - 1)].some((entry) => entry.actorId === event.actorId));
            assert.equal(warfrontActionProgress(action, event.t), 1);
        }
        for (const frame of timeline) {
            assert.ok(frame.length <= 8, "AOE must not consume another pet's visual slot");
            assert.equal(new Set(frame.map((entry) => entry.actorId)).size, frame.length);
        }
        assert.equal(JSON.stringify(clash.result), before, "VFX never change simulation or settlement evidence");
    }
});
