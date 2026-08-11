/*
 * Staging integrity certification and additive side-car backfill.
 *
 * Safe defaults:
 *   npm run scan:data                                  # local/read-only
 *   npm run scan:data -- --target=staging             # staging/read-only
 *
 * A staging repair needs all three independent acknowledgements below:
 *   SHINOBIX_DEPLOYMENT_TIER=staging
 *   ALLOW_STAGING_INTEGRITY_REPAIR=1
 *   --repair --target=staging --confirm-additive-repair=ADD_SIDE_CARS_ONLY
 *
 * Production is intentionally unsupported. Repair creates missing forged-item
 * records and advances missing/stale currency projections under the save lock.
 * It never edits a save, authors content, or overwrites a conflict.
 */
import { loadProjectEnv } from './_load-env.mjs';
import { assertIntegrityInvocation, redactMaintenanceError } from './lib/maintenance-guards.mjs';
import {
    FindingReport,
    definitionsEqual,
    scanScope,
    strictLedgerCompatibilityReasons,
    subjectLabel,
} from './lib/data-integrity-scan-core.mjs';

await loadProjectEnv();

const rawArgs = process.argv.slice(2);
const argv = new Set(rawArgs);
let config;
try {
    config = assertIntegrityInvocation(rawArgs, process.env);
} catch (error) {
    console.error('[scan] refused:', String(error?.message ?? 'invalid maintenance target'));
    process.exit(2);
}
const REPAIR = config.repair;
const AS_JSON = argv.has('--json');
const INCLUDE_IDENTIFIERS = argv.has('--include-identifiers');
const limitRaw = rawArgs.find((arg) => arg.startsWith('--limit='))?.split('=')[1] ?? '0';
const LIMIT = Number(limitRaw);
if (!Number.isSafeInteger(LIMIT) || LIMIT < 0) {
    console.error('[scan] refused: --limit must be a non-negative safe integer.');
    process.exit(2);
}

const [
    { kv, closeStoragePool },
    { withKvLock },
    { ITEM_CATALOG },
    { loadAdminItemObjects },
    { FORGED_ITEM_ID, forgedItemKey },
    { compareLedger, projectBalances, readCurrencyLedger, syncCurrencyLedger },
    { CONTENT_FIELDS, normalizeContentValue, readContentRecord },
    { STAT_CAP_FIELDS },
] = await Promise.all([
    import('../api/_storage.js'),
    import('../api/_lock.js'),
    import('../api/pvp/_item-catalog.js'),
    import('../api/_admin-item-catalog.js'),
    import('../api/_forged-item-registry.js'),
    import('../api/_currency-ledger.js'),
    import('../api/_content-store.js'),
    import('../api/combat-core/formulas.js'),
]);

const CATEGORIES = [
    'danglingEquipment',
    'forgedNotRegistered',
    'forgedRegistryConflict',
    'unownedEquipment',
    'duplicatePets',
    'missingSaveVersion',
    'impossibleBalance',
    'ledgerDivergent',
    'ledgerAhead',
    'ledgerMissingOrStale',
    'contentNotPublished',
    'contentDivergent',
    'strictLedgerCompatibility',
];

const CUTOVER_BLOCKERS = [
    'forgedNotRegistered',
    'forgedRegistryConflict',
    'ledgerDivergent',
    'ledgerAhead',
    'ledgerMissingOrStale',
    'contentNotPublished',
    'contentDivergent',
    'strictLedgerCompatibility',
    'missingSaveVersion',
];

const report = new FindingReport(CATEGORIES);
const observed = {
    forgedNotRegistered: 0,
    ledgerMissingOrStale: 0,
    contentNotPublished: 0,
};
const repaired = {
    forgedRegistered: 0,
    ledgersWritten: 0,
};
const registryCache = new Map();

const log = (...parts) => { if (!AS_JSON) console.log(...parts); };
const subject = (name) => subjectLabel(name, INCLUDE_IDENTIFIERS);

function ownedIds(char) {
    const owned = new Set();
    for (const id of Array.isArray(char.inventory) ? char.inventory : []) {
        if (typeof id === 'string' && id.trim()) owned.add(id.trim());
    }
    for (const stack of Array.isArray(char.itemStacks) ? char.itemStacks : []) {
        const id = stack && typeof stack === 'object' ? String(stack.itemId ?? '').trim() : '';
        if (id && Number(stack.count) > 0) owned.add(id);
    }
    return owned;
}

function validRegistryDefinition(id, value) {
    return Boolean(
        value
        && typeof value === 'object'
        && typeof value.id === 'string'
        && value.id.toLowerCase() === id.toLowerCase()
        && FORGED_ITEM_ID.test(value.id),
    );
}

async function readForgedRegistry(id, refresh = false) {
    const normalized = id.toLowerCase();
    if (!refresh && registryCache.has(normalized)) return registryCache.get(normalized);
    const value = await kv.get(forgedItemKey(id));
    registryCache.set(normalized, value);
    return value;
}

async function ensureForgedDefinition(name, item) {
    const id = String(item.id ?? '');
    let registered = await readForgedRegistry(id);
    if (registered) {
        if (!validRegistryDefinition(id, registered) || !definitionsEqual(item, registered)) {
            report.add('forgedRegistryConflict', { subject: subject(name), id });
        }
        return;
    }

    observed.forgedNotRegistered += 1;
    if (REPAIR) {
        const wrote = await kv.set(forgedItemKey(id), item, { nx: true });
        registered = await readForgedRegistry(id, true);
        if (validRegistryDefinition(id, registered) && definitionsEqual(item, registered)) {
            if (wrote === 'OK') repaired.forgedRegistered += 1;
            return;
        }
        if (registered) {
            report.add('forgedRegistryConflict', { subject: subject(name), id });
            return;
        }
    }
    report.add('forgedNotRegistered', { subject: subject(name), id });
}

async function repairCurrencyProjection(name, freshRecord) {
    if (!freshRecord || typeof freshRecord !== 'object' || !freshRecord.character) {
        return { status: 'missing-save' };
    }
    let freshLedger = await readCurrencyLedger(name);
    const freshVersion = Math.max(0, Number(freshRecord._saveVersion) || 0);
    if (freshLedger && Number(freshLedger.saveVersion) > freshVersion) {
        return { status: 'ahead', recordVersion: freshVersion, ledgerVersion: Number(freshLedger.saveVersion) };
    }
    let freshComparison = compareLedger(freshRecord, freshLedger);
    if (freshComparison.status === 'match' || freshComparison.status === 'divergent') return freshComparison;
    if (Object.keys(projectBalances(freshRecord.character)).length === 0) return freshComparison;
    await syncCurrencyLedger(name, freshRecord);
    freshLedger = await readCurrencyLedger(name);
    freshComparison = compareLedger(freshRecord, freshLedger);
    if (freshComparison.status === 'match' && Number(freshLedger?.saveVersion) === freshVersion) {
        return { status: 'match', repaired: true };
    }
    return freshComparison;
}

async function scanSave(name, record, adminItems) {
    const char = record?.character;
    if (!char || typeof char !== 'object') return false;
    const who = subject(name);

    if (record._saveVersion === undefined || record._saveVersion === null) {
        report.add('missingSaveVersion', { subject: who });
    }

    for (const reason of strictLedgerCompatibilityReasons(record, STAT_CAP_FIELDS)) {
        if (reason.reason === 'missing-stat-ledger-fields') {
            report.add('strictLedgerCompatibility', { subject: who, ...reason });
        }
    }

    for (const field of ['ryo', 'bankRyo', 'fateShards', 'boneCharms', 'auraStones', 'auraDust', 'mythicSeals', 'honorSeals', 'hollowShards']) {
        const raw = char[field];
        if (raw === undefined) continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) {
            report.add('impossibleBalance', { subject: who, field, valueCategory: Number.isFinite(value) ? 'negative' : 'non-numeric' });
        }
    }

    const creatorItems = Array.isArray(record.creatorItems) ? record.creatorItems : [];
    const ownItemIds = new Set(
        creatorItems
            .map((item) => item && typeof item === 'object' ? String(item.id ?? '') : '')
            .filter(Boolean),
    );
    for (const item of creatorItems) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id ?? '');
        if (FORGED_ITEM_ID.test(id)) await ensureForgedDefinition(name, item);
    }

    const held = ownedIds(char);
    const equipment = char.equipment && typeof char.equipment === 'object' ? char.equipment : {};
    for (const [slot, rawId] of Object.entries(equipment)) {
        const id = typeof rawId === 'string' ? rawId.trim() : '';
        if (!id) continue;
        let registryDefinition = null;
        if (FORGED_ITEM_ID.test(id) && !ownItemIds.has(id)) registryDefinition = await readForgedRegistry(id);
        const registryResolvable = validRegistryDefinition(id, registryDefinition);
        const resolvable = Boolean(ITEM_CATALOG[id]) || adminItems.has(id) || ownItemIds.has(id) || registryResolvable;
        if (!resolvable) {
            report.add('danglingEquipment', { subject: who, slot, id, forged: FORGED_ITEM_ID.test(id) });
        }
        if (!held.has(id) && !ownItemIds.has(id) && !registryResolvable) {
            report.add('unownedEquipment', { subject: who, slot, id });
        }
    }

    const pets = Array.isArray(char.pets) ? char.pets : [];
    const petIds = new Set();
    for (const pet of pets) {
        const id = pet && typeof pet === 'object' ? String(pet.id ?? '') : '';
        if (!id) continue;
        if (petIds.has(id)) report.add('duplicatePets', { subject: who, id });
        petIds.add(id);
    }

    let ledger = await readCurrencyLedger(name);
    const recordVersion = Math.max(0, Number(record._saveVersion) || 0);
    if (ledger && Number(ledger.saveVersion) > recordVersion) {
        report.add('ledgerAhead', {
            subject: who,
            recordVersion,
            ledgerVersion: Number(ledger.saveVersion),
        });
        return true;
    }

    let comparison = compareLedger(record, ledger);
    if (comparison.status === 'divergent') {
        report.add('ledgerDivergent', { subject: who, version: comparison.version, fields: comparison.fields });
    } else if (comparison.status !== 'match') {
        observed.ledgerMissingOrStale += 1;
        if (REPAIR) {
            // REPAIR mode holds lock:save:<name> around the first save read and
            // this projection write (see main). Do not nest the same lock here.
            const outcome = await repairCurrencyProjection(name, record);
            if (outcome.status === 'match') {
                if (outcome.repaired) repaired.ledgersWritten += 1;
                return true;
            }
            if (outcome.status === 'divergent') {
                report.add('ledgerDivergent', { subject: who, version: outcome.version, fields: outcome.fields });
                return true;
            }
            if (outcome.status === 'ahead') {
                report.add('ledgerAhead', {
                    subject: who,
                    recordVersion: outcome.recordVersion,
                    ledgerVersion: outcome.ledgerVersion,
                });
                return true;
            }
            if (outcome.status === 'missing-save') return false;
            comparison = outcome;
        }
        report.add('ledgerMissingOrStale', { subject: who, status: comparison.status });
    }
    return true;
}

async function scanContentStore() {
    const slots = await Promise.all([kv.get('save:admin1'), kv.get('save:admin2')]);
    for (const field of CONTENT_FIELDS) {
        let value;
        let found = false;
        for (const slot of slots) {
            if (slot && typeof slot === 'object' && Object.prototype.hasOwnProperty.call(slot, field)) {
                value = slot[field];
                found = true;
            }
        }
        if (!found) continue;

        const expected = normalizeContentValue(field, value);
        let published = await readContentRecord(field);
        if (!published) {
            observed.contentNotPublished += 1;
            report.add('contentNotPublished', { field });
            continue;
        }
        if (!definitionsEqual(published.value, expected)) {
            report.add('contentDivergent', { field, canonicalVersion: Number(published.version) || 0 });
        }
    }
}

function redactError(error) {
    return redactMaintenanceError(error, {
        includeIdentifiers: INCLUDE_IDENTIFIERS,
        sensitiveValues: [
            process.env.DATABASE_URL,
            process.env.SUPABASE_POSTGRES_URL,
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_ROLE_KEY,
            process.env.KV_PROXY_URL,
            process.env.KV_PROXY_TOKEN,
        ],
        maxLength: 500,
    });
}

async function main() {
    const keys = (await kv.keys('save:*'))
        .filter((key) => !key.startsWith('save:clan-'))
        .sort((left, right) => left.localeCompare(right));
    const scope = scanScope(keys.length, LIMIT);
    const targets = keys.slice(0, scope.selected);
    log(`[scan] target=${config.target} mode=${REPAIR ? 'STAGING ADDITIVE REPAIR' : 'READ ONLY'} saves=${targets.length}`);
    if (!scope.completeScan) {
        log(`[scan] NON-CERTIFYING SAMPLE - selected=${scope.selected} available=${scope.available} requested-limit=${scope.limit}.`);
    }
    if (!INCLUDE_IDENTIFIERS) log('[scan] player identifiers are pseudonymized; use --include-identifiers only in a restricted operator shell.');

    // Certification data must be complete. Treat a catalog/storage outage as a
    // failed scan instead of silently converting every admin-authored item into
    // a dangling-equipment false positive.
    const adminItems = await loadAdminItemObjects();
    if (REPAIR && targets.some((key) => key === 'save:admin1' || key === 'save:admin2')) {
        // loadAdminItemObjects necessarily reads both admin saves. Let that
        // read-cache entry expire before taking each save lock so the repair's
        // first in-lock read cannot reuse the catalog snapshot.
        log('[scan] settling the admin-slot read cache before locked repair reads.');
        await new Promise((resolve) => setTimeout(resolve, 10_250));
    }
    let scanned = 0;
    let skipped = 0;
    for (const key of targets) {
        const name = key.slice('save:'.length);
        const scanOne = async () => {
            const record = await kv.get(key);
            return record ? scanSave(name, record, adminItems) : false;
        };
        // Acquire before the FIRST player-save read so the process cache cannot
        // turn the repair into a projection of an older snapshot. This is also
        // what keeps forged backfill and ledger advancement consistent with one
        // authoritative save version.
        const didScan = REPAIR
            ? await withKvLock(key, scanOne, { failClosed: true, ttlSec: 30 })
            : await scanOne();
        if (!didScan) {
            skipped += 1;
            continue;
        }
        scanned += 1;
        if (!AS_JSON && scanned % 250 === 0) log(`[scan] processed ${scanned}/${targets.length}`);
    }
    await scanContentStore();

    const result = {
        target: config.target,
        mode: REPAIR ? 'staging-additive-repair' : 'read-only',
        identifiers: INCLUDE_IDENTIFIERS ? 'included' : 'pseudonymized',
        strictRawSaveLedgerEnabled: process.env.STRICT_RAW_SAVE_LEDGER === '1',
        available: scope.available,
        limit: scope.limit,
        completeScan: scope.completeScan,
        scanned,
        skipped,
        counts: report.counts,
        samples: report.samples,
        observed,
        repaired,
    };

    if (AS_JSON) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        const labels = {
            danglingEquipment: 'equipped gear has no resolvable definition',
            forgedNotRegistered: 'forged definition is absent from the durable registry',
            forgedRegistryConflict: 'forged save definition conflicts with the registry',
            unownedEquipment: 'equipped gear has no ownership evidence',
            duplicatePets: 'duplicate pet ids exist within one save',
            missingSaveVersion: 'save has no optimistic-concurrency version',
            impossibleBalance: 'balance is negative or non-numeric',
            ledgerDivergent: 'currency ledger differs at the same save version',
            ledgerAhead: 'currency ledger is ahead of its authoritative save',
            ledgerMissingOrStale: 'currency ledger is missing or behind',
            contentNotPublished: 'admin-authored content is absent from the canonical store',
            contentDivergent: 'canonical content differs from the winning admin slot',
            strictLedgerCompatibility: 'save still depends on a legacy strict-ledger compatibility shape',
        };
        log(`\n[scan] scanned=${scanned} skipped=${skipped}`);
        for (const category of CATEGORIES) {
            const count = report.counts[category];
            log(`[${count === 0 ? ' ok ' : 'FIND'}] ${String(count).padStart(7)}  ${labels[category]}`);
            for (const sample of report.samples[category].slice(0, 3)) log(`         e.g. ${JSON.stringify(sample)}`);
        }
        log(`\n[scan] observed repairable: ${JSON.stringify(observed)}`);
        if (REPAIR) log(`[scan] verified additive repairs: ${JSON.stringify(repaired)}`);
        const blockers = report.total(CUTOVER_BLOCKERS);
        const total = report.total();
        if (total === 0 && scope.completeScan) {
            log('[scan] CLEAN - no unresolved findings in this target.');
        } else if (total === 0) {
            log('[scan] CLEAN SAMPLE ONLY - no findings in the selected records; this partial run cannot certify cutover.');
        } else {
            const suffix = scope.completeScan ? '' : ' This partial run cannot certify cutover.';
            log(`[scan] unresolved=${total}; cutover-blockers=${blockers}. No conflicting record was overwritten.${suffix}`);
        }
    }
    return report.total() === 0 && scope.completeScan ? 0 : 1;
}

main()
    .then(async (code) => {
        await closeStoragePool().catch(() => undefined);
        process.exit(code);
    })
    .catch(async (error) => {
        await closeStoragePool().catch(() => undefined);
        const message = redactError(error);
        if (/SUPABASE_URL|DATABASE_URL|storage credentials/i.test(message)) {
            console.error('[scan] no usable storage credentials were found for the acknowledged target.');
        } else {
            console.error('[scan] failed:', message);
        }
        process.exit(2);
    });
