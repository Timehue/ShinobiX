"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const travel_js_1 = require("./travel.js");
const sector_links_js_1 = require("../../shared/sector-links.js");
(0, node_test_1.test)('world travel keeps the intentional three-second duration', () => {
    strict_1.default.equal(travel_js_1.WORLD_TRAVEL_MS, 3_000);
});
(0, node_test_1.test)('world travel only accepts real playable sectors', () => {
    for (const sector of [0, 1, 35, 60, 99])
        strict_1.default.equal((0, travel_js_1.isPlayableWorldSector)(sector), true);
    for (const sector of [-1, 61, 98, 100, 4.5, '12'])
        strict_1.default.equal((0, travel_js_1.isPlayableWorldSector)(sector), false);
});
(0, node_test_1.test)('edge travel requires the authoritative sector, exit, destination, and requested tile', () => {
    const exit = (0, sector_links_js_1.sectorExits)(1)[0];
    const input = {
        originSector: 1,
        originTile: exit.tile,
        destinationSector: exit.destinationSector,
        exitId: exit.id,
    };
    strict_1.default.equal((0, travel_js_1.edgeTravelExit)(input)?.id, exit.id);
    strict_1.default.equal((0, travel_js_1.edgeTravelExit)({ ...input, originSector: 2 }), null);
    strict_1.default.equal((0, travel_js_1.edgeTravelExit)({ ...input, originTile: exit.tile + 1 }), null);
    strict_1.default.equal((0, travel_js_1.edgeTravelExit)({ ...input, destinationSector: 60 }), null);
    strict_1.default.equal((0, travel_js_1.edgeTravelExit)({ ...input, exitId: 'forged' }), null);
});
(0, node_test_1.test)('edge travel is validated independently of lagging live presence', () => {
    const exit = (0, sector_links_js_1.sectorExits)(55)[0];
    const input = {
        originSector: 55,
        originTile: exit.tile,
        destinationSector: exit.destinationSector,
        exitId: exit.id,
    };
    strict_1.default.equal((0, travel_js_1.edgeTravelExit)(input)?.id, exit.id);
});
