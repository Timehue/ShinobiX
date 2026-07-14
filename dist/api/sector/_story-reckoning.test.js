"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const _story_reckoning_js_1 = require("./_story-reckoning.js");
(0, node_test_1.default)("story reckoning eligibility follows level, village, progress, and completion trait", () => {
    const def = _story_reckoning_js_1.STORY_RECKONINGS["story-reckoning-mira-marker"];
    strict_1.default.ok(def);
    strict_1.default.equal((0, _story_reckoning_js_1.storyReckoningEligible)({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [] }, def), true);
    strict_1.default.equal((0, _story_reckoning_js_1.storyReckoningEligible)({ level: 24, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [] }, def), false);
    strict_1.default.equal((0, _story_reckoning_js_1.storyReckoningEligible)({ level: 25, storyVillage: "Ashen Leaf Village", storyProgress: 3, storyTraits: [] }, def), false);
    strict_1.default.equal((0, _story_reckoning_js_1.storyReckoningEligible)({ level: 25, storyVillage: "Stormveil Village", storyProgress: 2, storyTraits: [] }, def), false);
    strict_1.default.equal((0, _story_reckoning_js_1.storyReckoningEligible)({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [def.completionTrait] }, def), false);
});
(0, node_test_1.default)("story reckoning task progress is sealed against a baseline", () => {
    strict_1.default.equal((0, _story_reckoning_js_1.storyReckoningTaskComplete)(10, 21, 12), false);
    strict_1.default.equal((0, _story_reckoning_js_1.storyReckoningTaskComplete)(10, 22, 12), true);
});
(0, node_test_1.default)("story reckoning rewards and item ownership are stable", () => {
    strict_1.default.equal((0, _story_reckoning_js_1.storyReckoningRyo)(58, 6), 1980);
    strict_1.default.equal((0, _story_reckoning_js_1.ownedItemCount)({ inventory: ["event-kesa-marker"], itemStacks: [{ itemId: "event-kesa-marker", count: 2 }] }, "event-kesa-marker"), 3);
});
(0, node_test_1.default)("story reckoning durable seals validate id, stage, and baseline", () => {
    strict_1.default.deepEqual((0, _story_reckoning_js_1.parseStoryReckoningSeal)({ id: "story-reckoning-mira-marker", stage: "task", baseline: 7, at: 9 }), {
        id: "story-reckoning-mira-marker", stage: "task", baseline: 7, at: 9,
    });
    strict_1.default.equal((0, _story_reckoning_js_1.parseStoryReckoningSeal)({ id: "story-reckoning-mira-marker", stage: "forged", baseline: 7, at: 9 }), null);
});
(0, node_test_1.default)("story reckoning claim authority survives cache expiry and abandon is wired to the client", () => {
    const endpoint = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "api", "sector", "story-reckoning.ts"), "utf8");
    const client = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "shinobij.client", "src", "screens", "WorldMap.tsx"), "utf8");
    strict_1.default.match(endpoint, /parseStoryReckoningSeal\(rec\.activeStoryReckoningSeal\)/);
    strict_1.default.match(endpoint, /activeStoryReckoningSeal: nextSeal/);
    strict_1.default.match(client, /abandonStoryReckoning\(character\.name\)/);
});
