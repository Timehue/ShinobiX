import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { rankedLevelEligible, RANKED_LEVEL_WARNING } from '../../shared/ranked-eligibility.js';
import { tacticsPreset } from '../../shared/pet-tactics-roster.js';
import type { TacticsBuild } from '../../shared/pet-tactics-contract.js';
import { PET_ARENA_RANKED_CONTROL, PET_RANKED_ACTIVE_REGISTRY_KEY, PET_RANKED_AUTHORITY, PET_RANKED_QUEUE_KEY,
    petRankedResultKey, pruneRankedPetActiveRegistry, type RankedPetMatchToken } from '../pet/_ranked-authority.js';
import { petRatingOf } from '../pet/_ranked-eligibility.js';
import { resolveRankedPetDuel } from '../pet/_ranked-duel.js';
import { TacticsError, validateBuilds } from './engine.js';
import { advanceTacticsSession, createTacticsSession, joinTacticsSession, tacticsPlayerKey, tacticsRoomKey, TACTICS_SESSION_TTL_SECONDS, type TacticsSession } from './session.js';

const WAITING = 'pet:tactics:ranked:waiting';
const PENDING = 'pet:tactics:ranked:admission';
type Waiting = { name: string; rating: number; joinedAt: number; builds: TacticsBuild[] };
type Admission = { session: TacticsSession; token: RankedPetMatchToken };
export type RankedArenaStore = Pick<typeof kv, 'get' | 'set' | 'del' | 'delIfEqual'>;
export type RankedArenaDependencies = { store: RankedArenaStore; lock<T>(key: string, fn: () => Promise<T>): Promise<T>; now(): number;
    roomId(): string; matchToken(): string; seed(): number };
export const rankedArenaDependencies: RankedArenaDependencies = { store: kv,
    lock: (key, fn) => withKvLock(key, fn, { failClosed: true }), now: Date.now,
    roomId: () => randomBytes(4).toString('hex'), matchToken: randomUUID, seed: () => randomInt(1, 2 ** 31) };

/** Called while holding pet:tactics:admission. Durable intent repairs partial admission without resetting combat. */
export async function repairRankedArenaAdmission(store: RankedArenaStore): Promise<void> {
    const plan = await store.get<Admission>(PENDING);
    if (!plan) return;
    const { session, token } = plan;
    if (session.ranked?.matchToken !== token.pairId || token.roomId !== session.roomId || token.control !== PET_ARENA_RANKED_CONTROL) throw new Error('Invalid ranked arena admission.');
    const existing = await store.get<TacticsSession>(tacticsRoomKey(session.roomId));
    if (existing && existing.ranked?.matchToken !== session.ranked.matchToken) throw new Error('Ranked arena room collision.');
    if (!existing) await store.set(tacticsRoomKey(session.roomId), session);
    // No TTL before settlement: leaving or waiting out a reservation cannot dodge a loss.
    await store.set(`pet:ranked-token:${session.ranked.matchToken}`, token, { nx: true });
    await store.set(tacticsPlayerKey(token.a), session.roomId);
    await store.set(tacticsPlayerKey(token.b), session.roomId);
    const registry = pruneRankedPetActiveRegistry(await store.get(PET_RANKED_ACTIVE_REGISTRY_KEY));
    for (const name of [token.a, token.b]) registry[name] = { matchToken: session.ranked.matchToken, pairId: token.pairId,
        opponent: name === token.a ? token.b : token.a, initiator: name === token.a, createdAt: token.createdAt, expiresAt: token.createdAt + 2 * 60 * 60_000 };
    await store.set(PET_RANKED_ACTIVE_REGISTRY_KEY, registry, { ex: 24 * 60 * 60 });
    const waiting = await store.get<Waiting[]>(WAITING);
    if (Array.isArray(waiting)) await store.set(WAITING, waiting.filter(p => p.name !== token.a && p.name !== token.b), { ex: 60 * 60 });
    await store.del(PENDING);
}

const defaults = () => ['starter-fire', 'starter-water', 'starter-lightning', 'starter-earth'].map(id => tacticsPreset(id));
export function rankedArenaPairable(a: Waiting, b: Waiting, now: number): boolean {
    const gap = Math.abs(a.rating - b.rating);
    return a.name !== b.name && gap <= 150 + Math.max(0, now - a.joinedAt) / 1000 * 25
        && gap <= 150 + Math.max(0, now - b.joinedAt) / 1000 * 25;
}
/** All new ranked queue joins land here. There is no AI command or winner at admission. */
export async function rankedArenaQueue(name: string, action: string, body: Record<string, unknown>, deps = rankedArenaDependencies): Promise<Record<string, unknown>> {
    const { store } = deps;
    return deps.lock(PET_RANKED_QUEUE_KEY, () => deps.lock('pet:tactics:admission', async () => {
        await repairRankedArenaAdmission(store);
        const now = deps.now();
        const roomId = await store.get<string>(tacticsPlayerKey(name));
        const current = roomId ? await deps.lock(tacticsRoomKey(roomId), async () => {
            const session = await store.get<TacticsSession>(tacticsRoomKey(roomId));
            if (!session) return null;
            if (session.names.a !== name && session.names.b !== name) throw new TacticsError('Arena reservation does not name you.', 403);
            advanceTacticsSession(session, now); session.revision++;
            await store.set(tacticsRoomKey(roomId), session, session.ranked && !session.ranked.settled ? {} : { ex: TACTICS_SESSION_TTL_SECONDS });
            return session;
        }) : null;
        if (current?.ranked) {
            const receipt = await store.get(petRankedResultKey(current.ranked.matchToken));
            if (action === 'acknowledge' && body.matchToken === current.ranked.matchToken && current.phase === 'finished' && receipt) {
                await store.delIfEqual(tacticsPlayerKey(name), current.roomId);
            } else if (!(action === 'join' && current.phase === 'finished' && receipt)) {
                return { state: receipt ? 'completed' : 'active', matchToken: current.ranked.matchToken, roomId: current.roomId,
                    control: PET_ARENA_RANKED_CONTROL, opponent: name === current.names.a ? current.names.b : current.names.a, initiator: name === current.names.a };
            }
        } else if (current && current.phase !== 'finished' && action === 'join') throw new TacticsError('Finish your current Pet Arena battle before joining ranked.', 409);
        const raw = await store.get<Waiting[]>(WAITING);
        let waiting = Array.isArray(raw) ? raw.filter(p => p && typeof p.name === 'string' && Number.isFinite(p.rating)
            && p.joinedAt <= now && now - p.joinedAt < 3 * 60_000) : [];
        if (action === 'leave') waiting = waiting.filter(p => p.name !== name);
        if (action !== 'join') {
            await store.set(WAITING, waiting, { ex: 60 * 60 });
            const index = waiting.findIndex(p => p.name === name);
            return index < 0 ? { state: 'idle' } : { state: 'queued', queuePosition: index + 1, waiting: waiting.length, teamIds: waiting[index].builds.map(b => b.speciesId), control: PET_ARENA_RANKED_CONTROL };
        }
        const save = await store.get<Record<string, unknown>>(`save:${name}`);
        const character = save?.character as Record<string, unknown> | undefined;
        if (!character) throw new TacticsError('Your character save was not found.', 404);
        if (!rankedLevelEligible(character.level)) throw new TacticsError(RANKED_LEVEL_WARNING, 403);
        const registry = pruneRankedPetActiveRegistry(await store.get(PET_RANKED_ACTIVE_REGISTRY_KEY), now);
        if (registry[name]) throw new TacticsError('Finish your retained ranked result before joining a new match.', 409);
        const old = waiting.find(p => p.name === name);
        const own: Waiting = { name, rating: Math.max(0, Math.round(petRatingOf(save))), joinedAt: old?.joinedAt ?? now, builds: validateBuilds(body.builds ?? defaults()) };
        waiting = waiting.filter(p => p.name !== name).sort((a, b) => a.joinedAt - b.joinedAt);
        let opponent: Waiting | undefined;
        for (const candidate of waiting) {
            if (registry[candidate.name] || !rankedArenaPairable(own, candidate, now)) continue;
            const opponentSave = await store.get<Record<string, unknown>>(`save:${candidate.name}`);
            if (!rankedLevelEligible((opponentSave?.character as Record<string, unknown> | undefined)?.level)) continue;
            const pointer = await store.get<string>(tacticsPlayerKey(candidate.name));
            const candidateRoom = pointer ? await store.get<TacticsSession>(tacticsRoomKey(pointer)) : null;
            if (candidateRoom && (candidateRoom.phase !== 'finished' || candidateRoom.ranked && !await store.get(petRankedResultKey(candidateRoom.ranked.matchToken)))) continue;
            candidate.rating = Math.max(0, Math.round(petRatingOf(opponentSave)));
            if (rankedArenaPairable(own, candidate, now)) { opponent = candidate; break; }
        }
        if (!opponent) {
            await store.set(WAITING, [...waiting, own], { ex: 60 * 60 });
            return { state: 'queued', queuePosition: waiting.length + 1, waiting: waiting.length + 1, teamIds: own.builds.map(b => b.speciesId), control: PET_ARENA_RANKED_CONTROL };
        }
        const id = deps.roomId(), matchToken = deps.matchToken();
        if (await store.get(tacticsRoomKey(id))) throw new TacticsError('Arena room is busy. Retry matchmaking.', 503);
        const session = createTacticsSession(id, name, own.builds, deps.seed(), now);
        joinTacticsSession(session, opponent.name, opponent.builds, now);
        session.ranked = { matchToken, pairId: matchToken, aRating: own.rating, bRating: opponent.rating, settled: false };
        const snapshots = (seat: 'a' | 'b') => session.battle!.teams[seat].map(p => ({ id: p.id, templateId: p.speciesId, name: p.name, level: 50, rarity: p.rarity, element: p.element }));
        const aTeam = snapshots('a'), bTeam = snapshots('b');
        const token: RankedPetMatchToken = { authority: PET_RANKED_AUTHORITY, control: PET_ARENA_RANKED_CONTROL, roomId: id,
            pairId: matchToken, a: name, b: opponent.name, aRating: own.rating, bRating: opponent.rating,
            aPet: aTeam[0], bPet: bTeam[0], aTeam, bTeam, seed: session.seed, createdAt: now };
        await store.set(PENDING, { session, token } satisfies Admission);
        await repairRankedArenaAdmission(store);
        await store.set(WAITING, waiting.filter(p => p.name !== opponent!.name), { ex: 60 * 60 });
        return { state: 'active', matchToken, roomId: id, control: PET_ARENA_RANKED_CONTROL, opponent: opponent.name, initiator: true };
    }));
}

/** New tokens can settle only an actual server terminal; legacy receipts retain their sealed resolver. */
export async function rankedArenaWinner(token: RankedPetMatchToken, deps = rankedArenaDependencies): Promise<string | null> {
    if (!token.control) return resolveRankedPetDuel(token).winnerName;
    if (token.control !== PET_ARENA_RANKED_CONTROL || !token.roomId) throw new TacticsError('Unknown ranked combat authority.', 409);
    return deps.lock(tacticsRoomKey(token.roomId), async () => {
        const session = await deps.store.get<TacticsSession>(tacticsRoomKey(token.roomId!));
        if (!session || session.ranked?.pairId !== token.pairId || session.names.a !== token.a || session.names.b !== token.b
            || session.seed !== token.seed || session.ranked.aRating !== token.aRating || session.ranked.bRating !== token.bRating) throw new TacticsError('Ranked room does not match its sealed proof.', 409);
        advanceTacticsSession(session, deps.now()); session.revision++;
        await deps.store.set(tacticsRoomKey(session.roomId), session, session.ranked.settled ? { ex: TACTICS_SESSION_TTL_SECONDS } : {});
        if (session.phase !== 'finished' || !session.battle?.result) throw new TacticsError('Both players must finish the ranked battle before it can be rated.', 409);
        return session.battle.result === 'draw' ? null : session.battle.result === 'a' ? token.a : token.b;
    });
}

export async function retainSettledRankedArena(token: RankedPetMatchToken): Promise<void> {
    if (!token.control || !token.roomId) return;
    await withKvLock(tacticsRoomKey(token.roomId), async () => {
        const session = await kv.get<TacticsSession>(tacticsRoomKey(token.roomId!));
        if (session?.ranked?.pairId !== token.pairId) throw new Error('Ranked arena settlement room missing.');
        session.ranked.settled = true; session.revision++;
        await kv.set(tacticsRoomKey(session.roomId), session, { ex: TACTICS_SESSION_TTL_SECONDS });
    }, { failClosed: true });
}
