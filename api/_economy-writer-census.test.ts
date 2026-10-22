import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

/*
 * The I-19 coverage ratchet (2026-10 economy rebalance, BTEI-08). Framework
 * 8.2's Phase 0 exit needs telemetry on at least 90% of currency writers, and a
 * hand-kept list can pass that gate while writers nobody listed stay invisible.
 * So the census is mechanical: every route registered in server-api-routes.ts
 * is read together with its same-directory `./_helper` imports, and a group
 * that both commits a save and assigns one of the economy currencies counts as
 * a currency writer. Each writer must either record its deltas (call
 * recordEconomyTxn) or sit in PENDING_CURRENCY_WRITERS below.
 *
 * The heuristic over-approximates: a route that only reads a balance it then
 * commits can be flagged. Such a route leaves the pending list either by being
 * instrumented or by moving to NOT_CURRENCY_WRITERS with a reason.
 *
 * Ratchet: instrumenting a pending route fails "pending routes are not yet
 * instrumented" until it is deleted from PENDING_CURRENCY_WRITERS, and then
 * PENDING_BUDGET must come down with it. Never raise the budget to make a new
 * writer pass; instrument it. The rows api/_economy-coverage.test.ts pins are
 * the source-tag floor; this file is the census.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split('/')), 'utf8');

const ECON_FIELD = '(?:ryo|fateShards|boneCharms|auraStones|auraDust|honorSeals|mythicSeals|hollowShards|chroniclePoints)';
const SAVE_COMMIT = /\b(?:mutatePlayerSaves?|mutatePlayerSaveLocked|commitPlayerSave\w*|writeVersionedPlayerSave\w*|writeSaveProjected|settleCrossKeyTransfer|runSaveDebitSaga)\s*[<(]/;
const CURRENCY_ASSIGN = [
    new RegExp(`\\b${ECON_FIELD}\\s*:\\s*[^,}\\n]*?[-+]\\s*[\\w(]`),
    new RegExp(`\\b${ECON_FIELD}\\s*:\\s*Math\\.(?:max|min|floor)\\(`),
    new RegExp(`\\.${ECON_FIELD}\\s*[-+]?=[^=]`),
    /\[(?:currency|cur|key|resource|res)\w*\]\s*:\s*[^,}\n]*?[-+]/,
];

function registeredRoutes(): string[] {
    const src = read('server-api-routes.ts');
    const files = [...src.matchAll(/from\s+'\.\/(api\/[^']+)\.js'/g)].map((m) => `${m[1]}.ts`);
    return [...new Set(files)].filter((file) => !/\/_[^/]*$/.test(file) && existsSync(join(ROOT, file)));
}

function routeGroup(file: string): string[] {
    const src = read(file);
    const dir = dirname(file).replace(/\\/g, '/');
    const helpers = [...src.matchAll(/from\s+'(\.\/_[^']+)\.js'/g)]
        .map((m) => posix.normalize(posix.join(dir, `${m[1]}.ts`)))
        .filter((helper) => existsSync(join(ROOT, helper)));
    return [file, ...helpers];
}

type Census = { writers: Set<string>; instrumented: Set<string> };
let cachedCensus: Census | null = null;
function census(): Census {
    if (cachedCensus) return cachedCensus;
    const writers = new Set<string>();
    const instrumented = new Set<string>();
    for (const route of registeredRoutes()) {
        const sources = routeGroup(route).map(read);
        const writes = sources.some((s) => SAVE_COMMIT.test(s)) && sources.some((s) => CURRENCY_ASSIGN.some((re) => re.test(s)));
        if (sources.some((s) => s.includes('recordEconomyTxn('))) instrumented.add(route);
        else if (writes) writers.add(route);
    }
    cachedCensus = { writers, instrumented };
    return cachedCensus;
}

/** Flagged by the census but not instrumented yet. Delete a row when its route records its deltas. */
const PENDING_CURRENCY_WRITERS: readonly string[] = [
    'api/achievements/sync.ts',
    'api/admin/legacy.ts',
    'api/aura/feed.ts',
    'api/bank/transfer.ts',
    'api/clan/mentor.ts',
    'api/clan/seal-pool/distribute.ts',
    'api/clan/seal-pool/donate.ts',
    'api/clan/war/declare.ts',
    'api/first-pact/state.ts',
    'api/hollow-gate/attune.ts',
    'api/hollow-gate/card-settle.ts',
    'api/hollow-gate/combat-settle.ts',
    'api/hollow-gate/event.ts',
    'api/hollow-gate/forge-key.ts',
    'api/hollow-gate/use-consumable.ts',
    'api/jutsu/speedup.ts',
    'api/legacy/sage.ts',
    'api/legacy/stats.ts',
    'api/missions/ai-fight-start.ts',
    'api/missions/daily.ts',
    'api/missions/field-trail.ts',
    'api/missions/report-pvp-win.ts',
    'api/missions/weekly-board.ts',
    'api/play/reward-claim.ts',
    'api/save/[name].ts',
    'api/sector/contract.ts',
    'api/sector/road-flee.ts',
    'api/sector/shrine-offer.ts',
    'api/story/settle.ts',
    'api/towers/action.ts',
    'api/towers/join.ts',
    'api/towers/my-run.ts',
    'api/towers/settle.ts',
    'api/towers/spire-leaderboard.ts',
    'api/towers/start.ts',
    'api/towers/state.ts',
    'api/training/jutsu-ryo.ts',
    'api/village/hollow-gate-unlock.ts',
    'api/village/transfer.ts',
    'api/world-state.ts',
    'api/world/explore.ts',
];
/** Lower with every route that leaves PENDING_CURRENCY_WRITERS. Phase 0 exits at <= 10% of all writers. */
const PENDING_BUDGET = 41;

/** Census false positives, each with the reason it moves no economy currency. */
const NOT_CURRENCY_WRITERS: Readonly<Record<string, string>> = {};

describe('economy telemetry census (I-19)', () => {
    it('every currency-writing route records its deltas or is pending', () => {
        const { writers } = census();
        const unknown = [...writers].filter((route) => !PENDING_CURRENCY_WRITERS.includes(route) && !(route in NOT_CURRENCY_WRITERS));
        assert.deepEqual(unknown, [], `new currency writer(s) with no recordEconomyTxn call: ${unknown.join(', ')}. Record the server-computed delta after the commit.`);
    });

    it('pending routes are not yet instrumented (the ratchet)', () => {
        const { instrumented } = census();
        const done = PENDING_CURRENCY_WRITERS.filter((route) => instrumented.has(route));
        assert.deepEqual(done, [], `now instrumented, so delete from PENDING_CURRENCY_WRITERS and lower PENDING_BUDGET: ${done.join(', ')}`);
    });

    it('the pending list only names live routes, once each, within its budget', () => {
        const routes = new Set(registeredRoutes());
        for (const route of PENDING_CURRENCY_WRITERS) assert.ok(routes.has(route), `${route} is not a registered route`);
        for (const route of Object.keys(NOT_CURRENCY_WRITERS)) assert.ok(routes.has(route), `${route} is not a registered route`);
        assert.equal(new Set(PENDING_CURRENCY_WRITERS).size, PENDING_CURRENCY_WRITERS.length, 'a route is listed twice');
        assert.ok(PENDING_CURRENCY_WRITERS.length <= PENDING_BUDGET, `${PENDING_CURRENCY_WRITERS.length} pending routes exceed the budget of ${PENDING_BUDGET}`);
    });
});

// ─── How the instrumented writers record ──────────────────────────────────────

function apiSources(dir = 'api'): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) { if (entry.name !== 'node_modules') out.push(...apiSources(rel)); continue; }
        if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts') && rel !== 'api/_economy.ts') out.push(rel);
    }
    return out;
}

/** The closing paren of the call whose '(' is at `open`, skipping strings and comments. */
function matchingParen(src: string, open: number): number {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
        if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; if (i <= 0) return -1; continue; }
        if (ch === '\'' || ch === '"' || ch === '`') {
            for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
            continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')' && --depth === 0) return i;
    }
    return -1;
}

const callChunks = (src: string) => src.split('recordEconomyTxn(').slice(1).map((chunk) => chunk.slice(0, 400));
const literal = (chunk: string, field: string) => new RegExp(`\\b${field}:\\s*'([^']+)'`).exec(chunk)?.[1];

describe('instrumented writers record after the commit, once per source', () => {
    const instrumentedFiles = apiSources().filter((file) => read(file).includes('recordEconomyTxn('));

    it('finds the instrumented writers', () => {
        assert.ok(instrumentedFiles.length >= 15, `only ${instrumentedFiles.length} files call recordEconomyTxn`);
    });

    it('no recordEconomyTxn call sits inside a mutatePlayerSave callback (outside afterCommit)', () => {
        // The callback can run and then lose its compare-and-set, and a replay
        // re-enters it, so a call there logs deltas that never committed.
        const offenders: string[] = [];
        for (const file of instrumentedFiles) {
            const src = read(file);
            for (const m of src.matchAll(/\bmutatePlayerSave(?:Locked)?\s*(?:<[^>()]*>)?\s*\(/g)) {
                const open = m.index! + m[0].length - 1;
                const close = matchingParen(src, open);
                if (close < 0) continue;
                const body = src.slice(open, close);
                let at = body.indexOf('recordEconomyTxn(');
                while (at >= 0) {
                    if (!body.slice(Math.max(0, at - 600), at).includes('afterCommit')) offenders.push(`${file} @${open + at}`);
                    at = body.indexOf('recordEconomyTxn(', at + 1);
                }
            }
        }
        assert.deepEqual(offenders, []);
    });

    it('a literal source tag belongs to one file, and each file records a (currency, source) pair once', () => {
        const owner = new Map<string, string>();
        for (const file of instrumentedFiles) {
            const pairs = new Set<string>();
            for (const chunk of callChunks(read(file))) {
                const source = literal(chunk, 'source');
                if (!source) continue;
                const prior = owner.get(source);
                assert.ok(!prior || prior === file, `source '${source}' is recorded by both ${prior} and ${file}; one ledger source, one writer`);
                owner.set(source, file);
                const currency = literal(chunk, 'currency');
                if (!currency) continue;
                const pair = `${currency}/${source}`;
                assert.ok(!pairs.has(pair), `${file} records ${pair} twice, double-counting every delta`);
                pairs.add(pair);
            }
        }
    });

    it('every sink and burn tag logs a NEGATIVE delta', () => {
        const SINK = /(?:\.burn|\.fee|\.stake|\.meal|\.cook|\.pay-skip)$|^profile\.|^hospital\./;
        for (const file of instrumentedFiles) {
            for (const chunk of callChunks(read(file))) {
                const source = literal(chunk, 'source');
                if (source && SINK.test(source)) assert.match(chunk, /delta: -/, `${file} logs sink '${source}' as a positive delta`);
            }
        }
    });
});
