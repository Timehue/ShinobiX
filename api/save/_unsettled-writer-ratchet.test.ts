import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/*
 * Ratchet: player-save versions built OUTSIDE mutatePlayerSave.
 *
 * mutatePlayerSave (api/save/_mutate-player-save.ts) credits the idle recovery
 * a player earned since the regeneration cursor before its decision reads the
 * save, and its write carries that cursor forward (carriedRegenCursor). A
 * writer that builds the next version itself skips both. The version bump
 * fences the cursor to "now", and every point of HP, chakra and stamina
 * recovered since the player's last save is gone. It hurts most when the
 * player is not online: a PvP loser whose rating the winner's claim settles,
 * a kicked clan member, everyone a ranked-season rollover touches.
 *
 * The raw-write ratchet in _versioned-save-writes.test.ts cannot see this. It
 * counts raw kv writes, and most of these writers go through a versioned
 * helper. So this one counts every call to the version builders below, per
 * file, and each file must be exactly one of:
 *   - SETTLES_ITSELF: it settles the recovery into its own write
 *     (settleVitalsRegen + carriedRegenCursor), checked below;
 *   - BY_DESIGN, with the reason;
 *   - TO_CONVERT, with the EXACT count of its builder calls. A conversion
 *     lowers the count (and deletes the entry at zero). A new builder call, in
 *     any file, fails here.
 * Each conversion carries a regen proof that drives the real handler (see
 * _settled-mutation-writers.test.ts for the pattern).
 */

// Resolved from the repo root, as npm test runs (see _versioned-save-writes.test.ts).
const API_DIR = join(process.cwd(), 'api');

const VERSION_BUILDERS = new Set([
    'bumpSaveVersion',
    'versionedPlayerRecord',
    'writeVersionedPlayerSave',
    'writeVersionedPlayerSaveWithStore',
    'writeSaveProjected',
]);

// Where the builders live. mutatePlayerSave is the sanctioned caller of them.
const DEFINERS = new Set(['save/_save-version.ts', 'save/_mutate-player-save.ts', 'save/_projected-write.ts']);

// Settle the recovery into their own write; verified by the second test.
const SETTLES_ITSELF = new Set([
    // Settles through its injected store and carries the cursor (#268).
    'pvp/_consumable-settlement.ts',
]);

const OPEN_HOLLOW_GATE_RUN = 'An open Hollow Gate run excludes idle recovery (canRegenVitals), and this writes a save whose run is open';
const BY_DESIGN: Readonly<Record<string, string>> = {
    '_elapsed-state.ts': 'The idle-recovery settle itself: its bump carries the cursor it has just advanced',
    'admin/content-publish.ts': 'Mirrors published content into the admin slots, which are not player saves',
    '_qa-sector-war.ts': 'Test-only journey fixture (NODE_ENV=test + QA memory KV) that positions two saves',
    'hollow-gate/combat-settle.ts': OPEN_HOLLOW_GATE_RUN,
    'hollow-gate/event.ts': OPEN_HOLLOW_GATE_RUN,
    // It closes the run, but the save it writes still holds it until then.
    'hollow-gate/settle.ts': OPEN_HOLLOW_GATE_RUN,
    'hollow-gate/use-consumable.ts': OPEN_HOLLOW_GATE_RUN,
};

// Audited 2026-10-03: each fences the cursor without settling the recovery.
const TO_CONVERT: Readonly<Record<string, number>> = {
    // Season rollover: every ranked player, almost all of them offline.
    'cron/_ranked-season.ts': 1,
    // Both ranked fighters, and up to four 2v2 players; the others are usually offline.
    'pvp/_player-ranked-journal.ts': 1,
    'pvp/_ranked-2v2-settlement.ts': 2,
    'pet/_ranked-settlement.ts': 1,
    'pvp/_vanguard-rewards.ts': 4,
    'village/_elder-ranked-win.ts': 1,
    // Clans: dissolve and kick write members who are not there.
    'clan/_dissolve.ts': 1,
    'clan/kick.ts': 1,
    'clan/leave.ts': 2,
    'clan/exchange/_settlement.ts': 1,
    'clan/exchange/purchase.ts': 1,
    'clan/seal-pool/distribute.ts': 1,
    'clan/seal-pool/donate.ts': 1,
    'clan/treasury/transfer.ts': 1,
    'clan/war/_mpvp-consumables.ts': 2,
    'clan/war/_war-points.ts': 1,
    'village/treasury/transfer.ts': 1,
    'village/claim-map-control.ts': 1,
    '_war-declaration-funding.ts': 2,
    '_war-mercenary-hire.ts': 1,
    // Missions.
    'missions/claim-mission.ts': 5,
    'missions/queue-combat-claim.ts': 1,
    // Pets.
    'pet/breeding-hatch.ts': 1,
    'pet/breeding-start.ts': 1,
    'pet/breeding-status.ts': 1,
    'pet/sanctuary-transfer.ts': 2,
    'pet/showdown.ts': 2,
    // Towers entry fee and its refund.
    'towers/start.ts': 8,
    // Training: start also checks its stamina cost against the unsettled
    // stamina, refusing a lesson the player's screen shows they can afford.
    'training/start.ts': 1,
    'training/complete.ts': 1,
    // Drops the attacker's PvP shield just before the fight reads their vitals.
    'player/attack.ts': 1,
};

function collectTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) collectTsFiles(path, out);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(path);
    }
    return out;
}

function calleeName(expression: ts.LeftHandSideExpression): string | null {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
    return null;
}

/** Every call by name in a source file: comments, strings and declarations are not calls. */
function callsIn(source: string, file: string): string[] {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const names: string[] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const name = calleeName(node.expression);
            if (name) names.push(name);
        }
        ts.forEachChild(node, walk);
    };
    walk(sourceFile);
    return names;
}

const calls = new Map<string, string[]>();
for (const file of collectTsFiles(API_DIR)) {
    const rel = relative(API_DIR, file).replace(/\\/g, '/');
    if (DEFINERS.has(rel)) continue;
    calls.set(rel, callsIn(readFileSync(file, 'utf8'), file));
}
const builderCounts = new Map<string, number>();
for (const [rel, names] of calls) {
    const count = names.filter((name) => VERSION_BUILDERS.has(name)).length;
    if (count > 0) builderCounts.set(rel, count);
}

test('every save version built outside mutatePlayerSave is classified, and the to-convert counts are exact', () => {
    const drift: string[] = [];
    for (const [rel, count] of [...builderCounts].sort()) {
        if (SETTLES_ITSELF.has(rel) || rel in BY_DESIGN) continue;
        const allowed = TO_CONVERT[rel] ?? 0;
        if (count !== allowed) drift.push(`${rel}: allowlisted ${allowed}, found ${count}`);
    }
    for (const [rel, allowed] of Object.entries(TO_CONVERT)) {
        if (!builderCounts.has(rel)) drift.push(`${rel}: allowlisted ${allowed}, found 0`);
    }
    assert.deepEqual(
        drift,
        [],
        'Player-save versions built outside mutatePlayerSave changed. A NEW one discards the idle recovery a '
        + 'player earned: commit through mutatePlayerSave (or mutatePlayerSaveLocked under a lock you already '
        + 'hold) instead. A conversion must lower its TO_CONVERT entry (delete it at zero).\n  '
        + drift.join('\n  '),
    );
});

test('a writer listed as settling the recovery itself really does', () => {
    for (const rel of SETTLES_ITSELF) {
        const names = calls.get(rel) ?? [];
        assert.ok(builderCounts.has(rel), `${rel} no longer builds a version itself; drop it from SETTLES_ITSELF`);
        assert.ok(names.includes('settleVitalsRegen'), `${rel} must settle the recovery (settleVitalsRegen) before it writes`);
        assert.ok(names.includes('carriedRegenCursor'), `${rel} must carry the settled cursor (carriedRegenCursor), not fence it`);
    }
});

test('every by-design entry still builds a version, so a stale reason cannot hide a new writer', () => {
    for (const rel of Object.keys(BY_DESIGN)) {
        assert.ok(builderCounts.has(rel), `${rel} no longer builds a save version; remove it from BY_DESIGN`);
    }
});

test('the scan sees the version builders it is meant to police', () => {
    // A scanner that silently found nothing would pass every assertion above.
    const total = [...builderCounts.values()].reduce((sum, count) => sum + count, 0);
    assert.ok(total >= 20, `only ${total} builder calls found; the AST scan is broken`);
    assert.equal(
        callsIn("bumpSaveVersion({}); /* writeSaveProjected(k, a, b) */ const s = 'versionedPlayerRecord(x)';", 'probe.ts')
            .filter((name) => VERSION_BUILDERS.has(name)).length,
        1,
        'calls count; comments and strings do not',
    );
});
