/*
 * Currency-ledger audit and backfill (P0-5).
 *
 * The ledger at `ledger:currency:<name>` is a projection of the nine currency
 * balances in each player's save blob (api/_currency-ledger.ts). The blob is
 * authoritative; this tool answers the question a read cutover depends on:
 * does the projection agree with the blob everywhere?
 *
 *   node --import tsx scripts/currency-ledger-audit.mjs            # read-only audit
 *   node --import tsx scripts/currency-ledger-audit.mjs --backfill # also write missing/stale rows
 *   node --import tsx scripts/currency-ledger-audit.mjs --json     # machine-readable summary
 *
 * Read-only by default, and even --backfill only ever writes `ledger:` keys —
 * player saves are never modified by this script.
 *
 * Exit codes: 0 = no divergence, 1 = at least one DIVERGENT record (same
 * save version, different balances), which is a real bug and blocks cutover.
 */
import { kv } from '../api/_storage.js';
import { compareLedger, syncCurrencyLedger, readCurrencyLedger } from '../api/_currency-ledger.js';

const args = new Set(process.argv.slice(2));
const BACKFILL = args.has('--backfill');
const AS_JSON = args.has('--json');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);

function log(...parts) {
    if (!AS_JSON) console.log(...parts);
}

async function main() {
    const keys = await kv.keys('save:*');
    // Clan blobs share the prefix but carry no character.
    const saveKeys = keys.filter((key) => !key.startsWith('save:clan-'));
    const targets = LIMIT > 0 ? saveKeys.slice(0, LIMIT) : saveKeys;
    log(`[ledger-audit] ${targets.length} player save(s)${BACKFILL ? ' — backfill enabled' : ''}`);

    const summary = { total: targets.length, match: 0, stale: 0, missing: 0, divergent: 0, skipped: 0, backfilled: 0 };
    const divergences = [];

    for (const key of targets) {
        const name = key.slice('save:'.length);
        const record = await kv.get(key);
        if (!record || typeof record !== 'object' || !record.character) { summary.skipped += 1; continue; }

        const ledger = await readCurrencyLedger(name);
        const result = compareLedger(record, ledger);
        summary[result.status] += 1;

        if (result.status === 'divergent') {
            divergences.push({ name, version: result.version, fields: result.fields });
            // A divergence is never "fixed" by overwriting it — that would hide
            // the bug. Report it; the blob stays authoritative meanwhile.
            log(`[ledger-audit] DIVERGENT ${name} @v${result.version}:`,
                result.fields.map((f) => `${f.field} blob=${f.blob} ledger=${f.ledger}`).join(', '));
            continue;
        }

        if (BACKFILL && (result.status === 'missing' || result.status === 'stale')) {
            const written = await syncCurrencyLedger(name, record);
            if (written) summary.backfilled += 1;
        }
    }

    if (AS_JSON) {
        console.log(JSON.stringify({ ...summary, divergences }, null, 2));
    } else {
        log('[ledger-audit] summary:', JSON.stringify(summary));
        if (divergences.length === 0) log('[ledger-audit] no divergence — the projection agrees with every blob it has seen.');
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
