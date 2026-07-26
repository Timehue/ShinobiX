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
 */
export function legacyBattleId(entry: BattleHistoryEntry): string | null {
    const record = entry as unknown as Record<string, unknown>;
    const candidate = record.battleId;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
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
