/*
 * Currency-ledger audit and repair (P0-5).
 *
 * The ledger at `ledger:currency:<name>` holds the ten currency balances of
 * each player's save, committed with it whenever a write moves currency
 * (api/save/_commit-player-save.ts). This tool answers the question the
 * fail-closed step depends on: does every ledger row agree with its save?
 *
 *   node --import tsx scripts/currency-ledger-audit.mjs            # read-only audit
 *   node --import tsx scripts/currency-ledger-audit.mjs --repair   # also repair, under each save's lock
 *   node --import tsx scripts/currency-ledger-audit.mjs --json     # machine-readable summary
 *
 * `--backfill` is kept as an alias of `--repair`. A repair goes through the
 * same locked, save-asserting reconcile the scheduled sweep runs
 * (api/cron/_currency-ledger-sweep.ts); it only ever writes `ledger:` keys,
 * and player saves are never modified by this script. A DIVERGENT row is
 * reported, and repaired only while the gate is report-only.
 *
 * Statuses (classifyCurrencyLedger):
 *   match / lagging     normal
 *   missing / legacy    not yet created / still the v1 projection (backfill)
 *   orphan / ahead      a reused name's row / a row newer than a restored save
 *   lagging-different   a writer moved currency without the commit helper
 *   divergent           same save version, different balances — a bug
 *
 * Exit codes: 0 = no divergence, 1 = at least one DIVERGENT record, 2 = the
 * audit itself failed.
 */
import { loadProjectEnv } from './_load-env.mjs';
await loadProjectEnv();
const { kv } = await import('../api/_storage.js');
import { CURRENCY_LEDGER_FIELDS, classifyCurrencyLedger, readCurrencyLedger } from '../api/_currency-ledger.js';
import { isPlayerSaveName, reconcileCurrencyLedger } from '../api/cron/_currency-ledger-sweep.js';

const args = new Set(process.argv.slice(2));
const REPAIR = args.has('--repair') || args.has('--backfill');
const AS_JSON = args.has('--json');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);

function log(...parts) {
    if (!AS_JSON) console.log(...parts);
}

async function main() {
    const keys = await kv.keys('save:*');
    // Clan blobs and the admin content slots share the prefix but are not players.
    const names = keys.map((key) => key.slice('save:'.length)).filter(isPlayerSaveName);
    const targets = LIMIT > 0 ? names.slice(0, LIMIT) : names;
    log(`[ledger-audit] ${targets.length} player save(s)${REPAIR ? ' — repair enabled' : ''}`);

    const summary = {
        total: targets.length,
        match: 0, lagging: 0, missing: 0, legacy: 0, orphan: 0, ahead: 0, 'lagging-different': 0, divergent: 0,
        skipped: 0, repaired: 0, repairFailed: 0,
    };
    const divergences = [];

    for (const name of targets) {
        const record = await kv.get(`save:${name}`);
        if (!record || typeof record !== 'object' || !record.character) { summary.skipped += 1; continue; }

        const ledger = await readCurrencyLedger(name);
        const status = classifyCurrencyLedger(record, ledger);
        summary[status] += 1;

        if (status === 'divergent') {
            const fields = CURRENCY_LEDGER_FIELDS
                .map((field) => ({ field, save: Number(record.character[field] ?? 0), ledger: Number(ledger?.balances?.[field] ?? 0) }))
                .filter((entry) => entry.save !== entry.ledger);
            divergences.push({ name, version: record._saveVersion, fields });
            log(`[ledger-audit] DIVERGENT ${name} @v${record._saveVersion}:`,
                fields.map((f) => `${f.field} save=${f.save} ledger=${f.ledger}`).join(', '));
        }

        if (REPAIR && status !== 'match' && status !== 'lagging') {
            try {
                const outcome = await reconcileCurrencyLedger(name);
                if (outcome.action === 'written') summary.repaired += 1;
                else if (outcome.action !== 'none') log(`[ledger-audit] ${name}: ${outcome.status} → ${outcome.action}`);
            } catch (error) {
                summary.repairFailed += 1;
                log(`[ledger-audit] repair of ${name} failed: ${error?.message ?? error}`);
            }
        }
    }

    if (AS_JSON) {
        console.log(JSON.stringify({ ...summary, divergences }, null, 2));
    } else {
        log('[ledger-audit] summary:', JSON.stringify(summary));
        if (divergences.length === 0) log('[ledger-audit] no divergence — every ledger row agrees with its save at the version it shares.');
    }
    return divergences.length === 0 ? 0 : 1;
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        if (String(error?.message ?? '').includes('SUPABASE_URL')) {
            console.error('[ledger-audit] no storage credentials in this environment.');
            console.error('[ledger-audit] Run it where the API runs (Railway shell), or export SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL.');
        } else {
            console.error('[ledger-audit] failed:', error);
        }
        process.exit(2);
    });
