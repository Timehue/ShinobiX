"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const _mission_catalog_js_1 = require("./_mission-catalog.js");
const _storage_js_1 = require("../clan-boss/_storage.js");
// Member-count scaling: a 1–5 member clan can't rush hall tiers; 10–15 = the
// "normal" balance scale (1.0×); capped at 1.0× so mega-clans don't run away.
(0, node_test_1.default)('clanXpMemberScale dampens small clans and caps at 1.0x', () => {
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(1), 0.2);
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(2), 0.2);
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(3), 0.4);
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(5), 0.4);
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(6), 0.7);
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(9), 0.7);
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(10), 1); // normal scale begins
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(15), 1);
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(50), 1); // capped — no mega-clan runaway
    strict_1.default.equal((0, _mission_catalog_js_1.clanXpMemberScale)(0), 0.2); // defensive (clan always has ≥1)
});
(0, node_test_1.default)('scaledClanXp floors the member-scaled amount', () => {
    strict_1.default.equal((0, _mission_catalog_js_1.scaledClanXp)(4100, 12), 4100); // normal clan = full mission set
    strict_1.default.equal((0, _mission_catalog_js_1.scaledClanXp)(4100, 5), 1640); // 0.4×
    strict_1.default.equal((0, _mission_catalog_js_1.scaledClanXp)(4100, 1), 820); // 0.2×
    strict_1.default.equal((0, _mission_catalog_js_1.scaledClanXp)(450, 6), 315); // 0.7× of a single mission
    strict_1.default.equal((0, _mission_catalog_js_1.scaledClanXp)(0, 12), 0);
    strict_1.default.equal((0, _mission_catalog_js_1.scaledClanXp)(100, 0), 20);
});
// Boss "engaged" XP: any clan that dealt damage (not just killers) climbs,
// damage-scaled between a floor and a cap.
(0, node_test_1.default)('clanBossEngagedXp rewards damagers with a floor + cap', () => {
    strict_1.default.equal((0, _storage_js_1.clanBossEngagedXp)(0), 0); // no damage = no reward
    strict_1.default.equal((0, _storage_js_1.clanBossEngagedXp)(1), _storage_js_1.CB_ENGAGED_XP_FLOOR); // tiny damage ≈ floor
    strict_1.default.ok((0, _storage_js_1.clanBossEngagedXp)(1000) > _storage_js_1.CB_ENGAGED_XP_FLOOR);
    strict_1.default.equal((0, _storage_js_1.clanBossEngagedXp)(10_000_000), _storage_js_1.CB_ENGAGED_XP_CAP); // capped
});
