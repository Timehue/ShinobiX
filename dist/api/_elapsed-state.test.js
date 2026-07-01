"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const _elapsed_state_js_1 = require("./_elapsed-state.js");
const NOW = 1_000_000;
function save(over = {}) {
    const { character: characterOverride, ...rest } = over;
    return {
        _saveAt: NOW - 10_000,
        currentSector: 12,
        currentBiome: 'shadow',
        character: {
            name: 'Tester',
            hp: 10,
            maxHp: 100,
            chakra: 20,
            maxChakra: 100,
            stamina: 30,
            maxStamina: 100,
            ...(characterOverride ?? {}),
        },
        ...rest,
    };
}
(0, node_test_1.default)('settleSaveRecord regenerates vitals from _saveAt and clamps to max', () => {
    const result = (0, _elapsed_state_js_1.settleSaveRecord)(save(), { now: NOW });
    strict_1.default.equal(result.changed, true);
    strict_1.default.equal(result.vitalsChanged, true);
    strict_1.default.deepEqual(result.record.character, {
        name: 'Tester',
        hp: 20,
        maxHp: 100,
        chakra: 30,
        maxChakra: 100,
        stamina: 40,
        maxStamina: 100,
    });
    strict_1.default.equal(result.record._saveAt, NOW);
});
(0, node_test_1.default)('settleSaveRecord applies equipped Aura Sphere regen bonus', () => {
    const result = (0, _elapsed_state_js_1.settleSaveRecord)(save({
        character: {
            hp: 10,
            chakra: 10,
            stamina: 10,
            auraSphereLevel: 150,
            equipment: { aura: 'aura-sphere' },
        },
    }), { now: NOW });
    strict_1.default.equal(result.record.character.hp, 40);
    strict_1.default.equal(result.record.character.chakra, 40);
    strict_1.default.equal(result.record.character.stamina, 40);
});
(0, node_test_1.default)('settleSaveRecord does not regenerate during battle locks or Hollow Gate runs', () => {
    const locked = (0, _elapsed_state_js_1.settleSaveRecord)(save(), { now: NOW, battleLocked: true });
    strict_1.default.equal(locked.vitalsChanged, false);
    strict_1.default.equal(locked.record.character.hp, 10);
    const hollow = (0, _elapsed_state_js_1.settleSaveRecord)(save({ character: { hollowGateRun: { completed: false } } }), { now: NOW });
    strict_1.default.equal(hollow.vitalsChanged, false);
    strict_1.default.equal(hollow.record.character.hp, 10);
});
(0, node_test_1.default)('settleSaveRecord completes expired pending travel', () => {
    const result = (0, _elapsed_state_js_1.settleSaveRecord)(save({
        pendingTravel: { destinationSector: 42, arrivalAt: NOW - 1 },
    }), { now: NOW });
    strict_1.default.equal(result.travelChanged, true);
    strict_1.default.equal(result.record.currentSector, 42);
    strict_1.default.equal(result.record.currentBiome, (0, _elapsed_state_js_1.biomeForSettledSector)(42));
    strict_1.default.equal(result.record.pendingTravel, null);
});
(0, node_test_1.default)('settleSaveRecord keeps future pending travel without changing sector', () => {
    const result = (0, _elapsed_state_js_1.settleSaveRecord)(save({
        pendingTravel: { destinationSector: 42, arrivalAt: NOW + 1 },
    }), { now: NOW });
    strict_1.default.equal(result.travelChanged, false);
    strict_1.default.equal(result.record.currentSector, 12);
    strict_1.default.deepEqual(result.record.pendingTravel, { destinationSector: 42, arrivalAt: NOW + 1 });
});
