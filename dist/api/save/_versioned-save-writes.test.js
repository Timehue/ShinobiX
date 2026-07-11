"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
/*
 * Reward-integrity guard: EVERY server endpoint that writes a player save
 * (`save:<name>`) must bump `_saveVersion` — i.e. go through a versioned helper
 * (bumpSaveVersion / writeVersionedPlayerSave / mutatePlayerSave). If it writes
 * the save row without a version bump, a stale browser tab can later pass the
 * `/api/save/:name` version check and CLOBBER the server-side mutation
 * (currency, XP, rewards). That was the historical treasury/kick bug; this test
 * fails the build if a new endpoint reintroduces it.
 *
 * Static source scan (like server-routes.test.ts). It flags a file that writes a
 * player-save key but contains NO versioning helper at all — the exact
 * fully-unversioned failure mode. Player-save keys are `save:${...}` (variable
 * right after `save:`); clan blobs (`save:clan-...`) and village/game state keys
 * are a different shape and carry their own validators, so they're not in scope.
 */
// Resolve api/ from the repo root (npm test always runs from there). import.meta is
// not usable here: api/ test files are compiled by the CommonJS server build too.
const API_DIR = (0, node_path_1.join)(process.cwd(), 'api');
// A raw player-save write: kv.set(`save:${...   (NOT save:clan-…, which has a literal prefix).
const PLAYER_SAVE_WRITE = /kv\.set\(\s*`save:\$\{/;
const VERSIONED = /bumpSaveVersion|writeVersionedPlayerSave|mutatePlayerSave|versionedPlayerRecord/;
// Legitimately exempt: admin-only tools run behind admin auth and intentionally
// restore/rewrite saves wholesale (the `?signal=1` admin bypass on the save
// endpoint). They are NOT reachable by an ordinary player, so a stale-tab clobber
// is not the same risk. Keep this list SMALL and admin-only.
const ALLOW = new Set([
    'admin/save-snapshot.ts',
]);
function collectTsFiles(dir, out = []) {
    for (const entry of (0, node_fs_1.readdirSync)(dir, { withFileTypes: true })) {
        const p = (0, node_path_1.join)(dir, entry.name);
        if (entry.isDirectory())
            collectTsFiles(p, out);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
            out.push(p);
    }
    return out;
}
(0, node_test_1.test)('every non-admin endpoint that writes a player save uses a versioned helper (no _saveVersion bypass)', () => {
    const offenders = [];
    for (const file of collectTsFiles(API_DIR)) {
        const src = (0, node_fs_1.readFileSync)(file, 'utf8');
        const writesPlayerSave = src
            .split('\n')
            .some((line) => PLAYER_SAVE_WRITE.test(line) && !line.includes('save:clan-'));
        if (!writesPlayerSave)
            continue;
        const rel = (0, node_path_1.relative)(API_DIR, file).replace(/\\/g, '/');
        if (ALLOW.has(rel))
            continue;
        if (!VERSIONED.test(src))
            offenders.push(rel);
    }
    strict_1.default.deepEqual(offenders, [], `These endpoints write a player save (save:<name>) without any version bump — a stale ` +
        `client tab could clobber the mutation. Route the write through writeVersionedPlayerSave/` +
        `mutatePlayerSave (api/save/_mutate-player-save.ts) or wrap the record in bumpSaveVersion:\n  ` +
        offenders.join('\n  '));
});
(0, node_test_1.test)('the guard actually finds player-save writes (self-check: it is scanning real code)', () => {
    // Sanity: the scan must see a healthy number of versioned player-save writers,
    // or the regex/path has silently broken and the guard above is vacuous.
    let writers = 0;
    for (const file of collectTsFiles(API_DIR)) {
        const src = (0, node_fs_1.readFileSync)(file, 'utf8');
        if (src.split('\n').some((l) => PLAYER_SAVE_WRITE.test(l) && !l.includes('save:clan-')))
            writers++;
    }
    strict_1.default.ok(writers >= 10, `expected the scan to find many player-save writers, found ${writers} — regex or path likely broken`);
});
