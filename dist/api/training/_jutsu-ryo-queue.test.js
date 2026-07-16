"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const _jutsu_ryo_js_1 = require("./_jutsu-ryo.js");
const active = (overrides = {}) => ({
    serverToken: 'active-token',
    jutsuId: 'fireball',
    label: 'Fireball',
    fromLevel: 5,
    toLevel: 6,
    ryoCost: 5000,
    startedAt: 100,
    endsAt: 200,
    ...overrides,
});
(0, node_test_1.describe)('server-settled jutsu queue', () => {
    (0, node_test_1.test)('debits at queue time and refunds the queued cost atomically', () => {
        const queued = (0, _jutsu_ryo_js_1.queueJutsuRyoTraining)({ level: 30, ryo: 20_000, jutsuMastery: [{ jutsuId: 'water-wave', level: 4 }] }, active(), 'water-wave', 'Water Wave', 'queued-token', 0);
        strict_1.default.equal(queued.ok, true);
        if (!queued.ok)
            return;
        strict_1.default.equal(queued.character.ryo, 15_500);
        strict_1.default.equal(queued.active.next?.serverToken, 'queued-token');
        const cancelled = (0, _jutsu_ryo_js_1.cancelQueuedJutsuRyoTraining)(queued.character, queued.active);
        strict_1.default.equal(cancelled.ok, true);
        if (!cancelled.ok)
            return;
        strict_1.default.equal(cancelled.character.ryo, 20_000);
        strict_1.default.equal(cancelled.active.next, null);
    });
    (0, node_test_1.test)('promotes and auto-claims elapsed queued training on the server', () => {
        const run = active({
            next: { serverToken: 'queued-token', jutsuId: 'water-wave', label: 'Water Wave', fromLevel: 4, toLevel: 5, ryoCost: 4500, durationMs: 100 },
        });
        const settled = (0, _jutsu_ryo_js_1.advanceQueuedJutsuRyoTraining)({ level: 30, ryo: 10_000, jutsuMastery: [{ jutsuId: 'fireball', level: 5 }, { jutsuId: 'water-wave', level: 4 }] }, run, 301);
        strict_1.default.equal(settled.active, null);
        const rows = settled.character.jutsuMastery;
        strict_1.default.equal(rows.find((row) => row.jutsuId === 'fireball')?.level, 6);
        strict_1.default.equal(rows.find((row) => row.jutsuId === 'water-wave')?.level, 5);
    });
});
