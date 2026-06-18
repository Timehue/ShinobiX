"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Save-sanitizer clamp parity guard (server ⇄ client).
 *
 * The HollowGate attunement maxRank map is duplicated across the two build
 * roots: the server clamp (api/save/[name].ts HG_ATTUNEMENT_MAX_RANK) must stay
 * identical to the client catalog (shinobij.client/src/lib/hollow-gate-attunement
 * .ts ATTUNEMENT_NODES) or a forged save could over-rank a node the catalog
 * tightened, or a newly-added node would be silently dropped on save.
 *
 * Static text analysis only — reads source, imports nothing, opens no DB (mirrors
 * api/_combat-formula-parity.test.ts). Paths resolve from process.cwd() (npm test
 * runs from the repo root), so no import.meta (the cPanel CJS build rejects it).
 */
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const ROOT = process.cwd();
const SERVER = (0, node_fs_1.readFileSync)((0, node_path_1.join)(ROOT, 'api', 'save', '[name].ts'), 'utf8');
const CLIENT = (0, node_fs_1.readFileSync)((0, node_path_1.join)(ROOT, 'shinobij.client', 'src', 'lib', 'hollow-gate-attunement.ts'), 'utf8');
function serverMaxRanks() {
    // Grab the HG_ATTUNEMENT_MAX_RANK object literal, then pull 'id': N pairs.
    const block = SERVER.match(/HG_ATTUNEMENT_MAX_RANK[^{]*\{([\s\S]*?)\}/);
    node_assert_1.strict.ok(block, 'server HG_ATTUNEMENT_MAX_RANK map not found — did it move/rename?');
    const out = {};
    for (const m of block[1].matchAll(/['"]([\w-]+)['"]\s*:\s*(\d+)/g))
        out[m[1]] = Number(m[2]);
    return out;
}
function clientMaxRanks() {
    // Each ATTUNEMENT_NODES entry is one line: { id: "x", ... maxRank: N }.
    const block = CLIENT.match(/ATTUNEMENT_NODES[^[]*\[([\s\S]*?)\];/);
    node_assert_1.strict.ok(block, 'client ATTUNEMENT_NODES catalog not found — did it move/rename?');
    const out = {};
    for (const m of block[1].matchAll(/id:\s*['"]([\w-]+)['"][^\n]*?maxRank:\s*(\d+)/g))
        out[m[1]] = Number(m[2]);
    return out;
}
(0, node_test_1.describe)('HollowGate attunement maxRank parity (server clamp ⇄ client catalog)', () => {
    (0, node_test_1.it)('extracts a sane catalog from both sides (guards against a vacuous pass)', () => {
        node_assert_1.strict.ok(Object.keys(clientMaxRanks()).length >= 6, 'expected >= 6 catalog nodes');
        node_assert_1.strict.ok(Object.keys(serverMaxRanks()).length >= 6, 'expected >= 6 server clamp entries');
    });
    (0, node_test_1.it)('server clamp map is identical to the client catalog maxRanks', () => {
        const server = serverMaxRanks();
        const client = clientMaxRanks();
        // Same node ids on both sides...
        node_assert_1.strict.deepEqual(Object.keys(server).sort(), Object.keys(client).sort(), 'node id set drifted — add/rename a node in BOTH api/save/[name].ts and hollow-gate-attunement.ts');
        // ...and the same maxRank for each.
        for (const id of Object.keys(client)) {
            node_assert_1.strict.equal(server[id], client[id], `maxRank drift for "${id}" — server clamp must match the catalog`);
        }
    });
});
