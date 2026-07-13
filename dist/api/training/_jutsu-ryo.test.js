"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _jutsu_ryo_js_1 = require("./_jutsu-ryo.js");
(0, node_test_1.describe)('server jutsu ryo training', () => {
    (0, node_test_1.it)('grants level one free then debits the canonical paid cost', () => {
        const free = (0, _jutsu_ryo_js_1.startJutsuRyoTraining)({ level: 30, ryo: 20_000, jutsuMastery: [] }, 'fireball', 'Fireball', 'tok', 1, 0);
        strict_1.default.equal(free.ok, true);
        if (!free.ok)
            return;
        strict_1.default.equal(free.character.jutsuMastery[0].level, 1);
        const paid = (0, _jutsu_ryo_js_1.startJutsuRyoTraining)(free.character, 'fireball', 'Fireball', 'tok2', 10, 0);
        strict_1.default.equal(paid.ok, true);
        if (!paid.ok)
            return;
        strict_1.default.equal(paid.cost, 3000);
        strict_1.default.equal(paid.character.ryo, 17_000);
    });
    (0, node_test_1.it)('time-gates completion and derives cancellation/finish wallet mutations from the sealed session', () => {
        const active = { serverToken: 'tok', jutsuId: 'fireball', label: 'Fireball', fromLevel: 1, toLevel: 2, ryoCost: 3000, startedAt: 0, endsAt: 600_000 };
        const char = { level: 30, ryo: 10_000, jutsuMastery: [{ jutsuId: 'fireball', level: 1, xp: 0 }] };
        strict_1.default.equal((0, _jutsu_ryo_js_1.settleJutsuRyoTraining)(char, active, 'complete', 1)?.ok, false);
        const cancelled = (0, _jutsu_ryo_js_1.settleJutsuRyoTraining)(char, active, 'cancel', 1);
        strict_1.default.equal(cancelled.ok, true);
        if (cancelled.ok)
            strict_1.default.equal(cancelled.character.ryo, 11_500);
        const finished = (0, _jutsu_ryo_js_1.settleJutsuRyoTraining)(char, active, 'finish', 60_000);
        strict_1.default.equal(finished.ok, true);
        if (finished.ok) {
            strict_1.default.equal(finished.character.ryo, 5_500);
            strict_1.default.equal(finished.character.jutsuMastery[0].level, 2);
        }
    });
});
