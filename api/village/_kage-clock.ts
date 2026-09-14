import { isDeepStrictEqual } from 'node:util';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { sessionOpponentBlock } from '../_realtime/presence-gating.js';
import { isPlayerOnline } from '../_realtime/_presence-beat.js';
import { invalidateProcCache } from '../_proc-cache.js';
import { WAR_VILLAGES } from '../_war-map-sectors.js';
import { leadershipVillageKey } from '../../shared/village-anbu.js';
import { applyPress, applySeatTransfer, applyChallengerForfeit, type KageStateLike } from './_kage-challenge.js';
import { announceKageDethroned, kageKey } from './_kage-settle.js';

/** One clock authority for the scheduler, board reads, and protected actions. */
export async function advanceKageChallengeClock(village: string, now = Date.now()) {
    const key = kageKey(village);
    const snapshot = await kv.get<KageStateLike>(key);
    if (!snapshot?.challenge || snapshot.challenge.status === 'accepted') return { state: snapshot, bothOnline: false };
    const result = await withKvLock(key, async () => {
        const raw = await kv.get<KageStateLike>(key);
        const challenge = raw?.challenge;
        if (!raw || !challenge || challenge.status === 'accepted') return { state: raw, bothOnline: false };
        const [kageOnline, challengerOnline, kageSave, challengerSave] = await Promise.all([
            isPlayerOnline(raw.seatedKage), isPlayerOnline(challenge.challenger),
            kv.get<{ character?: { village?: string } }>(`save:${safeName(raw.seatedKage ?? '')}`),
            kv.get<{ character?: { village?: string } }>(`save:${safeName(challenge.challenger)}`),
        ]);
        const member = (save: typeof kageSave) => !!save?.character
            && leadershipVillageKey(save.character.village) === leadershipVillageKey(village);
        const bothOnline = kageOnline && challengerOnline && member(kageSave) && member(challengerSave);
        // The second acceptance creates a real PvP session. Never charge the
        // challenger while that session would be refused because the Kage is busy.
        const kageUnavailable = challenge.kageAcceptedAt !== undefined
            && !!sessionOpponentBlock(onlineStore.get(raw.seatedKage ?? ''), safeName(challenge.challenger), now);
        const tick = applyPress(challenge, now, bothOnline && !kageUnavailable);
        tick.challenge.clockPauseReason = !bothOnline ? 'offline' : kageUnavailable ? 'kage-unavailable' : undefined;
        const next: KageStateLike = JSON.parse(JSON.stringify(tick.forfeitedBy === 'kage'
            ? applySeatTransfer(raw, challenge.challenger, village, now, 'forfeit')
            : tick.forfeitedBy === 'challenger' ? applyChallengerForfeit(raw, now)
                : { ...raw, challenge: tick.challenge }));
        if (!isDeepStrictEqual(raw, next)) {
            try {
                if (!await kv.compareSet(key, raw, next)) throw new Error('kage-clock-publication-conflict');
            } catch (error) {
                if (!isDeepStrictEqual(await kv.get(key).catch(() => null), next)) throw error;
            }
            invalidateProcCache('game-state:frame');
        }
        return { state: next, bothOnline, forfeitedBy: tick.forfeitedBy,
            ...(tick.forfeitedBy === 'kage' ? { announcement: {
                village, challenger: challenge.challenger, oldKage: String(raw.seatedKage),
                receiptId: `kage-dethroned:${village}:forfeit:${challenge.challengeId}`,
                meta: { challengeId: challenge.challengeId, how: 'forfeit' },
            } } : {}) };
    }, { failClosed: true });
    if ('announcement' in result && result.announcement) await announceKageDethroned(result.announcement);
    return result;
}

/** Frequent, bounded server sampling; no open Town Hall or client press required. */
export async function runKageChallengeClocks(now = Date.now()): Promise<void> {
    const results = await Promise.allSettled(WAR_VILLAGES.map(village => advanceKageChallengeClock(village, now)));
    results.forEach((result, index) => {
        if (result.status === 'rejected') console.warn('[kage-clock]', WAR_VILLAGES[index], String(result.reason));
    });
}
