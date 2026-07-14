"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const _pet_expedition_lease_js_1 = require("./_pet-expedition-lease.js");
const character = {
    profession: 'petTamer',
    pets: [{
            id: 'pet-1', level: 30, maxLevel: 100,
            expedition: {
                type: 'scout', token: 'token123', startedAt: 1_000, endsAt: 2_701_000, durationMs: 2_700_000,
                serverSeal: { petLevel: 30, expRewardMult: 1.2, expMaterialMult: 1.1, rewardScale: 1, tamer: true },
            },
        }],
};
(0, node_test_1.default)('saved expedition seal survives cache loss only for its exact lease token', () => {
    strict_1.default.deepEqual((0, _pet_expedition_lease_js_1.petExpeditionSealForToken)(character, 'token123', 'Player'), {
        playerName: 'Player', petId: 'pet-1', expType: 'scout', durationMinutes: 45, petLevel: 30,
        endsAt: 2_701_000, expRewardMult: 1.2, expMaterialMult: 1.1, rewardScale: 1, tamer: true,
    });
    strict_1.default.equal((0, _pet_expedition_lease_js_1.petExpeditionSealForToken)(character, 'newerToken', 'Player'), null);
});
(0, node_test_1.default)('legacy protected leases recover conservatively and malformed leases do not', () => {
    const legacy = structuredClone(character);
    delete legacy.pets[0].expedition.serverSeal;
    strict_1.default.equal((0, _pet_expedition_lease_js_1.petExpeditionSealForToken)(legacy, 'token123', 'Player')?.expRewardMult, 1);
    legacy.pets[0].expedition.endsAt = legacy.pets[0].expedition.startedAt;
    strict_1.default.equal((0, _pet_expedition_lease_js_1.petExpeditionSealForToken)(legacy, 'token123', 'Player'), null);
});
(0, node_test_1.default)('start persists fallback authority and settlement rechecks the exact saved token', () => {
    const start = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'missions', 'expedition-start.ts'), 'utf8');
    const report = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'missions', 'report-pet-event.ts'), 'utf8');
    strict_1.default.match(start, /serverSeal: \{ petLevel: sealedPetLevel/);
    strict_1.default.match(report, /lease\.token !== expeditionReceipt/);
    strict_1.default.match(report, /character: current\?\.character \?\? null/);
});
