import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { KAGE_LIBERATOR_TITLES } from '../_titles-registry.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { announce, postVillageHerald, addHallEntry } from '../_announce.js';
import { applyKageUnlock, type KageUnlockState } from './_kage-unlock.js';
import { openReign, closeCurrentReign, applyAdminReset, type KageStateLike } from './_kage-challenge.js';
import { reconcilePendingKageSettle } from './_kage-settle.js';

type VillageKageState = KageUnlockState & Partial<KageStateLike>;

function kageKey(village: string) {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Finale consequences for a VERIFIED liberator (rebuild §10): the village's
 * liberator title goes into the server-owned serverTitles vault (the save
 * sanitizer re-injects it; the registry marks it wearable), plus world
 * reactions — a village herald for every liberator, and a world announcement
 * + permanent Hall of Legends entry for the FIRST liberation only. Entirely
 * best-effort: a failure here never blocks the unlock response, and the vault
 * write is idempotent (already-granted returns without side effects).
 */
async function grantLiberatorReward(playerName: string, villageName: string, freshUnlock: boolean): Promise<{ character: Record<string, unknown>; _saveVersion: number } | undefined> {
    const title = KAGE_LIBERATOR_TITLES[villageName.trim().toLowerCase()];
    if (!title || !playerName) return undefined;
    let mutationResult: { character: Record<string, unknown>; _saveVersion: number; granted: boolean } | undefined;
    try {
        const mutation = await mutatePlayerSave<boolean>(playerName, ({ character }) => {
            const vault = Array.isArray(character.serverTitles)
                ? (character.serverTitles as unknown[]).filter((t): t is string => typeof t === 'string')
                : [];
            if (vault.includes(title)) return { ok: true, character, value: false, write: false };
            return {
                ok: true,
                value: true,
                character: { ...character, serverTitles: [...vault, title], storyTitle: title, rankTitle: title },
            };
        });
        if (mutation.ok) mutationResult = { character: mutation.character, _saveVersion: mutation._saveVersion, granted: mutation.value };
    } catch { /* best-effort — the next unlock call re-grants */ }
    if (!mutationResult) return undefined;
    if (!mutationResult.granted) return { character: mutationResult.character, _saveVersion: mutationResult._saveVersion };
    try {
        await postVillageHerald(villageName, 'A Kage Falls', `${playerName} has broken the false Kage's hold over ${villageName}. The seat stands open.`);
    } catch { /* best-effort */ }
    if (freshUnlock) {
        try {
            await announce({ type: 'kage_liberation', importance: 'high', title: 'A Village Breathes', message: `${playerName} is the first to topple the false Kage of ${villageName}.`, player: playerName, village: villageName });
            await addHallEntry(
                { entryType: 'kage_liberation', title: `First Liberation of ${villageName}`, description: `${playerName} broke the Hollow Gate pact and opened the Kage seat.`, player: playerName, village: villageName },
                { nxKey: `kage-first-liberation:${villageName.toLowerCase().replace(/\s+/g, '-')}` },
            );
        } catch { /* best-effort */ }
    }
    return { character: mutationResult.character, _saveVersion: mutationResult._saveVersion };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const village = typeof req.query.village === 'string' ? req.query.village.trim() : '';

    if (req.method === 'GET') {
        try {
            if (!village) return res.status(400).json({ error: 'Missing village.' });
            // Self-heal a stuck auto-settle from the durable record before reading.
            // This is the main reconcile trigger: every client polls this GET (~12s)
            // in every challenge state, incl. ACCEPTED_DUEL (where the challenger's
            // press loop is idle). Best-effort; the response reflects the result.
            await reconcilePendingKageSettle(village, Date.now()).catch(() => undefined);
            const state = await kv.get<VillageKageState>(kageKey(village)) ?? { kageSystemUnlocked: false };
            res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
            return res.status(200).json(state);
        } catch (err) {
            console.error('[village/kage]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'POST') {
        // All Kage mutations require authentication.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        // Tight per-player cap — legitimate kage actions are once-in-a-while.
        // Admins skip (admin reset scripts may legitimately fire many fast).
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-kage', 10, 60_000, identity.name))) return;

        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { village: bodyVillage, playerName, action } = body as {
                village?: string;
                playerName?: string;
                action?: 'unlock' | 'seat' | 'reset';
            };
            const v = (bodyVillage ?? '').trim() || village;
            if (!v || !playerName) return res.status(400).json({ error: 'Missing village or playerName.' });

            // Players may only act as themselves (or admin can act for anyone).
            if (!identity.admin && identity.name !== safeName(playerName)) {
                return res.status(403).json({ error: 'Cannot perform Kage actions as another player.' });
            }

            const key = kageKey(v);

            // ── Server-side requirement gate (unlock) ─────────────────────────
            // Verified BEFORE the village lock so it also covers the
            // already-unlocked path: EVERY legitimate finale caller earns the
            // liberator title (server-owned serverTitles vault), not only the
            // first player to ever unlock the village.
            let liberatorVerified = false;
            if (action === 'unlock' && !identity.admin) {
                const save = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                const char = (save as Record<string, unknown> | null)?.character as Record<string, unknown> | undefined;
                if (!char) return res.status(400).json({ error: 'Character save not found.' });
                const level = Number(char.level ?? 0);
                const storyProgress = Number(char.storyProgress ?? 0);
                // The kage finale story step is the level-100 boss fight (the 9th
                // milestone at index 8). After defeating it the client increments
                // storyProgress to 9. Level must also be ≥ 100.
                if (level < 100) {
                    return res.status(403).json({ error: `Must be level 100 to unlock the Kage system (current: ${level}).` });
                }
                if (storyProgress < 9) {
                    return res.status(403).json({ error: `Must complete the village story to unlock the Kage system (progress: ${storyProgress}/9).` });
                }
                liberatorVerified = true;
            }
            let freshUnlock = false;

            // The unlock/seat/reset mutations are read-modify-writes on a shared,
            // permission-bearing key (the seated Kage authorizes village-treasury
            // transfers, and `firstLiberator` is permanent). Without a lock, two
            // players racing the once-per-village `unlock` both read
            // `kageSystemUnlocked:false`, both pass, and last-writer-wins can seat
            // the race loser + brand the wrong firstLiberator. Wrap the whole
            // read-check-write under the kage-key lock and re-read inside it so
            // the second writer observes the first's commit. failClosed: a KV
            // hiccup aborts (caller retries) rather than racing this state.
            const result = await withKvLock<{ status: number; body: unknown }>(key, async () => {
                const current = await kv.get<VillageKageState>(key) ?? { kageSystemUnlocked: false };
                const now = Date.now();

                if (action === 'unlock') {
                    // The requirement gate ran before the lock (liberatorVerified);
                    // admins skip it. First clear seats + brands firstLiberator,
                    // exactly once; later clears change nothing here (test-locked
                    // in _kage-unlock.test.ts). On a fresh unlock we also OPEN the
                    // first liberator's reign in the server-owned history.
                    const outcome = applyKageUnlock(current, playerName, now);
                    if (outcome.freshUnlock) {
                        const withReign = openReign(outcome.next as KageStateLike, playerName, v, now);
                        await kv.set(key, withReign);
                        freshUnlock = true;
                        return { status: 200, body: withReign };
                    }
                    return { status: 200, body: outcome.next };
                }

                if (action === 'reset') {
                    // Admin-only: reset the Kage system back to NPC / sealed state.
                    // Closes the current reign ('admin-reset') but preserves the
                    // permanent history so the record survives across eras.
                    if (!identity.admin) {
                        return { status: 403, body: { error: 'Only admins can reset the Kage system.' } };
                    }
                    const next = applyAdminReset(current as KageStateLike, v, now);
                    await kv.set(key, next);
                    return { status: 200, body: next };
                }

                if (action === 'seat') {
                    if (!current.kageSystemUnlocked) {
                        return { status: 400, body: { error: 'Kage system not unlocked for this village.' } };
                    }
                    // Only the current seated Kage or an admin may install a new Kage.
                    const currentKage = safeName(current.seatedKage ?? '');
                    if (!identity.admin && identity.name !== currentKage) {
                        return { status: 403, body: { error: 'Only the seated Kage or admin can change the Kage.' } };
                    }

                    // Verify the candidate actually belongs to this village. Stops the
                    // seated Kage from installing someone from a different village.
                    const candidateNorm = safeName(playerName);
                    if (!identity.admin) {
                        try {
                            const candSave = await kv.get<Record<string, unknown>>(`save:${candidateNorm}`);
                            const candChar = (candSave?.character ?? null) as Record<string, unknown> | null;
                            if (!candChar) {
                                return { status: 400, body: { error: 'Candidate save not found.' } };
                            }
                            const candVillage = (candChar.village as string | undefined) ?? '';
                            if (candVillage.trim() !== v.trim()) {
                                return { status: 403, body: { error: 'Candidate is not a member of this village.' } };
                            }
                        } catch {
                            return { status: 500, body: { error: 'Unable to verify candidate.' } };
                        }
                    }

                    // firstLiberator gate: once a firstLiberator exists, only they
                    // (or the seated Kage who chose to step down) can be re-seated
                    // when the seat is empty. We accept the seated-Kage path above
                    // and ensure that admin / seated Kage actions still proceed
                    // here; the firstLiberator is preserved in the next-state.
                    const seatChanged = safeName(current.seatedKage ?? '') !== safeName(playerName);
                    let next: KageStateLike = {
                        ...(current as KageStateLike),
                        seatedKage: playerName,
                        firstLiberator: current.firstLiberator ?? playerName,
                    };
                    if (seatChanged) {
                        // Seat handed to a different player (admin install / step-down):
                        // close the outgoing reign and open the new one so the
                        // permanent record reflects the transition.
                        const closed = current.seatedKage ? closeCurrentReign(current as KageStateLike, v, now, 'abdicated') : (current as KageStateLike);
                        next = { ...openReign(closed, playerName, v, now), firstLiberator: current.firstLiberator ?? playerName };
                    }
                    await kv.set(key, next);
                    return { status: 200, body: next };
                }

                return { status: 400, body: { error: 'Invalid action.' } };
            }, { failClosed: true });

            // Liberator consequences (rebuild §10): title into the server-owned
            // vault + world reactions. Best-effort AFTER the kage lock (separate
            // save-key lock inside mutatePlayerSave; never nested).
            const liberatorSave = action === 'unlock' && liberatorVerified && result.status === 200
                ? await grantLiberatorReward(safeName(playerName), v, freshUnlock)
                : undefined;

            return res.status(result.status).json({
                ...(result.body as Record<string, unknown>),
                ...(liberatorSave ?? {}),
            });
        } catch (err) {
            console.error('[village/kage]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
