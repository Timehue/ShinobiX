import type { VercelRequest, VercelResponse } from '../_vercel.js';
import crypto from 'node:crypto';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { kickPlayer } from '../_realtime/notify.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import { activeCarriedPets } from '../_entitlements.js';
import { parseWarfrontLadderPlan, WARFRONT_LADDER_RULES } from '../../shared/warfront-ladder-plan.js';
import {
    type Mode, type LadderEntry, type DefenseDoc, type OfferOpponent,
    petsForMode, DAILY_CHALLENGES, AI_SEED_COUNT, CLIMB_BAND,
    chooseOwnedLadderPets, hydrateLadderVisualIdentity, ladderRoles, petLite,
    buildOffer, canChallenge, applyChallenge, projectLadder,
    resolveColiseum, coliseumScript, resolveLadderWarfront, ladderWarfrontPlan, isAiId, aiIndexOf,
    aiColiseumDefense, aiTacticalDefense, AI_COLISEUM, AI_TACTICAL,
} from './_core.js';

/*
 * Global Pet Ladders — Pet Coliseum (1v1) + Beastbound Warfront (4v4). A Sword-x-Staff
 * style positional ladder (rank 1..N over real players) with OFFLINE defense:
 *   GET  ?mode=coliseum|tactical[&top=N]   → { ladder, you, notifications }
 *   POST { action:'defense', mode, petIds } → seal your defending pet/team (owned)
 *   POST { action:'offer',   mode }         → 3 close-above opponents (+ AI fill)
 *   POST { action:'challenge', mode, targetId } → server-authoritative fight + swap
 *   POST { action:'clearNotify' }           → clear your ladder notifications
 *
 * SERVER-AUTHORITATIVE: the winner is recomputed from a server-minted seed + the
 * sealed rosters via the ported deterministic engines (_core.resolve*). The client
 * gets the seed + sealed rosters back ONLY to replay the cinematic — never trusted.
 * No currency/XP is paid; the only stake is a leaderboard position.
 */

const asMode = (v: unknown): Mode | null => (v === 'coliseum' || v === 'tactical' ? v : null);
const orderKey = (mode: Mode) => `petladder:${mode}`;
const defKey = (mode: Mode, slug: string) => `petladder:${mode}:def:${safeName(slug)}`;
const notifyKey = (slug: string) => `petladder:notify:${safeName(slug)}`;
const dailyKey = (mode: Mode, slug: string, day: string) => `petladder:${mode}:daily:${safeName(slug)}:${day}`;
const lastKey = (mode: Mode, slug: string) => `petladder:${mode}:last:${safeName(slug)}`;   // last opponent fought → no back-to-back rematch
const dayStamp = () => new Date().toISOString().slice(0, 10);   // UTC yyyy-mm-dd
const MAX_LIST = 200;
const NOTIFY_TTL = 7 * 24 * 3600;
const LAST_TTL = 48 * 3600;
const TACTICAL_ROSTER_COPY = 'Beastbound Warfront needs 4 eligible pets. Base account: 5 carried. Shinobi Supporter: 6 carried.';

type LadderNotify = { from: string; mode: Mode; won: boolean; at: number };

function aiOfferSummary(mode: Mode, i: number): OfferOpponent {
    if (mode === 'tactical') { const t = AI_TACTICAL[i % AI_TACTICAL.length]; return { kind: 'ai', id: `ai:${i}`, name: t.name, rank: null, summary: t.pets.map(petLite) }; }
    const p = AI_COLISEUM[i % AI_COLISEUM.length];
    return { kind: 'ai', id: `ai:${i}`, name: p.name, rank: null, summary: [petLite(p)] };
}

export function defenseUsesCombatReadyPets(character: Record<string, unknown>, defense: DefenseDoc, expectedMode: Mode = defense.mode): boolean {
    const eligibleById = new Map(activeCarriedPets<Record<string, unknown>>(character)
        .map((pet) => [String(pet.id ?? ''), pet]));
    return defense.mode === expectedMode
        && defense.pets.length === petsForMode(expectedMode)
        && new Set(defense.pets.map((pet) => pet.id)).size === defense.pets.length
        && defense.pets.every((pet) => {
            const current = eligibleById.get(String(pet.id ?? ''));
            return Boolean(current && !petCombatBusyReason(character, current));
        });
}
const aiDefense = (mode: Mode, i: number): DefenseDoc => (mode === 'tactical' ? aiTacticalDefense(i) : aiColiseumDefense(i));

async function appendNotify(slug: string, ev: LadderNotify): Promise<void> {
    const key = notifyKey(slug);
    await withKvLock(key, async () => {
        const list = (await kv.get<LadderNotify[]>(key)) ?? [];
        await kv.set(key, [...list, ev].slice(-20), { ex: NOTIFY_TTL });
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // ── GET: ladder list + the viewer's standing ──────────────────────────────
    if (req.method === 'GET') {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const me = identity.admin ? safeName(String(req.query.name ?? '')) : identity.name;
        const mode = asMode(req.query.mode);
        if (!mode) return res.status(400).json({ error: 'Invalid mode.' });
        const topRaw = Number(req.query.top);
        const limit = Number.isInteger(topRaw) && topRaw > 0 && topRaw <= 100 ? topRaw : MAX_LIST;

        const order = (await kv.get<LadderEntry[]>(orderKey(mode))) ?? [];
        const myIdx = me ? order.findIndex((e) => e.slug === me) : -1;
        const myDef = me ? await kv.get<DefenseDoc>(defKey(mode, me)) : null;
        const usedToday = me ? Number((await kv.get<number>(dailyKey(mode, me, dayStamp()))) ?? 0) : 0;
        const notifications = me ? ((await kv.get<LadderNotify[]>(notifyKey(me))) ?? []) : [];

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            mode,
            total: order.length,
            ladder: projectLadder(order).slice(0, limit),
            you: {
                rank: myIdx >= 0 ? myIdx + 1 : null,
                record: myIdx >= 0 ? order[myIdx].record : null,
                hasDefense: !!myDef,
                defense: myDef ? myDef.pets.map(petLite) : null,
                defensePetIds: myDef?.pets.map((pet) => pet.id) ?? null,
                ...(mode === 'tactical' && myDef ? { warfrontPlan: ladderWarfrontPlan(myDef) } : {}),
                challengesLeft: Math.max(0, DAILY_CHALLENGES - usedToday),
                band: CLIMB_BAND,
            },
            notifications,
        });
    }

    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, action } = (body ?? {}) as { name?: string; action?: string };
        if (!name || !action) return res.status(400).json({ error: 'Missing name or action.' });

        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== safeName(name)) return res.status(403).json({ error: 'Cannot act as another player.' });
        const me = identity.admin ? safeName(name) : identity.name;
        const now = Date.now();

        if (action === 'clearNotify') {
            await kv.del(notifyKey(me));
            return res.status(200).json({ ok: true });
        }

        const mode = asMode((body as { mode?: unknown }).mode);
        if (!mode) return res.status(400).json({ error: 'Invalid mode.' });
        if (mode === 'tactical' && action === 'challenge' && body.warfrontRules !== WARFRONT_LADDER_RULES) {
            return res.status(409).json({ error: 'Beastbound Warfront has replaced Pet Tactical. Refresh the game before challenging.' });
        }

        // ── Set / replace your sealed defense (ownership-validated) ────────────
        if (action === 'defense') {
            const count = petsForMode(mode);
            const save = await kv.get<{ character?: { pets?: Array<Record<string, unknown>>; name?: string; village?: string } }>(`save:${me}`);
            const character = (save?.character ?? {}) as Record<string, unknown>;
            const owned = activeCarriedPets<Record<string, unknown>>(character);
            const pets = chooseOwnedLadderPets(owned, (body as { petIds?: unknown }).petIds, count);
            if (!pets) return res.status(400).json({ error: count === 1 ? 'Pick a pet you own.' : TACTICAL_ROSTER_COPY });
            const chosenIds = new Set(pets.map((pet) => String(pet.id ?? '')));
            if (owned.some((pet) => chosenIds.has(String(pet.id ?? '')) && petCombatBusyReason(character, pet))) {
                return res.status(409).json({ error: 'A selected pet is busy with breeding, training, or an expedition.' });
            }
            const displayName = String(save?.character?.name ?? me).slice(0, 40);
            const village = typeof save?.character?.village === 'string' ? save!.character!.village : undefined;
            const warfrontPlan = mode === 'tactical' ? parseWarfrontLadderPlan(body.warfrontPlan) : null;
            if (mode === 'tactical' && !warfrontPlan) {
                return res.status(400).json({ error: 'Choose four unique Warfront formation cells and save your defense again.' });
            }
            const def: DefenseDoc = {
                slug: me, name: displayName, village, mode, pets, roles: ladderRoles(pets),
                ...(warfrontPlan ? { warfrontPlan } : {}),
                updatedAt: now,
            };
            // Defense changes share the ranking lock: a contended save must not
            // overwrite a newly committed standing through an unlocked summary.
            await withKvLock(orderKey(mode), async () => {
                await kv.set(defKey(mode, me), def);
                const order = (await kv.get<LadderEntry[]>(orderKey(mode))) ?? [];
                const i = order.findIndex((e) => e.slug === me);
                if (i >= 0) { order[i] = { ...order[i], name: displayName, village, summary: pets.map(petLite), updatedAt: now }; await kv.set(orderKey(mode), order); }
            }, { failClosed: true });
            return res.status(200).json({ ok: true, defense: pets.map(petLite), warfrontPlan: def.warfrontPlan });
        }

        // ── Build the 3-opponent offer (close-above humans + AI fill) ──────────
        if (action === 'offer') {
            const myDef = await kv.get<DefenseDoc>(defKey(mode, me));
            if (!myDef) return res.status(400).json({ error: 'Set your defense first.' });
            const mySave = await kv.get<{ character?: Record<string, unknown> }>(`save:${me}`);
            if (!mySave?.character || !defenseUsesCombatReadyPets(mySave.character, myDef, mode)) {
                return res.status(409).json({ error: mode === 'tactical' ? TACTICAL_ROSTER_COPY : 'Reset your defense with an eligible carried pet.' });
            }
            const order = (await kv.get<LadderEntry[]>(orderKey(mode))) ?? [];
            const lastTarget = (await kv.get<string>(lastKey(mode, me))) ?? undefined;   // exclude the opponent just fought
            const aiStart = crypto.randomInt(0, AI_SEED_COUNT);
            return res.status(200).json({ offer: buildOffer(order, me, (i) => aiOfferSummary(mode, i), aiStart, lastTarget) });
        }

        // ── Challenge (server-authoritative resolution + rank swap) ────────────
        if (action === 'challenge') {
            if (!enforceRateLimit(req, res, 'pet-ladder-challenge', 1, 2_000, me)) return;
            const targetId = String((body as { targetId?: unknown }).targetId ?? '');
            let myDef = await kv.get<DefenseDoc>(defKey(mode, me));
            if (!myDef) return res.status(400).json({ error: 'Set your defense first.' });
            const mySave = await kv.get<{ character?: Record<string, unknown> }>(`save:${me}`);
            if (!mySave?.character || !defenseUsesCombatReadyPets(mySave.character, myDef, mode)) {
                return res.status(409).json({ error: mode === 'tactical' ? TACTICAL_ROSTER_COPY : 'Reset your defense with an eligible carried pet.' });
            }

            myDef = hydrateLadderVisualIdentity(myDef, activeCarriedPets<Record<string, unknown>>(mySave.character));

            const order0 = (await kv.get<LadderEntry[]>(orderKey(mode))) ?? [];
            const lastTarget = (await kv.get<string>(lastKey(mode, me))) ?? undefined;
            if (lastTarget && targetId === lastTarget) return res.status(409).json({ error: 'You just challenged this opponent — pick someone else.' });
            if (!canChallenge(order0, me, targetId, lastTarget)) return res.status(409).json({ error: 'That opponent is not available to challenge.' });

            // Fail fast if already out of challenges — but DON'T consume a slot yet.
            // The atomic incr is deferred until the fight is actually resolved and the
            // rank committed inside the order lock, so a 404 defender / resolve-throw /
            // lock-contention no-op can't burn a daily challenge (#18).
            const dKey = dailyKey(mode, me, dayStamp());
            const usedBefore = Number((await kv.get<number>(dKey)) ?? 0);
            if (usedBefore >= DAILY_CHALLENGES) return res.status(429).json({ error: `Out of challenges today (${DAILY_CHALLENGES}/day). Come back tomorrow.` });

            // Load the defender's SEALED roster (AI pool or the human's def doc).
            let targetDef: DefenseDoc | null;
            if (isAiId(targetId)) { const i = aiIndexOf(targetId); targetDef = i >= 0 && i < AI_SEED_COUNT ? aiDefense(mode, i) : null; }
            else targetDef = await kv.get<DefenseDoc>(defKey(mode, targetId));
            if (!targetDef || targetDef.pets.length === 0) return res.status(404).json({ error: 'Opponent has no defense set.' });
            if (!isAiId(targetId)) {
                const targetSave = await kv.get<{ character?: Record<string, unknown> }>(`save:${safeName(targetId)}`);
                if (!targetSave?.character || !defenseUsesCombatReadyPets(targetSave.character, targetDef, mode)) {
                    return res.status(409).json({ error: 'Opponent must reset an ineligible carried-pet defense.' });
                }
                targetDef = hydrateLadderVisualIdentity(targetDef, activeCarriedPets<Record<string, unknown>>(targetSave.character));
            }

            // Server-minted seed → server recomputes the winner (outside the lock).
            const seed = crypto.randomInt(1, 0x7fffffff);
            const warfront = mode === 'tactical' ? resolveLadderWarfront(myDef, targetDef, seed) : null;
            const won = warfront ? warfront.winner === 'blue' : resolveColiseum(myDef.pets[0], targetDef.pets[0], seed);

            const myEntry: LadderEntry = order0.find((e) => e.slug === me)
                ?? { slug: me, name: myDef.name, village: myDef.village, record: { wins: 0, losses: 0, defended: 0, defeated: 0 }, summary: myDef.pets.map(petLite), updatedAt: now };

            let rank: number | null = null;
            let notifySlug: string | null = null;
            let committed = false;
            let used = usedBefore;
            await withKvLock(orderKey(mode), async () => {
                const order = (await kv.get<LadderEntry[]>(orderKey(mode))) ?? [];
                const latestTarget = (await kv.get<string>(lastKey(mode, me))) ?? undefined;
                if (!canChallenge(order, me, targetId, latestTarget)) { const i = order.findIndex((e) => e.slug === me); rank = i >= 0 ? i + 1 : null; return; }
                // Re-check the daily cap inside the lock (no-op early-returns above never reach here).
                used = Number((await kv.get<number>(dKey)) ?? 0);
                if (used >= DAILY_CHALLENGES) return;
                used = await kv.incr(dKey, { ex: 36 * 3600 });
                if (used > DAILY_CHALLENGES) { const i = order.findIndex((e) => e.slug === me); rank = i >= 0 ? i + 1 : null; return; }
                const applied = applyChallenge(order, myEntry, targetId, won);
                // Bound the public list projection, never the stored standings:
                // trimming here silently evicts the lowest players and records.
                await kv.set(orderKey(mode), applied.order);
                committed = true;
                notifySlug = applied.notifySlug;
                const i = applied.order.findIndex((e) => e.slug === me);
                rank = i >= 0 ? i + 1 : null;
                // Publish the rematch guard before another challenge acquires
                // this lock; post-commit advisory failures cannot erase a win.
                try { await kv.set(lastKey(mode, me), targetId, { ex: LAST_TTL }); }
                catch (error) { console.error('[pet-ladder] committed rematch marker failed', error); }
            }, { failClosed: true });

            if (!committed) {
                if (used >= DAILY_CHALLENGES) return res.status(429).json({ error: `Out of challenges today (${DAILY_CHALLENGES}/day). Come back tomorrow.` });
                return res.status(409).json({ error: 'The available opponents changed before this fight could be recorded. Refresh the ladder and choose again.' });
            }

            // Notify the offline human defender (lightweight notify + realtime nudge).
            if (notifySlug && !isAiId(notifySlug)) {
                try { await appendNotify(notifySlug, { from: myDef.name, mode, won, at: now }); }
                catch (error) { console.error('[pet-ladder] committed defense notification failed', error); }
                kickPlayer(notifySlug, 'challenge');
            }

            // Sealed replay for the client cinematic (deterministic from seed + rosters).
            const replay = warfront
                ? {
                    kind: 'warfront' as const, seed,
                    blue: myDef.pets.map((p, i) => ({ pet: p, role: p.role ?? myDef.roles[i] ?? 'tracker' })),
                    red: targetDef.pets.map((p, i) => ({ pet: p, role: p.role ?? targetDef!.roles[i] ?? 'tracker' })),
                    bluePlan: warfront.bluePlan, redPlan: warfront.redPlan,
                }
                // The coliseum row now ships the server's OWN derived script.
                // The client cannot re-run this fight — Showdown has no client
                // mirror — so what it watches is what was scored, by
                // construction rather than by keeping two engines in step.
                : {
                    kind: 'showdown' as const,
                    seed,
                    player: myDef.pets[0],
                    enemy: targetDef.pets[0],
                    script: coliseumScript(myDef.pets[0], targetDef.pets[0], seed),
                };

            return res.status(200).json({ won, mode, targetId, rank, challengesLeft: Math.max(0, DAILY_CHALLENGES - used), replay });
        }

        return res.status(400).json({ error: 'Invalid action.' });
    } catch (err) {
        console.error('[pet-ladder]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
