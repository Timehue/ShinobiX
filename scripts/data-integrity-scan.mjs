/*
 * Live-data integrity scanner and backfiller (P1-4).
 *
 * Every Phase 0 audit ended with the same sentence: "REQUIRES LIVE-DATA
 * VERIFICATION". This is that verification. It walks every player save and
 * answers, with counts instead of assumptions:
 *
 *   • is any equipped item a dangling reference? (the named-weapon loss class)
 *   • is any forged weapon missing from the durable registry? (blocks the
 *     STRICT_RAW_SAVE_LEDGER flip — flipping without this DELETES that gear)
 *   • has any authored content never reached the canonical content store?
 *     (blocks the shared-content slot freeze)
 *   • does any currency ledger disagree with its save? (blocks the currency
 *     read cutover)
 *   • duplicate pets, unowned equipment, missing save versions, impossible
 *     balances?
 *
 *   npm run scan:data              # read-only report
 *   npm run scan:data -- --repair  # additionally perform the SAFE backfills
 *   npm run scan:data -- --json    # machine-readable
 *
 * READ-ONLY by default. --repair only ever writes ADDITIVE side-car records
 * (forged-item registry, currency ledger, content store). It never edits a
 * player save, and it never "fixes" a divergence by overwriting it — a
 * divergence is a bug to investigate, not to paper over.
 *
 * Exit 0 = clean, 1 = findings that block a cutover, 2 = the scan itself failed.
 */
import { kv } from '../api/_storage.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { loadAdminItemObjects } from '../api/_admin-item-catalog.js';
import { FORGED_ITEM_ID, forgedItemKey, recordForgedItem } from '../api/_forged-item-registry.js';
import { compareLedger, syncCurrencyLedger, readCurrencyLedger } from '../api/_currency-ledger.js';
import { CONTENT_FIELDS, readContentRecord, publishContent } from '../api/_content-store.js';

const argv = new Set(process.argv.slice(2));
const REPAIR = argv.has('--repair');
const AS_JSON = argv.has('--json');
const LIMIT = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0);

const log = (...p) => { if (!AS_JSON) console.log(...p); };

/** Findings that must be empty before the matching cutover is safe to flip. */
const findings = {
    danglingEquipment: [],      // equipped id resolves to no definition anywhere
    forgedNotRegistered: [],    // forged gear whose definition is only in the save
    unownedEquipment: [],       // equipped id the player does not hold
    duplicatePets: [],
    missingSaveVersion: [],     // would be rejected 426 on next save
    impossibleBalance: [],      // negative / NaN currency
    ledgerDivergent: [],        // same version, different balances — a real bug
    ledgerMissingOrStale: [],
    contentNotPublished: [],    // authored content absent from the canonical store
};
const repaired = { forgedRegistered: 0, ledgersWritten: 0, contentPublished: 0 };

const push = (bucket, entry) => { if (findings[bucket].length < 200) findings[bucket].push(entry); };

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

async function scanSave(name, record, adminItems) {
    const char = record?.character;
    if (!char || typeof char !== 'object') return;

    if (record._saveVersion === undefined) push('missingSaveVersion', { name });

    // ── Currency sanity ─────────────────────────────────────────────────────
    for (const field of ['ryo', 'bankRyo', 'fateShards', 'boneCharms', 'auraStones', 'auraDust', 'mythicSeals', 'honorSeals', 'hollowShards']) {
        const raw = char[field];
        if (raw === undefined) continue;
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) push('impossibleBalance', { name, field, value: raw });
    }

    // ── Equipment references ────────────────────────────────────────────────
    const creatorItems = Array.isArray(record.creatorItems) ? record.creatorItems : [];
    const ownItemIds = new Set(creatorItems.map((i) => (i && typeof i === 'object' ? String(i.id ?? '') : '')).filter(Boolean));
    const held = ownedIds(char);
    const equipment = char.equipment && typeof char.equipment === 'object' ? char.equipment : {};
    for (const [slot, rawId] of Object.entries(equipment)) {
        const id = typeof rawId === 'string' ? rawId.trim() : '';
        if (!id) continue;
        const resolvable = Boolean(ITEM_CATALOG[id]) || adminItems.has(id) || ownItemIds.has(id);
        if (!resolvable) {
            // The exact shape of "my weapon does nothing in fights".
            push('danglingEquipment', { name, slot, id, forged: FORGED_ITEM_ID.test(id) });
        }
        if (!held.has(id) && !ownItemIds.has(id)) push('unownedEquipment', { name, slot, id });
    }

    // ── Forged gear: is the definition durable yet? ──────────────────────────
    for (const item of creatorItems) {
        if (!item || typeof item !== 'object') continue;
        const id = String(item.id ?? '');
        if (!FORGED_ITEM_ID.test(id)) continue;
        const registered = await kv.get(forgedItemKey(id)).catch(() => null);
        if (!registered) {
            push('forgedNotRegistered', { name, id });
            if (REPAIR) { await recordForgedItem(item); repaired.forgedRegistered += 1; }
        }
    }

    // ── Pets ────────────────────────────────────────────────────────────────
    const pets = Array.isArray(char.pets) ? char.pets : [];
    const petIds = new Set();
    for (const pet of pets) {
        const id = pet && typeof pet === 'object' ? String(pet.id ?? '') : '';
        if (!id) continue;
        if (petIds.has(id)) push('duplicatePets', { name, id });
        petIds.add(id);
    }

    // ── Currency ledger ─────────────────────────────────────────────────────
    const ledger = await readCurrencyLedger(name).catch(() => null);
    const comparison = compareLedger(record, ledger);
    if (comparison.status === 'divergent') {
        push('ledgerDivergent', { name, version: comparison.version, fields: comparison.fields });
    } else if (comparison.status !== 'match') {
        push('ledgerMissingOrStale', { name, status: comparison.status });
        if (REPAIR) { if (await syncCurrencyLedger(name, record)) repaired.ledgersWritten += 1; }
    }
}

async function scanContentStore() {
    const slots = await Promise.all([kv.get('save:admin1'), kv.get('save:admin2')]);
    for (const field of CONTENT_FIELDS) {
        const inSlots = slots.some((slot) => slot && typeof slot === 'object' && slot[field] !== undefined);
        if (!inSlots) continue;
        const published = await readContentRecord(field).catch(() => null);
        if (published) continue;
        findings.contentNotPublished.push({ field });
        if (REPAIR) {
            // Later slot wins, matching the catalogs' merge order.
            const value = slots.reduce((acc, slot) => (slot && slot[field] !== undefined ? slot[field] : acc), undefined);
            if (value !== undefined) {
                await publishContent(field, value, { actor: 'integrity-scan-backfill' });
                repaired.contentPublished += 1;
            }
        }
    }
}

async function main() {
    const keys = await kv.keys('save:*');
    const playerKeys = keys.filter((k) => !k.startsWith('save:clan-'));
    const targets = LIMIT > 0 ? playerKeys.slice(0, LIMIT) : playerKeys;
    log(`[scan] ${targets.length} player save(s)${REPAIR ? ' — REPAIR enabled (additive side-cars only)' : ' — read-only'}`);

    const adminItems = await loadAdminItemObjects().catch(() => new Map());
    let scanned = 0;
    for (const key of targets) {
        const name = key.slice('save:'.length);
        const record = await kv.get(key).catch(() => null);
        if (!record) continue;
        await scanSave(name, record, adminItems);
        scanned += 1;
        if (!AS_JSON && scanned % 250 === 0) log(`[scan]   …${scanned}/${targets.length}`);
    }
    await scanContentStore();

    const counts = Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, v.length]));
    if (AS_JSON) {
        console.log(JSON.stringify({ scanned, counts, findings, repaired }, null, 2));
    } else {
        log(`\n[scan] scanned ${scanned} saves\n`);
        const labels = {
            danglingEquipment: 'equipped gear with NO resolvable definition (drops from every fight)',
            forgedNotRegistered: 'forged gear not in the durable registry (BLOCKS strict-ledger flip)',
            unownedEquipment: 'equipped gear the player does not hold',
            duplicatePets: 'duplicate pet ids within one save',
            missingSaveVersion: 'saves with no version stamp (next save is rejected 426)',
            impossibleBalance: 'negative or non-numeric balances',
            ledgerDivergent: 'currency ledger DISAGREES at the same version (real bug)',
            ledgerMissingOrStale: 'currency ledger missing or behind (BLOCKS currency cutover)',
            contentNotPublished: 'authored content never published to the store (BLOCKS slot freeze)',
        };
        for (const [bucket, count] of Object.entries(counts)) {
            const mark = count === 0 ? ' ok ' : 'FIND';
            log(`[${mark}] ${String(count).padStart(6)}  ${labels[bucket]}`);
            for (const sample of findings[bucket].slice(0, 3)) log(`         e.g. ${JSON.stringify(sample)}`);
        }
        if (REPAIR) {
            log(`\n[scan] repaired: ${repaired.forgedRegistered} forged definitions, ${repaired.ledgersWritten} ledgers, ${repaired.contentPublished} content fields`);
        }
        const blockers = counts.forgedNotRegistered + counts.ledgerMissingOrStale + counts.contentNotPublished;
        const bugs = counts.ledgerDivergent + counts.danglingEquipment + counts.impossibleBalance;
        log('');
        if (bugs > 0) log(`[scan] ${bugs} record(s) need INVESTIGATION before launch.`);
        if (blockers > 0) log(`[scan] ${blockers} cutover blocker(s) — re-run with --repair, then re-scan.`);
        if (bugs === 0 && blockers === 0) log('[scan] CLEAN — no integrity findings; all three cutovers are unblocked.');
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return total === 0 ? 0 : 1;
}

main()
    .then((code) => process.exit(code))
    .catch((error) => {
        if (String(error?.message ?? '').includes('SUPABASE_URL')) {
            console.error('[scan] no storage credentials in this environment.');
            console.error('[scan] Run it where the API runs (Railway shell), or export SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL.');
        } else {
            console.error('[scan] failed:', error);
        }
        process.exit(2);
    });
