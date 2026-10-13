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

/**
 * Why a claim did or did not land. `stale` means the account, save scope or
 * requester moved on mid-claim, so nobody is waiting to hear about it. `failed`
 * covers everything the player should be told about (offline, refused, timed
 * out, or a reply that could not be applied); a retry is always safe because
 * the server answers a repeat claim from its receipt.
 */
export type DailyLoginOutcome =
    | { status: "claimed"; result: DailyLoginResult }
    | { status: "stale" }
    | { status: "failed" };

const STALE: DailyLoginOutcome = { status: "stale" };
const FAILED: DailyLoginOutcome = { status: "failed" };

export async function claimDailyLoginOutcome(
    playerName: string,
    beginDailyLogin: DailyLoginCommitFactory,
    isCurrent: () => boolean,
): Promise<DailyLoginOutcome> {
    const scope = await beginDailyLogin(playerName).catch(() => null);
    if (!scope) return FAILED;
    if (!scope.isCurrent() || !isCurrent()) return STALE;
    const controller = new AbortController();
    const abort = () => controller.abort();
    scope.signal.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort(); }, 15_000);
    // Retired by its owner rather than by the timeout.
    const stale = () => !scope.isCurrent() || !isCurrent() || (controller.signal.aborted && !timedOut);
    const unapplied = () => stale() ? STALE : FAILED;
    try {
        const r = await fetch("/api/player/daily-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerName }),
            signal: controller.signal,
        });
        if (!r.ok) return unapplied();
        const data = (await r.json()) as DailyLoginResult;
        if (data?.ok !== true || !Number.isSafeInteger(data._saveVersion) || data._saveVersion <= 0
            || !scope.isCurrent() || !isCurrent() || controller.signal.aborted) return unapplied();
        // An older API returns only balances and a receipt. Recover its complete
        // saved character before publishing the version to any subsequent save.
        if (!data.character) {
            const read = await fetch(`/api/save/${encodeURIComponent(playerName)}`, { signal: controller.signal });
            if (!read.ok) return unapplied();
            const saved = await read.json() as { character?: Character; _saveVersion?: number };
            if (!Number.isSafeInteger(saved._saveVersion) || Number(saved._saveVersion) < data._saveVersion) return unapplied();
            data.character = saved.character as Character;
            data._saveVersion = Number(saved._saveVersion);
        }
        if (!scope.isCurrent() || !isCurrent() || controller.signal.aborted ||
            typeof data.character?.name !== "string" ||
            data.character.name.trim().toLowerCase() !== playerName.trim().toLowerCase()) return unapplied();
        // A lost response retries with alreadyClaimed=true and zero grant. Its
        // stored balance and receipt still have to reach the next autosave.
        // Keep the version attached to that character, including on retries.
        return scope.commit(data.character, data._saveVersion) ? { status: "claimed", result: data } : unapplied();
    } catch {
        return unapplied();
    } finally {
        clearTimeout(timeout);
        scope.signal.removeEventListener("abort", abort);
    }
}

/** The claimed result, or null for any outcome that did not land. */
export async function claimDailyLogin(
    playerName: string,
    beginDailyLogin: DailyLoginCommitFactory,
    isCurrent: () => boolean,
): Promise<DailyLoginResult | null> {
    const outcome = await claimDailyLoginOutcome(playerName, beginDailyLogin, isCurrent);
    return outcome.status === "claimed" ? outcome.result : null;
}
