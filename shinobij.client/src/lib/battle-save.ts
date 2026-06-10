import type { Character } from "../types/character";
import type { CreatorAi } from "../types/creator-ai";

// Story-boss resume persistence (mirrors the arena persister; 1h TTL).
export const STORY_BOSS_SAVE_TTL_MS = 60 * 60 * 1000;
export function storyBossSaveKey(name: string): string { return `storyBoss.battle.v1.${name}`; }

// ── Battle lock (server-side refresh-flee guard) ─────────────────────────
// A PvE fight registers a server-side lock (api/battle/lock.ts) on start and
// clears it on end. On boot the app reads the lock and forces re-entry, so a
// refresh — or a wiped localStorage — can't escape an unresolved fight. The
// battle STATE still lives client-side (ArenaBattlePersister); the lock only
// makes the fight un-skippable. Resume-only: nothing is paid or punished here,
// except the deliberate cleared-localStorage case, which the boot path resolves
// as a loss (see applySnapshot).
export const BATTLE_LOCK_ID_KEY = "battleLock.activeId.v1";
// Set when a fight ENDS (alongside the resolve call) and cleared once boot
// consumes it. It distinguishes "fight ended, but the network resolve didn't
// land" (marker present → retry clear, never re-punish) from "localStorage was
// wiped mid-fight" (marker gone → the cleared-state loss). Lives in the same
// localStorage that a wipe destroys, which is exactly what makes the distinction
// work — a winner whose resolve failed keeps the marker and is not penalized.
export const BATTLE_LOCK_RESOLVED_KEY = "battleLock.resolvedId.v1";

// Endless-tower context persistence. The COMBAT state (HP/turn) is saved by
// ArenaBattlePersister like any arena fight; what's lost on refresh is the
// endless WAVE + flag + the scaled enemy (App state). We persist just those so
// the boot path can rebuild the endless fight (the enemy itself resolves from
// the already-saved pendingAiProfileId once the scaled clone is back in the AI
// pool). 1h TTL to match the combat persister.
const ENDLESS_CTX_TTL_MS = 60 * 60 * 1000;
type EndlessContext = { wave: number; aiId: string; ai: CreatorAi; savedAt: number };
export function endlessCtxKey(name: string): string { return `endless.context.v1.${name}`; }
export function readEndlessContext(name: string): EndlessContext | null {
    try {
        const raw = localStorage.getItem(endlessCtxKey(name));
        if (!raw) return null;
        const ctx = JSON.parse(raw) as EndlessContext;
        if (Date.now() - (ctx.savedAt ?? 0) > ENDLESS_CTX_TTL_MS) return null;
        return ctx?.ai ? ctx : null;
    } catch { return null; }
}

// Arena "story" context persistence. Covers EVERY pendingArenaStoryBattle fight
// (weekly boss, dungeon-AI warden, arena story boss, triggered-event battle,
// hollow-gate arena fight) — they all fight on screen "arena" with the combat
// snapshot saved by ArenaBattlePersister; what's lost on refresh is the
// pendingArenaStoryBattle context + the scaled enemy. Persist just those (images
// stripped) so the boot path rebuilds the fight. 1h TTL.
const ARENA_STORY_CTX_TTL_MS = 60 * 60 * 1000;
type ArenaStoryContext = { battle: unknown; aiId: string; ai: CreatorAi | null; savedAt: number };
export function arenaStoryCtxKey(name: string): string { return `arenaStory.context.v1.${name}`; }
export function readArenaStoryContext(name: string): ArenaStoryContext | null {
    try {
        const raw = localStorage.getItem(arenaStoryCtxKey(name));
        if (!raw) return null;
        const ctx = JSON.parse(raw) as ArenaStoryContext;
        if (Date.now() - (ctx.savedAt ?? 0) > ARENA_STORY_CTX_TTL_MS) return null;
        return ctx?.battle ? ctx : null;
    } catch { return null; }
}

export type ClientBattleLock = { battleId: string; kind: string; screen: string; startedAt: number; meta?: Record<string, unknown> };

export function mintBattleId(): string {
    try {
        if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    } catch { /* fall through to the non-crypto id */ }
    return `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
}

// Best-effort POST to the battle-lock endpoint. Never throws and never blocks
// combat — a failed lock call just means the (already client-resolved) fight
// isn't server-guarded that one time, which is strictly no worse than before.
export async function postBattleLock(body: Record<string, unknown>): Promise<{ ok?: boolean; lock?: ClientBattleLock | null; alreadyLocked?: boolean } | null> {
    try {
        const res = await fetch("/api/battle/lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

export async function fetchBattleLockStatus(playerName: string): Promise<ClientBattleLock | null> {
    const data = await postBattleLock({ action: "status", playerName });
    return data?.lock ?? null;
}

// True when the client can actually resume the locked fight from local state —
// must agree with what the screen's persister will accept on mount (same key,
// TTL, and signature), so "resume exists" ⟺ "the fight really rehydrates". A
// kind with no persister returns false → the boot cleared-state path handles it.
export function battleResumeStateExists(lock: ClientBattleLock, playerName: string, character: Character | null): boolean {
    try {
        if (lock.kind === "arena") {
            const raw = localStorage.getItem(`arena.battle.v3.${playerName}`);
            if (!raw) return false;
            const saved = JSON.parse(raw) as { battleStarted?: boolean; savedAt?: number };
            return Boolean(saved?.battleStarted) && (Date.now() - (saved.savedAt ?? 0)) <= ARENA_SAVE_TTL_MS;
        }
        if (lock.kind === "storyBoss") {
            const raw = localStorage.getItem(storyBossSaveKey(playerName));
            if (!raw) return false;
            const saved = JSON.parse(raw) as { storyProgress?: number; savedAt?: number; bossHp?: number; playerHp?: number };
            if ((Date.now() - (saved.savedAt ?? 0)) > STORY_BOSS_SAVE_TTL_MS) return false;
            // Signature: same chapter the save was taken for, and the fight is
            // genuinely unfinished. (storyProgress only advances on a win, which
            // clears the save, so a mismatch means a stale/foreign save.)
            if (character && saved.storyProgress !== character.storyProgress) return false;
            return (saved.bossHp ?? 0) > 0 && (saved.playerHp ?? 0) > 0;
        }
        if (lock.kind === "endless") {
            // Needs BOTH the endless app-context (wave + scaled enemy) AND the
            // arena combat snapshot — the fight runs on screen "arena".
            if (!readEndlessContext(playerName)) return false;
            const raw = localStorage.getItem(`arena.battle.v3.${playerName}`);
            if (!raw) return false;
            const saved = JSON.parse(raw) as { battleStarted?: boolean; savedAt?: number };
            return Boolean(saved?.battleStarted) && (Date.now() - (saved.savedAt ?? 0)) <= ARENA_SAVE_TTL_MS;
        }
        if (lock.kind === "arenaStory") {
            // Same as endless: needs the pendingArenaStoryBattle context AND the
            // arena combat snapshot.
            if (!readArenaStoryContext(playerName)) return false;
            const raw = localStorage.getItem(`arena.battle.v3.${playerName}`);
            if (!raw) return false;
            const saved = JSON.parse(raw) as { battleStarted?: boolean; savedAt?: number };
            return Boolean(saved?.battleStarted) && (Date.now() - (saved.savedAt ?? 0)) <= ARENA_SAVE_TTL_MS;
        }
        if (lock.kind === "hollowGateTiles") {
            // Hollow-gate tile seal: the run is server-saved (survives a wipe), so
            // "resumable" just means an active run still exists — re-entry starts a
            // fresh seal (the board isn't persisted). If the run is gone the seal is
            // moot, so it falls to the (no-op) cleared-state path.
            return Boolean(character?.hollowGateRun && !character.hollowGateRun.completed);
        }
    } catch { return false; }
    return false;
}

export const ARENA_SAVE_TTL_MS = 60 * 60 * 1000;     // 1hr
