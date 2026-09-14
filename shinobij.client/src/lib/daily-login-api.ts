/*
 * Client wrapper for the server-authoritative daily login-streak claim.
 * Auth rides the global authFetch interceptor, so a bare /api fetch is signed.
 */
import type { Character, VersionedCharacterCommit } from "../types/character";

export type DailyLoginCommitFactory = (accountName: string) => Promise<{
    signal: AbortSignal;
    isCurrent: () => boolean;
    commit: VersionedCharacterCommit;
}>;

export interface DailyLoginResult {
    ok: boolean;
    alreadyClaimed: boolean;
    streak: number;
    granted: { ryo: number; fateShards: number };
    balances: { ryo: number; fateShards: number };
    shardInterval: number;
    daysUntilShardBonus: number;
    character: Character;
    _saveVersion: number;
}

export async function claimDailyLogin(
    playerName: string,
    beginDailyLogin: DailyLoginCommitFactory,
    isCurrent: () => boolean,
): Promise<DailyLoginResult | null> {
    const scope = await beginDailyLogin(playerName).catch(() => null);
    if (!scope || !scope.isCurrent() || !isCurrent()) return null;
    const controller = new AbortController();
    const abort = () => controller.abort();
    scope.signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, 15_000);
    try {
        const r = await fetch("/api/player/daily-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
            signal: controller.signal,
        });
        if (!r.ok) return null;
        const data = (await r.json()) as DailyLoginResult;
        if (data?.ok !== true || !Number.isSafeInteger(data._saveVersion) || data._saveVersion <= 0
            || !scope.isCurrent() || !isCurrent() || controller.signal.aborted) return null;
        // An older API returns only balances and a receipt. Recover its complete
        // saved character before publishing the version to any subsequent save.
        if (!data.character) {
            const read = await fetch(`/api/save/${encodeURIComponent(playerName)}`, { signal: controller.signal });
            if (!read.ok) return null;
            const saved = await read.json() as { character?: Character; _saveVersion?: number };
            if (!Number.isSafeInteger(saved._saveVersion) || Number(saved._saveVersion) < data._saveVersion) return null;
            data.character = saved.character as Character;
            data._saveVersion = Number(saved._saveVersion);
        }
        if (!scope.isCurrent() || !isCurrent() || controller.signal.aborted ||
            typeof data.character?.name !== "string" ||
            data.character.name.trim().toLowerCase() !== playerName.trim().toLowerCase()) return null;
        // A lost response retries with alreadyClaimed=true and zero grant. Its
        // stored balance and receipt still have to reach the next autosave.
        // Keep the version attached to that character, including on retries.
        return scope.commit(data.character, data._saveVersion) ? data : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
        scope.signal.removeEventListener("abort", abort);
    }
}
