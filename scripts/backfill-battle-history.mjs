#!/usr/bin/env node
// Backfill the per-player battle-history index from retained BattleReceipts.
//
// The index (receipt:history:<safeName>) is written when a battle resolves, so
// battles that finished BEFORE it shipped have a durable receipt but no index
// row — they're invisible in Profile → Battles even though the evidence is still
// in storage for 90 days. This one-off pass reads the retained receipts and
// writes the missing index entries.
//
// MANUAL ONLY. Nothing on a request path scans `receipt:battle:*` — that scan is
// exactly what must never happen while a player is waiting on a response.
//
//   node --import tsx scripts/backfill-battle-history.mjs --dry-run
//   node --import tsx scripts/backfill-battle-history.mjs
//
// Flags:
//   --dry-run        report what WOULD change, write nothing
//   --batch=<n>      receipts per mget chunk (default 100)
//   --limit=<n>      stop after n receipts (default: all)
//
// Safe to re-run: mergeHistoryEntry dedupes by battleId, so a second pass is a
// no-op rather than a duplicate.

import { kv } from '../api/_storage.js';
import { withKvLock } from '../api/_lock.js';
import { safeName } from '../api/_utils.js';
import {
    buildHistorySummary,
    mergeHistoryEntry,
    historyKey,
    RECEIPT_TTL_SEC,
} from '../api/_receipts.js';

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(`--${name}`);
const numFlag = (name, fallback) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    if (!hit) return fallback;
    const n = Number(hit.split('=')[1]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

const dryRun = hasFlag('dry-run');
const batchSize = numFlag('batch', 100);
const limit = numFlag('limit', Infinity);

const stats = { scanned: 0, indexed: 0, skipped: 0, malformed: 0, failed: 0 };

// Group every summary a player gained in this run, so each player's index is
// read + written ONCE at the end instead of once per battle.
/** @type {Map<string, import('../api/_receipts.js').BattleHistorySummary[]>} */
const pending = new Map();

function stage(safePlayer, summary) {
    if (!safePlayer) return;
    const list = pending.get(safePlayer) ?? [];
    list.push(summary);
    pending.set(safePlayer, list);
}

async function main() {
    console.log(`[backfill] mode=${dryRun ? 'DRY RUN' : 'WRITE'} batch=${batchSize} limit=${limit === Infinity ? 'all' : limit}`);

    const keys = await kv.keys('receipt:battle:*');
    console.log(`[backfill] found ${keys.length} retained battle receipt(s)`);
    const work = keys.slice(0, limit === Infinity ? keys.length : limit);

    // Chunked mget — never one kv.get per receipt.
    for (let i = 0; i < work.length; i += batchSize) {
        const chunk = work.slice(i, i + batchSize);
        let values = [];
        try {
            values = await kv.mget(...chunk);
        } catch (err) {
            stats.failed += chunk.length;
            console.error(`[backfill] mget failed for chunk at ${i}:`, err);
            continue;
        }
        for (const receipt of values) {
            stats.scanned++;
            if (!receipt || typeof receipt !== 'object' || !receipt.battleId) { stats.malformed++; continue; }
            const p1 = safeName(String(receipt.p1?.name ?? ''));
            const p2 = safeName(String(receipt.p2?.name ?? ''));
            if (!p1 && !p2) { stats.malformed++; continue; }
            if (p1) stage(p1, buildHistorySummary(receipt, 'p1'));
            if (p2) stage(p2, buildHistorySummary(receipt, 'p2'));
        }
        console.log(`[backfill] scanned ${Math.min(i + batchSize, work.length)}/${work.length}`);
    }

    // One locked read-modify-write per PLAYER, not per battle.
    for (const [player, summaries] of pending) {
        try {
            const key = historyKey(player);
            const existing = (await kv.get(key)) ?? [];
            const existingIds = new Set((Array.isArray(existing) ? existing : []).map((e) => e?.battleId));
            let next = Array.isArray(existing) ? existing : [];
            let added = 0;
            for (const s of summaries) {
                if (existingIds.has(s.battleId)) { stats.skipped++; continue; }
                next = mergeHistoryEntry(next, s);
                existingIds.add(s.battleId);
                added++;
            }
            if (!added) continue;
            if (!dryRun) {
                await withKvLock(key, async () => {
                    // Re-read inside the lock so a live battle resolving mid-run
                    // isn't clobbered by this backfill's stale snapshot.
                    const fresh = (await kv.get(key)) ?? [];
                    let merged = Array.isArray(fresh) ? fresh : [];
                    for (const s of summaries) merged = mergeHistoryEntry(merged, s);
                    await kv.set(key, merged, { ex: RECEIPT_TTL_SEC });
                });
            }
            stats.indexed += added;
            console.log(`[backfill] ${dryRun ? 'would index' : 'indexed'} ${added} battle(s) for ${player}`);
        } catch (err) {
            stats.failed++;
            console.error(`[backfill] index write failed for ${player}:`, err);
        }
    }

    console.log('[backfill] done:', JSON.stringify(stats));
    console.log(`[backfill] players touched: ${pending.size}`);
    if (dryRun) console.log('[backfill] DRY RUN — nothing was written.');
}

main().then(
    () => process.exit(stats.failed > 0 ? 1 : 0),
    (err) => { console.error('[backfill] fatal:', err); process.exit(1); },
);
