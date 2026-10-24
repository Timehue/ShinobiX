import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { DAILY_COMBAT_STAT_CAP, PVP_CASUAL_STAT_POINTS_PER_WIN, AI_PVE_STAT_POINTS_PER_WIN } from '../_stat-growth.js';
import { FIELD_MISSION_STAT_POINTS } from '../missions/_mission-catalog.js';
import { reserveDailyStatPoints } from '../_daily-stat-budget.js';
import { reserveCombatStatBudget } from './_combat-stat-budget.js';

// Owner ruling A1 (2026-10): hunt and field claims, PvE wins (PvE 3, Warden 3)
// and PvP wins (6) share ONE daily stat-point budget of 60, "after all
// multipliers". Every grant reserves its request against that budget and
// credits exactly the reserved points, so no source, no growth event and no
// future multiplier can ever credit more than the cap in a UTC day.

const DAY = Date.UTC(2026, 9, 17, 12, 0, 0);
const HOUR = 3_600_000;

describe('cross-source daily stat ceiling (I-12, owner A1)', () => {
    it('mission claims, PvE, Warden, casual PvP (x2 event), legacy ranked V1 and the ranked journal share one 60/day budget', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: DAY });
        assert.equal(DAILY_COMBAT_STAT_CAP, 60);
        const store = _makeMemoryKv();
        const eventPvpRequest = Math.round(PVP_CASUAL_STAT_POINTS_PER_WIN * 2);
        // Ten boosted hunt claims (+25% mission bonus: round(3 x 1.25) = 4 each).
        const claimPoints = [];
        for (let i = 0; i < 10; i += 1) {
            const out = await reserveDailyStatPoints(store, {
                playerName: 'ceiling', receiptId: `mission:2026-10-17:hunt:hunt-wild-boar:p${i}`, eventAt: DAY,
                requested: Math.round(FIELD_MISSION_STAT_POINTS * 1.25),
            });
            claimPoints.push(out.points);
        }
        assert.deepEqual(claimPoints, Array(10).fill(4));
        const grants = [
            { battleId: 'ai-fight:a', requested: AI_PVE_STAT_POINTS_PER_WIN },  // PvE win
            { battleId: 'ai-fight:w', requested: AI_PVE_STAT_POINTS_PER_WIN },  // Dungeon Warden
            { battleId: 'battle-1', requested: eventPvpRequest },               // casual PvP, x2 event
            { battleId: 'battle-2', requested: eventPvpRequest },               // legacy ranked V1 claim
            { battleId: 'ranked:m1', requested: PVP_CASUAL_STAT_POINTS_PER_WIN }, // modern ranked journal
            { battleId: 'battle-3', requested: eventPvpRequest },
        ];
        const points = [];
        for (const grant of grants) {
            const out = await reserveCombatStatBudget(store, { playerName: 'ceiling', eventAt: DAY, cap: DAILY_COMBAT_STAT_CAP, ...grant });
            points.push(out.points);
        }
        assert.deepEqual(points, [3, 3, 12, 2, 0, 0]);
        assert.equal(claimPoints.reduce((a, b) => a + b, 0) + points.reduce((a, b) => a + b, 0), DAILY_COMBAT_STAT_CAP);
        // A claim after the budget is spent pays 0 and writes no allocation.
        const late = await reserveDailyStatPoints(store, {
            playerName: 'ceiling', receiptId: 'mission:2026-10-17:field:fetch-d-supply-trail:r1', eventAt: DAY, requested: 3,
        });
        assert.deepEqual([late.points, late.budget.spent, late.budget.cap], [0, 60, 60]);

        // Replays return the stored allocation and spend nothing new. A grant
        // the spent budget priced at 0 holds no receipt and reads 0 again.
        for (const [i, grant] of grants.entries()) {
            const replay = await reserveCombatStatBudget(store, { playerName: 'ceiling', eventAt: DAY, cap: DAILY_COMBAT_STAT_CAP, ...grant });
            assert.equal(replay.replayed, points[i] > 0);
            assert.equal(replay.points, points[i]);
        }
        const claimReplay = await reserveDailyStatPoints(store, {
            playerName: 'ceiling', receiptId: 'mission:2026-10-17:hunt:hunt-wild-boar:p3', eventAt: DAY, requested: 4,
        });
        assert.deepEqual([claimReplay.replayed, claimReplay.points], [true, 4], 'a retried claim replays its allocation');
        const row = await store.get<{ spent: number; allocations: Record<string, unknown> }>('combat-stat-count:ceiling:2026-10-17');
        assert.equal(row?.spent, DAILY_COMBAT_STAT_CAP);
        assert.equal(Object.keys(row?.allocations ?? {}).length, 14, 'only paying grants hold receipts; the 0-point fights and the late claim wrote none');

        // The next UTC day starts a fresh budget.
        const tomorrow = await reserveCombatStatBudget(store, {
            playerName: 'ceiling', battleId: 'battle-4', eventAt: DAY + 24 * HOUR, requested: 99, cap: DAILY_COMBAT_STAT_CAP,
        });
        assert.equal(tomorrow.points, DAILY_COMBAT_STAT_CAP);
    });

    it('a spent budget pays 0 without writing, so a long day of fights never fills the row (#129 used to throw)', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: DAY });
        const store = _makeMemoryKv();
        for (let i = 0; i < 20; i += 1) {
            const out = await reserveCombatStatBudget(store, { playerName: 'grinder', battleId: `ai-fight:spend${i}`, eventAt: DAY, requested: 3, cap: 60 });
            assert.equal(out.points, 3);
        }
        for (let i = 0; i < 200; i += 1) {
            const out = await reserveCombatStatBudget(store, { playerName: 'grinder', battleId: `ai-fight:after${i}`, eventAt: DAY + i, requested: 3, cap: 60 });
            assert.equal(out.points, 0, `win ${21 + i}`);
        }
        const row = await store.get<{ spent: number; allocations: Record<string, unknown> }>(`combat-stat-count:grinder:2026-10-17`);
        assert.equal(row?.spent, 60);
        assert.equal(Object.keys(row?.allocations ?? {}).length, 20, 'only the paying wins hold receipts');
    });
});

// ── Source ratchet ─────────────────────────────────────────────────────────
// Every combat grant must credit the reservation itself: computeCombatStatGrowth
// receives the same identifier as its 3rd and 4th argument, and that identifier
// is `statBudget.points`. A multiplier applied after the reservation (the old
// claim-rewards `boosted`) fails here.

const API_ROOT = join(process.cwd(), 'api');

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules') continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...sourceFiles(full));
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
    }
    return out;
}

/** Top-level arguments of the call whose `(` sits at `open`. Type arguments
 *  (`as Record<string, number>`) are tracked so their commas do not split. */
function callArgs(source: string, open: number): string[] {
    const args: string[] = [];
    let depth = 0;
    let angle = 0;
    let current = '';
    for (let i = open; i < source.length; i += 1) {
        const ch = source[i];
        if (ch === '<' && /\w/.test(source[i - 1] ?? '') && /[\w{[]/.test(source[i + 1] ?? '')) {
            angle += 1;
        } else if (ch === '>' && angle > 0) {
            angle -= 1;
        } else if (angle > 0) {
            // inside a type argument list: never a top-level separator
        } else if (ch === '(' || ch === '[' || ch === '{') {
            depth += 1;
            if (depth === 1) continue;
        } else if (ch === ')' || ch === ']' || ch === '}') {
            depth -= 1;
            if (depth === 0) { args.push(current.trim()); return args.filter((arg) => arg !== ''); }
        } else if (ch === ',' && depth === 1) {
            args.push(current.trim());
            current = '';
            continue;
        }
        current += ch;
    }
    throw new Error('unterminated call');
}

function calls(source: string, name: string): Array<{ index: number; args: string[] }> {
    const found: Array<{ index: number; args: string[] }> = [];
    const pattern = new RegExp(`\\b${name}\\(`, 'g');
    for (const match of source.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (/function\s+$/.test(source.slice(Math.max(0, index - 20), index))) continue; // the definition
        found.push({ index, args: callArgs(source, index + name.length) });
    }
    return found;
}

describe('combat stat grants credit exactly the reserved budget (source ratchet)', () => {
    const files = sourceFiles(API_ROOT);
    it('every computeCombatStatGrowth call credits `statBudget.points` unmodified', () => {
        let seen = 0;
        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            for (const call of calls(source, 'computeCombatStatGrowth')) {
                seen += 1;
                const where = `${relative(process.cwd(), file)} @${call.index}`;
                assert.equal(call.args.length, 4, `${where}: expected 4 arguments`);
                const [, , perWin, remaining] = call.args;
                assert.match(perWin, /^[A-Za-z_$][\w$]*$/, `${where}: per-win argument must be a plain identifier`);
                assert.equal(remaining, perWin, `${where}: per-win and remaining must be the same reserved points`);
                assert.ok(new RegExp(`const ${perWin} = statBudget\\.points;`).test(source), `${where}: ${perWin} must be the reservation's points`);
            }
        }
        assert.ok(seen >= 4, `expected the PvE, Warden, casual PvP and ranked journal grants (saw ${seen})`);
    });

    it('every reserveCombatStatBudget call reserves against DAILY_COMBAT_STAT_CAP', () => {
        let seen = 0;
        for (const file of files) {
            const source = readFileSync(file, 'utf8');
            for (const call of calls(source, 'reserveCombatStatBudget')) {
                seen += 1;
                assert.match(call.args[1] ?? '', /\bcap:\s*DAILY_COMBAT_STAT_CAP\b/, `${relative(process.cwd(), file)} @${call.index}`);
            }
        }
        assert.ok(seen >= 5, `expected the PvE, Warden, casual PvP, ranked journal and mission-claim reservations (saw ${seen})`);
    });

    it('the mission claim credits its reservation unmodified and has no other stat source', () => {
        const source = readFileSync(join(API_ROOT, 'missions', 'claim-mission.ts'), 'utf8');
        assert.equal(calls(source, 'reserveDailyStatPoints').length, 1);
        assert.match(source, /statPointsGranted = reserved\.points;/);
        // The retired first-N-claims rule must not come back beside the budget.
        assert.doesNotMatch(source, /checklistPaysStatPoints|checklistPaidClaims/);
    });
});
