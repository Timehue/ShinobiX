"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const sector_links_js_1 = require("../shared/sector-links.js");
(0, node_test_1.default)('sector roads cover the whole standard world with reciprocal bounded exits', () => {
    strict_1.default.equal(sector_links_js_1.SECTOR_ROAD_PAIRS.length, 82);
    strict_1.default.equal(sector_links_js_1.SECTOR_EXITS.length, sector_links_js_1.SECTOR_ROAD_PAIRS.length * 2);
    for (let sector = 1; sector <= 60; sector += 1) {
        const exits = (0, sector_links_js_1.sectorExits)(sector);
        strict_1.default.ok(exits.length >= 2 && exits.length <= 4, `sector ${sector} has ${exits.length} exits`);
        strict_1.default.equal(new Set(exits.map((exit) => exit.tile)).size, exits.length, `sector ${sector} exit tiles are unique`);
        for (const exit of exits) {
            strict_1.default.ok(exit.tile >= 0 && exit.tile < 144);
            strict_1.default.ok(exit.destinationTile >= 0 && exit.destinationTile < 144);
            const reverse = (0, sector_links_js_1.sectorExitById)(exit.destinationSector, exit.destinationExitId);
            strict_1.default.ok(reverse, `missing reverse for ${exit.id}`);
            strict_1.default.equal(reverse.destinationSector, sector);
            strict_1.default.equal(reverse.destinationExitId, exit.id);
        }
    }
    strict_1.default.equal((0, sector_links_js_1.sectorExits)(99).length, 0);
    const reached = new Set([1]);
    const queue = [1];
    while (queue.length) {
        const sector = queue.shift();
        for (const exit of (0, sector_links_js_1.sectorExits)(sector)) {
            if (reached.has(exit.destinationSector))
                continue;
            reached.add(exit.destinationSector);
            queue.push(exit.destinationSector);
        }
    }
    strict_1.default.equal(reached.size, 60, 'all standard sectors are connected by roads');
});
