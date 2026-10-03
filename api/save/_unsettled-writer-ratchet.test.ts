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
 *     (settleIdleRecovery or settleVitalsRegen), and EVERY version it builds
 *     passes `regenAt: carriedRegenCursor(...)`, checked below;
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
// Each is a settlement saga whose own receipts and journal recover a lost
// acknowledgement (some through an injected store), so it settles in place
// (settleIdleRecovery) rather than moving onto mutatePlayerSave.
const SETTLES_ITSELF = new Set([
    'pvp/_consumable-settlement.ts',
    // Both ranked fighters; the other one is usually offline.
    'pvp/_player-ranked-journal.ts',
    'pet/_ranked-settlement.ts',
    'village/_elder-ranked-win.ts',
    // Every clan and village treasury gift, and every Seal pool distribution.
    '_cross-key-settlement.ts',
    'clan/exchange/_settlement.ts',
    'clan/seal-pool/donate.ts',
]);

// The calls that credit the recovery before a write.
const SETTLERS = new Set(['settleIdleRecovery', 'settleVitalsRegen']);

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
    // Vanguard seals on a PvP win, and the clan's escorting Pet Tamers, who are usually elsewhere.
    'pvp/_vanguard-rewards.ts': 4,
    // Village rewards, and Honor Seals spent on a village war.
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

type Call = { name: string; carriesSettledCursor: boolean };

/** Whether a call passes `regenAt: carriedRegenCursor(...)` in an options object. */
function carriesSettledCursor(call: ts.CallExpression): boolean {
    return call.arguments.some((arg) => ts.isObjectLiteralExpression(arg) && arg.properties.some((prop) => (
        ts.isPropertyAssignment(prop)
        && ts.isIdentifier(prop.name)
        && prop.name.text === 'regenAt'
        && ts.isCallExpression(prop.initializer)
        && calleeName(prop.initializer.expression) === 'carriedRegenCursor'
    )));
}

/** Every call by name in a source file: comments, strings and declarations are not calls. */
function callsIn(source: string, file: string): Call[] {
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const found: Call[] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
            const name = calleeName(node.expression);
            if (name) found.push({ name, carriesSettledCursor: carriesSettledCursor(node) });
        }
        ts.forEachChild(node, walk);
    };
    walk(sourceFile);
    return found;
}

const isBuilder = (call: Call): boolean => VERSION_BUILDERS.has(call.name);

const calls = new Map<string, Call[]>();
for (const file of collectTsFiles(API_DIR)) {
    const rel = relative(API_DIR, file).replace(/\\/g, '/');
    if (DEFINERS.has(rel)) continue;
    calls.set(rel, callsIn(readFileSync(file, 'utf8'), file));
}
const builderCounts = new Map<string, number>();
for (const [rel, fileCalls] of calls) {
    const count = fileCalls.filter(isBuilder).length;
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
        const fileCalls = calls.get(rel) ?? [];
        const builds = fileCalls.filter(isBuilder);
        assert.ok(builds.length > 0, `${rel} no longer builds a version itself; drop it from SETTLES_ITSELF`);
        assert.ok(
            fileCalls.some((call) => SETTLERS.has(call.name)),
            `${rel} must settle the recovery (settleIdleRecovery) before it writes`,
        );
        // A listed file is exempt from the count, so a new bare build in it
        // would otherwise slip through.
        const fenced = builds.filter((call) => !call.carriesSettledCursor).length;
        assert.equal(
            fenced,
            0,
            `${rel}: ${fenced} of its ${builds.length} version builds fence the cursor; `
            + 'pass regenAt: carriedRegenCursor(settled, next, regen)',
        );
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
            .filter(isBuilder).length,
        1,
        'calls count; comments and strings do not',
    );
    assert.deepEqual(
        callsIn(
            'bumpSaveVersion(r, { regenAt: carriedRegenCursor(a, b, c) });'
            + ' writeVersionedPlayerSaveWithStore(s, k, r, n, {}, { regenAt: carriedRegenCursor(a, n, c) });'
            + ' bumpSaveVersion(r); bumpSaveVersion(r, { regenAt: cursor }); bumpSaveVersion(r, { at: carriedRegenCursor(a, b, c) });',
            'probe.ts',
        ).filter(isBuilder).map((call) => call.carriesSettledCursor),
        [true, true, false, false, false],
        'only regenAt: carriedRegenCursor(...) carries the settled cursor',
    );
});
