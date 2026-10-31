import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { DAILY_COMBAT_STAT_CAP, DAILY_PVP_STAT_CAP, AI_PVE_STAT_POINTS_PER_WIN } from '../_stat-growth.js';
import { FIELD_MISSION_STAT_POINTS } from '../missions/_mission-catalog.js';
import { reserveDailyStatPoints } from '../_daily-stat-budget.js';
import { reserveCombatStatBudget, reservePvpCombatStatBudget } from './_combat-stat-budget.js';

// Hunt and field claims and PvE wins share 120 points. Casual and ranked
// player wins share a separate 50. Every grant credits only its reservation.

const DAY = Date.UTC(2026, 9, 17, 12, 0, 0);
const HOUR = 3_600_000;

describe('cross-source daily stat ceiling (I-12, owner A1)', () => {
    it('PvE and mission claims share 120; casual and ranked player wins independently share 50', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: DAY });
        const store = _makeMemoryKv();
        // Boosted mission claims plus maximum PvE and Warden rolls exhaust 120.
        for (let i = 0; i < 29; i++) {
            const out = await reserveDailyStatPoints(store, {
                playerName: 'ceiling', receiptId: `mission:hunt:${i}`, eventAt: DAY,
                requested: Math.round(FIELD_MISSION_STAT_POINTS * 1.25),
            });
            assert.equal(out.points, 4);
        }
        const pve = [];
        for (const battleId of ['ai-fight:ordinary', 'ai-fight:warden', 'ai-fight:spent']) {
            pve.push((await reserveCombatStatBudget(store, { playerName: 'ceiling', battleId, eventAt: DAY,
                requested: AI_PVE_STAT_POINTS_PER_WIN, cap: DAILY_COMBAT_STAT_CAP })).points);
        }
        assert.deepEqual(pve, [3, 1, 0]);
        const pvp = [];
        const battles = Array.from({ length: 11 }, (_, i) => i % 2 ? `ranked:m${i}` : `casual-m${i}`);
        for (const battleId of battles) {
            pvp.push((await reservePvpCombatStatBudget(store, { playerName: 'ceiling', battleId, eventAt: DAY,
                requested: 6, cap: DAILY_PVP_STAT_CAP })).points);
        }
        assert.deepEqual(pvp, [6, 6, 6, 6, 6, 6, 6, 6, 2, 0, 0]);
        for (const [i, battleId] of battles.entries()) {
            const replay = await reservePvpCombatStatBudget(store, { playerName: 'ceiling', battleId, eventAt: DAY,
                requested: 6, cap: DAILY_PVP_STAT_CAP });
            assert.equal(replay.points, pvp[i]);
            assert.equal(replay.replayed, pvp[i] > 0);
        }
        const late = await reserveDailyStatPoints(store, {
            playerName: 'ceiling', receiptId: 'mission:late', eventAt: DAY, requested: 3,
        });
        assert.deepEqual([late.points, late.budget.spent, late.budget.cap], [0, 120, 120]);
        assert.equal((await store.get<{ spent: number }>('combat-stat-count:ceiling:2026-10-17'))?.spent, 120);
        assert.equal((await store.get<{ spent: number }>('pvp-stat-count:ceiling:2026-10-17'))?.spent, 50);
        const tomorrowPvp = await reservePvpCombatStatBudget(store, { playerName: 'ceiling', battleId: 'new-pvp',
            eventAt: DAY + 24 * HOUR, requested: 6, cap: DAILY_PVP_STAT_CAP });
        const tomorrowPve = await reserveDailyStatPoints(store, { playerName: 'ceiling', receiptId: 'new-pve',
            eventAt: DAY + 24 * HOUR, requested: 3 });
        assert.equal(tomorrowPvp.points, 6);
        assert.equal(tomorrowPve.points, 3);
        // Filling PvP first cannot consume a fresh player's PvE allowance either.
        await reservePvpCombatStatBudget(store, { playerName: 'reverse', battleId: 'pvp-full', eventAt: DAY,
            requested: 50, cap: DAILY_PVP_STAT_CAP });
        assert.equal((await reserveDailyStatPoints(store, { playerName: 'reverse', receiptId: 'hunt', eventAt: DAY, requested: 3 })).points, 3);
    });

    it('a spent budget pays 0 without writing, so a long day of fights never fills the row (#129 used to throw)', async (t) => {
        t.mock.timers.enable({ apis: ['Date'], now: DAY });
        const store = _makeMemoryKv();
        for (let i = 0; i < 40; i += 1) {
            const out = await reserveCombatStatBudget(store, { playerName: 'grinder', battleId: `ai-fight:spend${i}`, eventAt: DAY, requested: 3, cap: DAILY_COMBAT_STAT_CAP });
            assert.equal(out.points, 3);
        }
        for (let i = 0; i < 200; i += 1) {
            const out = await reserveCombatStatBudget(store, { playerName: 'grinder', battleId: `ai-fight:after${i}`, eventAt: DAY + i, requested: 3, cap: DAILY_COMBAT_STAT_CAP });
            assert.equal(out.points, 0, `win ${41 + i}`);
        }
        const row = await store.get<{ spent: number; allocations: Record<string, unknown> }>(`combat-stat-count:grinder:2026-10-17`);
        assert.equal(row?.spent, DAILY_COMBAT_STAT_CAP);
        assert.equal(Object.keys(row?.allocations ?? {}).length, 40, 'only the paying wins hold receipts');
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
        assert.ok(seen >= 3, `expected the PvE, Warden and mission-claim reservations (saw ${seen})`);
    });

    it('casual and ranked PvP reservations both use the separate 50-point cap', () => {
        let seen = 0;
        for (const file of files) {
            for (const call of calls(readFileSync(file, 'utf8'), 'reservePvpCombatStatBudget')) {
                seen++;
                assert.match(call.args[1] ?? '', /\bcap:\s*DAILY_PVP_STAT_CAP\b/, relative(process.cwd(), file));
            }
        }
        assert.equal(seen, 2);
    });

    it('the mission claim credits its reservation unmodified and has no other stat source', () => {
        const source = readFileSync(join(API_ROOT, 'missions', 'claim-mission.ts'), 'utf8');
        assert.equal(calls(source, 'reserveDailyStatPoints').length, 1);
        assert.match(source, /statPointsGranted = reserved\.points;/);
        // The retired first-N-claims rule must not come back beside the budget.
        assert.doesNotMatch(source, /checklistPaysStatPoints|checklistPaidClaims/);
    });
});
