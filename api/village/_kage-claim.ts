/*
 * Claiming a VACANT Kage seat (owner ruling 2026-08-22).
 *
 * An inactivity vacancy (_kage-inactivity.ts) — or any other path that leaves
 * an unlocked village with nobody seated — makes the seat claimable by any
 * villager who meets the same personal gates the challenge path requires
 * (canClaimVacantSeat: member, level, account age, Village Merit, cooldown).
 * First-come wins: the vacancy is re-checked under the kage-key lock the kage
 * endpoints use, so two simultaneous claims seat exactly one Kage. The new
 * reign opens via openReign and gets the normal post-install grace window.
 *
 * The KV/announce I/O lives here (not in kage.ts) so it is unit-testable with
 * the in-memory KV, the same way _kage-settle.ts is.
 */
import { kv } from '../_storage.js';
import { safeName } from '../_utils.js';
import { withKvLock } from '../_lock.js';
import { announce } from '../_announce.js';
import { canClaimVacantSeat, openReign, KAGE_POST_DEFENSE_GRACE_MS, type KageStateLike } from './_kage-challenge.js';
import { kageKey } from './_kage-settle.js';

export type ClaimSeatResult =
    | { ok: true; state: KageStateLike; seatedAt: number }
    | { ok: false; status: number; error: string };

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Seat `playerSlug` on the vacant seat of `village`. `isAdmin` skips the
 * membership/personal gates (admin install), never the vacancy check — an
 * admin who wants to replace a seated Kage uses the existing 'seat' action.
 */
export async function claimVacantKageSeat(village: string, playerSlug: string, now: number, opts: { isAdmin?: boolean } = {}): Promise<ClaimSeatResult> {
    const slug = safeName(playerSlug);
    const save = await kv.get<Record<string, unknown>>(`save:${slug}`);
    const char = (save?.character ?? null) as Record<string, unknown> | null;
    if (!char) return { ok: false, status: 404, error: 'Your save was not found.' };
    const displayName = String(char.name ?? slug);
    const key = kageKey(village);

    let seatedAt = 0;
    const result = await withKvLock<ClaimSeatResult>(key, async () => {
        const state = (await kv.get<KageStateLike>(key)) ?? { kageSystemUnlocked: false };
        const elig = canClaimVacantSeat({
            now, state, challengerName: displayName,
            challengerLevel: num(char.level),
            challengerAccountCreatedAt: num(char.createdAt),
            challengerMerit: num(char.villageMerit),
            isMember: !!opts.isAdmin || String(char.village ?? '').trim() === village.trim(),
        });
        if (!elig.ok) {
            // Admins skip the personal gates but never the unlock / vacancy check.
            const vacancyOnly = !state.kageSystemUnlocked || !!state.seatedKage;
            if (!opts.isAdmin || vacancyOnly) {
                return { ok: false, status: state.seatedKage ? 409 : 403, error: elig.reason };
            }
        }
        seatedAt = now;
        const next: KageStateLike = {
            ...openReign(state, displayName, village, now),
            firstLiberator: state.firstLiberator ?? displayName,
            challenge: null,
            postDefenseGraceUntil: now + KAGE_POST_DEFENSE_GRACE_MS,
        };
        await kv.set(key, next);
        return { ok: true, state: next, seatedAt };
    }, { failClosed: true });

    if (result.ok) {
        try {
            await announce({
                type: 'kage_claimed',
                importance: 'high',
                title: 'A New Kage Rises',
                message: `${displayName} has claimed the empty Kage seat of ${village}.`,
                player: displayName,
                village,
            }, { receiptId: `kage-claimed:${village}:${seatedAt}` });
        } catch { /* best-effort */ }
    }
    return result;
}
