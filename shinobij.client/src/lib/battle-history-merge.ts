/*
 * Reconcile the DURABLE server battle list with the legacy save-embedded
 * `character.battleHistory`.
 *
 * Both exist for good reasons and neither can be dropped yet:
 *   • the server index is authoritative for PvP and survives session expiry,
 *     a browser refresh, and signing in elsewhere;
 *   • the save copy still carries local PvE fights, which have no receipts.
 *
 * When both describe the same fight the SERVER row wins — the client copy is
 * derived from a capped live log and can be stale or truncated.
 */
import type { BattleHistoryEntry } from "../types/character";
import type { BattleHistorySummary } from "../types/battle-log";

export type MergedBattleRow =
    | { kind: "server"; battleId: string; ts: number; summary: BattleHistorySummary }
    | { kind: "legacy"; battleId: string | null; ts: number; entry: BattleHistoryEntry };

/**
 * The battleId a legacy save row refers to, if any. Older PvE entries have only
 * a local `id`, which is NOT a battleId and must not be matched against one.
 *
 * PvP rows carry theirs in the id itself: PvpBattleScreen records them as
 * `pvp-<battleId>` (there is no `battleId` field on BattleHistoryEntry). Reading
 * that prefix is what makes the dedupe actually fire — without it EVERY finished
 * PvP fight renders twice, once from the durable server index and once from the
 * save copy. Deriving it also fixes records ALREADY sitting in players' saves,
 * which adding a new field could not.
 */
export function legacyBattleId(entry: BattleHistoryEntry): string | null {
    const record = entry as unknown as Record<string, unknown>;
    // Prefer an explicit field if a future producer starts writing one.
    const explicit = record.battleId;
    if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
    const id = String(entry?.id ?? "").trim();
    if (id.startsWith("pvp-") && id.length > 4) return id.slice(4);
    return null;
}

/**
 * Merge both sources into one newest-first list, deduped by battleId.
 * A legacy row without a battleId can never collide, so local PvE history is
 * always preserved.
 */
export function mergeBattleHistory(
    server: BattleHistorySummary[],
    legacy: BattleHistoryEntry[],
): MergedBattleRow[] {
    const rows: MergedBattleRow[] = [];
    const claimed = new Set<string>();

    for (const s of server) {
        if (!s?.battleId || claimed.has(s.battleId)) continue;
        claimed.add(s.battleId);
        rows.push({ kind: "server", battleId: s.battleId, ts: Number(s.endedAt) || 0, summary: s });
    }

    for (const e of legacy) {
        if (!e) continue;
        const bid = legacyBattleId(e);
        // Server row already covers this fight — skip the weaker client copy.
        if (bid && claimed.has(bid)) continue;
        if (bid) claimed.add(bid);
        rows.push({ kind: "legacy", battleId: bid, ts: Number(e.ts) || 0, entry: e });
    }

    return rows.sort((a, b) => b.ts - a.ts);
}
