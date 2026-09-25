import { randomInt } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { safeLogValue } from '../_safe-log.js';
import { betaRareGrantTally, recordBetaMetric } from '../_beta-metrics.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { activeCarriedPets } from '../_entitlements.js';
import { createShowdownSession, resolveShowdownRound, showdownStateView, type ShowdownSession } from '../_pet-showdown/engine.js';
import { chooseShowdownAiCommands } from '../_pet-showdown/ai.js';
import type { ShowdownCommand } from '../../shared/pet-showdown-contract.js';
import { wildBindingChance, wildBindingOpportunity, wildBindingSeal, wildResolveLoss, wildTraitHint, WILD_BINDING_SEALS } from '../../shared/wild-binding.js';
import { resolveSealAttempt, sealCount } from './_wild-binding-seal.js';
import { cleanPetEncounterPointer, petEncounterActiveKey, petEncounterRequestKey, PET_ENCOUNTER_POINTER_TTL_SECONDS } from './_encounter-pointer.js';
import { cleanWorldExploreAuthorityReceipt, worldExploreAuthorityKey } from '../world/_explore-authority.js';
import { caravanPetDiscovery } from '../festival/_caravan-pet.js';
import { trackerTrailDiscovery } from '../sector/_tracker-trail.js';
import { showdownBusyIssue } from './_showdown-readiness.js';
import { publishShowdownPresence, retireShowdownPresence } from './_showdown-presence.js';
import { grantWildPet } from './_encounter.js';
import { petAcquisitionDestination } from './_placement.js';
import { getPetFromSanctuary, storePetInSanctuary } from './_sanctuary.js';
import { PET_CATALOG } from './_catalog.js';

/** A single sealed Explore hit owns a single durable battle. The client sends
 * only the token, its carried pet id and turn orders; never a wild statline. */
type WildSession = ShowdownSession & {
    wild: {
        token: string;
        pet: Record<string, unknown>;
        resolve: number;
        maxResolve: 100;
        tutorial: boolean;
        lastAttempt?: { id: string; sealId: string; success: boolean; chance: number };
        loanerPet?: Record<string, unknown>;
    };
};

const tokenOf = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9]{16,96}$/.test(value) ? value : '';
const attemptIdOf = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{8,96}$/.test(value) ? value : '';
const battleKey = (player: string, token: string) => `pet:wild-binding:${player}:${token}`;
const encounterKey = (player: string, token: string) => `pet-encounter:${player}:${token}`;
const pct = (current: number, max: number) => max > 0 ? Math.max(0, Math.min(100, Math.round(current * 100 / max))) : 0;
const roll = () => randomInt(1_000_000_000) / 1_000_000_000;

function publicView(session: WildSession, character: Record<string, unknown>) {
    const enemy = session.enemy[0];
    const hpPercent = pct(enemy.hp, enemy.maxHp);
    const resolvePercent = session.wild.resolve;
    return {
        state: showdownStateView(session),
        wild: {
            name: String(session.wild.pet.name ?? enemy.name),
            rarity: String(session.wild.pet.rarity ?? 'standard'),
            trait: wildTraitHint(session.wild.pet.trait) ? String(session.wild.pet.trait) : null,
            traitHint: wildTraitHint(session.wild.pet.trait),
            hpPercent,
            resolvePercent,
            tutorial: session.wild.tutorial,
            ...(session.wild.loanerPet ? { loanerPet: session.wild.loanerPet } : {}),
            seals: WILD_BINDING_SEALS.map((seal) => {
                const count = sealCount(character, seal.id);
                const eligible = enemy.hp > 0 && resolvePercent <= seal.resolveThreshold;
                return {
                    ...seal,
                    count,
                    available: !session.finished && eligible && count > 0,
                    opportunity: count < 1 ? 'No seal owned' : !eligible ? 'Lower Resolve'
                        : wildBindingOpportunity(session.wild.tutorial ? 100 : wildBindingChance({
                            rarity: String(session.wild.pet.rarity ?? 'standard'), hpPercent, resolvePercent, sealId: seal.id,
                        })),
                };
            }),
        },
    };
}

async function settledDiscovery(playerName: string, token: string, character: Record<string, unknown>) {
    const active = cleanPetEncounterPointer(await kv.get(petEncounterActiveKey(playerName)));
    const encounter = await kv.get<Record<string, unknown>>(encounterKey(playerName, token));
    if (!active || active.outcome !== 'hit' || active.token !== token
        || !encounter || safeName(String(encounter.playerName ?? '')) !== playerName
        || encounter.battleRequired !== true) return null;
    const exploreReceiptId = typeof encounter.exploreReceiptId === 'string' ? encounter.exploreReceiptId : '';
    const projected = exploreReceiptId && Array.isArray(character.redeemedSectorExplorations)
        && (character.redeemedSectorExplorations as Array<Record<string, unknown>>).some((entry) => entry?.id === exploreReceiptId);
    const durable = exploreReceiptId
        ? cleanWorldExploreAuthorityReceipt(await kv.get(worldExploreAuthorityKey(playerName, exploreReceiptId)))
        : null;
    const explored = !!projected || (!!durable
        && durable.playerName.toLowerCase() === playerName.toLowerCase()
        && durable.sector === Math.floor(Number(encounter.sector))
        && durable.outcome?.kind === 'external'
        && durable.outcome?.source === 'pet')
        || caravanPetDiscovery(character, encounter.caravanRunId, encounter.requestId)
        || await trackerTrailDiscovery(playerName, encounter.trackerTrailId, encounter.requestId);
    return explored ? encounter : null;
}

async function closeDiscovery(playerName: string, token: string, resolution: 'befriended' | 'declined') {
    await withKvLock(petEncounterActiveKey(playerName), async () => {
        const activeKey = petEncounterActiveKey(playerName);
        const active = cleanPetEncounterPointer(await kv.get(activeKey));
        const encounter = await kv.get<Record<string, unknown>>(encounterKey(playerName, token));
        const requestId = active?.token === token ? active.requestId : String(encounter?.requestId ?? '');
        if (requestId) {
            const requestKey = petEncounterRequestKey(playerName, requestId);
            const prior = await kv.get<Record<string, unknown>>(requestKey);
            if (prior) await kv.set(requestKey, { ...prior, resolvedAt: Date.now(), resolution },
                { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
        }
        await kv.del(encounterKey(playerName, token));
        if (active?.token === token) await kv.del(activeKey);
    }, { failClosed: true });
}

/** A finished battle's discovery close runs after the battle lock, so a lock
 * timeout, storage error or restart there leaves the Explore hit "active" for
 * its whole pointer TTL, blocking Explore. Every read of a finished battle
 * retries the close. It only touches this token's rows, so repeating it after
 * a success (or after a newer discovery) changes nothing. */
async function closeFinishedDiscovery(playerName: string, token: string, session: WildSession) {
    if (!session.finished) return;
    await closeDiscovery(playerName, token, session.wild.lastAttempt?.success ? 'befriended' : 'declined');
}

function receiptFor(character: Record<string, unknown>, token: string, id: string) {
    const receipts = Array.isArray(character.redeemedPetEncounters)
        ? character.redeemedPetEncounters as string[] : [];
    return receipts.find((entry) => entry.startsWith(`wb:${token}:${id}:`)) ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const playerName = safeName(String(body.playerName ?? ''));
        const token = tokenOf(body.token);
        const action = String(body.action ?? '');
        if (!playerName || !token) return res.status(400).json({ error: 'Invalid wild encounter.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your encounter.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'pet-wild-binding', 90, 60_000, identity.name))) return;
        const key = battleKey(playerName, token);

        if (action === 'start') {
            const result = await withKvLock(key, async () => {
                const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                const character = save?.character as Record<string, unknown> | undefined;
                if (!character) return { error: 'No character save found.', status: 404 };
                const existing = await kv.get<WildSession>(key);
                if (existing) return { session: existing, character };
                const encounter = await settledDiscovery(playerName, token, character);
                if (!encounter) return { error: 'This wild discovery is not ready or has already been resolved.', status: 409 };
                const petId = String(body.petId ?? '').slice(0, 96);
                const carried = activeCarriedPets<Record<string, unknown>>(character);
                const selected = carried.find((pet) => String(pet.id ?? '') === petId) as unknown as Pet | undefined;
                if (carried.length > 0 && !selected) return { error: 'Choose a carried companion to face the wild pet.', status: 409 };
                const loanerPet = carried.length === 0 ? {
                    ...structuredClone(PET_CATALOG['standard-0']), id: `wild-loaner-${token}`,
                    templateId: 'standard-0', name: 'Guild Fox', origin: 'starter', level: 1,
                } : null;
                const mine = selected ?? loanerPet as Pet;
                const busy = selected ? showdownBusyIssue(character, [selected]) : null;
                if (busy) return { error: busy, status: 409 };
                const receipts = Array.isArray(character.redeemedPetEncounters)
                    ? character.redeemedPetEncounters as string[] : [];
                const tutorial = !receipts.some((receipt) => !receipt.startsWith('wb:'));
                const wildPet = encounter.pet as Record<string, unknown>;
                const battle = createShowdownSession({
                    sessionId: token, playerName, format: '1v1', tier: tutorial ? 'scrapper' : 'warrior',
                    seed: randomInt(1, 0x7fffffff), playerPets: [mine],
                    enemyPets: [wildPet as unknown as Pet], enemyTeamName: String(wildPet.name ?? 'Wild companion'),
                    rewardEligible: false,
                }) as WildSession;
                battle.wild = { token, pet: wildPet, resolve: tutorial ? 35 : 100, maxResolve: 100, tutorial,
                    ...(loanerPet ? { loanerPet } : {}) };
                await kv.set(key, battle, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                await publishShowdownPresence(kv, playerName, token);
                return { session: battle, character };
            }, { failClosed: true });
            if ('error' in result) return res.status(result.status ?? 409).json({ error: result.error });
            await closeFinishedDiscovery(playerName, token, result.session);
            return res.status(200).json({ ok: true, ...publicView(result.session, result.character) });
        }

        if (action === 'state') {
            const [session, save] = await Promise.all([
                kv.get<WildSession>(key), kv.get<Record<string, unknown>>(`save:${playerName}`),
            ]);
            if (!session || session.playerName !== playerName || !save?.character) return res.status(404).json({ error: 'No wild battle found.' });
            await closeFinishedDiscovery(playerName, token, session);
            return res.status(200).json({ ok: true, ...publicView(session, save.character as Record<string, unknown>) });
        }

        if (action === 'turn') {
            const expectedRound = Number(body.expectedRound);
            if (!Number.isSafeInteger(expectedRound) || expectedRound < 0) return res.status(400).json({ error: 'Invalid round.' });
            const result = await withKvLock(key, async () => {
                const session = await kv.get<WildSession>(key);
                if (!session || session.playerName !== playerName) return { error: 'No wild battle found.', status: 404 };
                let events: ReturnType<typeof resolveShowdownRound> = [];
                if (!session.finished && session.round === expectedRound) {
                    const before = session.enemy[0]?.hp ?? 0;
                    const raw = Array.isArray(body.commands) ? body.commands as Array<Record<string, unknown>> : [];
                    const playerId = session.player[0]?.id;
                    const commands: ShowdownCommand[] = raw.slice(0, 1).flatMap<ShowdownCommand>((command) => {
                        if (command.petId !== playerId) return [];
                        if (command.kind === 'guard' || command.kind === 'rest') return [{ kind: command.kind, petId: playerId }];
                        if (command.kind === 'move' && Number.isSafeInteger(command.moveIndex))
                            return [{ kind: 'move', petId: playerId, moveIndex: Math.max(0, Math.min(7, Number(command.moveIndex))), targetId: session.enemy[0].id }];
                        if (command.kind === 'super') return [{ kind: 'super', petId: playerId, targetId: session.enemy[0].id }];
                        return [];
                    });
                    events = resolveShowdownRound(session, commands, chooseShowdownAiCommands(session));
                    if (!session.finished && session.enemy[0]?.hp > 0) {
                        const damage = Math.max(0, before - session.enemy[0].hp);
                        const kind = commands[0]?.kind;
                        const acted = events.some((event) => event.t === 'action' && event.actorSide === 'player');
                        const resolveLoss = wildResolveLoss({
                            trait: session.wild.pet.trait, kind, damage,
                            maxHp: session.enemy[0].maxHp, round: session.round, acted,
                        });
                        session.wild.resolve = Math.max(1, session.wild.resolve - resolveLoss);
                    }
                    await kv.set(key, session, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                    if (session.finished) await retireShowdownPresence(kv, playerName, token);
                }
                const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                return { session, events, character: (save?.character ?? {}) as Record<string, unknown> };
            }, { failClosed: true });
            if ('error' in result) return res.status(result.status ?? 409).json({ error: result.error });
            if (result.session.finished) await closeDiscovery(playerName, token,
                result.session.wild.lastAttempt?.success ? 'befriended' : 'declined');
            return res.status(200).json({ ok: true, events: result.events, ...publicView(result.session, result.character) });
        }

        if (action === 'capture') {
            const attemptId = attemptIdOf(body.attemptId);
            const seal = wildBindingSeal(body.sealId);
            if (!attemptId || !seal) return res.status(400).json({ error: 'Choose a valid seal and capture attempt.' });
            const result = await withKvLock(key, async () => {
                const session = await kv.get<WildSession>(key);
                if (!session || session.playerName !== playerName) return { error: 'No wild battle found.', status: 404 };
                if (session.wild.lastAttempt?.id === attemptId) {
                    const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                    const savedCharacter = (save?.character ?? {}) as Record<string, unknown>;
                    const rosterPet = session.wild.lastAttempt.success && Array.isArray(savedCharacter.pets)
                        ? (savedCharacter.pets as Array<Record<string, unknown>>).find((pet) => pet.id === session.wild.pet.id)
                        : null;
                    const sanctuaryPet = session.wild.lastAttempt.success && !rosterPet
                        ? (await getPetFromSanctuary(playerName, String(session.wild.pet.id ?? '')))?.pet ?? null
                        : null;
                    return { session, character: (save?.character ?? {}) as Record<string, unknown>,
                        saveVersion: Number(save?._saveVersion ?? 0), attempt: session.wild.lastAttempt,
                        pet: rosterPet ?? sanctuaryPet,
                        destination: rosterPet ? 'roster' : sanctuaryPet ? 'sanctuary' : null,
                        replayed: true };
                }
                const enemy = session.enemy[0];
                if (session.finished || enemy.hp <= 0 || session.wild.resolve > seal.resolveThreshold)
                    return { error: 'This seal cannot bind the wild pet at its current Resolve.', status: 409 };
                const currentSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
                if (!currentSave?.character || !await settledDiscovery(playerName, token, currentSave.character as Record<string, unknown>))
                    return { error: 'This wild discovery is no longer active.', status: 409 };
                const hpPercent = pct(enemy.hp, enemy.maxHp);
                const chance = session.wild.tutorial ? 100 : wildBindingChance({
                    rarity: String(session.wild.pet.rarity ?? 'standard'), hpPercent,
                    resolvePercent: session.wild.resolve, sealId: seal.id,
                });
                const receiptPrefix = `wb:${token}:${attemptId}:`;
                const spent = await mutatePlayerSave(playerName, async ({ character }) => {
                    const prior = receiptFor(character, token, attemptId);
                    if (prior) return { ok: true as const, character, value: { success: prior === `${receiptPrefix}1`, replayed: true, pet: null, destination: null } };
                    const sealAttempt = resolveSealAttempt(character, seal.id, chance, roll);
                    if (!sealAttempt) return { ok: false as const, status: 409, error: 'You have no seal of that type.' };
                    const { success } = sealAttempt;
                    let next = sealAttempt.character;
                    let pet: Record<string, unknown> | null = null;
                    let destination: 'roster' | 'sanctuary' | null = null;
                    if (success) {
                        const granted = grantWildPet(next, session.wild.pet, roll);
                        if (!granted.ok) return { ok: false as const, status: 409, error: granted.reason };
                        destination = petAcquisitionDestination(next);
                        pet = destination === 'sanctuary'
                            ? (await storePetInSanctuary(playerName, granted.pet, 'wild')).item.pet
                            : granted.pet;
                        if (destination === 'roster') next = granted.character;
                    }
                    const receipts = Array.isArray(next.redeemedPetEncounters) ? next.redeemedPetEncounters as string[] : [];
                    next = { ...next, redeemedPetEncounters: [...receipts.slice(-254), `${receiptPrefix}${success ? '1' : '0'}`, ...(success ? [token] : [])] };
                    return { ok: true as const, character: next, value: { success, replayed: false, pet, destination } };
                });
                if (!spent.ok) return { error: spent.error, status: spent.status };
                const attempt = { id: attemptId, sealId: seal.id, success: spent.value.success, chance };
                session.wild.lastAttempt = attempt;
                if (attempt.success) {
                    session.finished = true;
                    session.outcome = 'win';
                }
                await kv.set(key, session, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                if (attempt.success) await retireShowdownPresence(kv, playerName, token);
                const rosterPet = attempt.success && spent.value.replayed && Array.isArray(spent.character.pets)
                    ? (spent.character.pets as Array<Record<string, unknown>>).find((pet) => pet.id === session.wild.pet.id)
                    : null;
                const sanctuaryPet = attempt.success && spent.value.replayed && !rosterPet
                    ? (await getPetFromSanctuary(playerName, String(session.wild.pet.id ?? '')))?.pet ?? null
                    : null;
                return { session, character: spent.character, saveVersion: spent._saveVersion,
                    attempt, pet: spent.value.pet ?? rosterPet ?? sanctuaryPet,
                    destination: spent.value.destination ?? (rosterPet ? 'roster' : sanctuaryPet ? 'sanctuary' : null),
                    replayed: spent.value.replayed };
            }, { failClosed: true });
            if ('error' in result) return res.status(result.status ?? 409).json({ error: result.error });
            if (result.attempt.success) await closeDiscovery(playerName, token, 'befriended');
            if (!result.replayed) {
                console.info('[pet/wild-binding-attempt]', JSON.stringify({
                    rarity: String(result.session.wild.pet.rarity ?? 'standard'),
                    sealId: result.attempt.sealId,
                    chance: result.attempt.chance,
                    success: result.attempt.success,
                    hpPercent: pct(result.session.enemy[0].hp, result.session.enemy[0].maxHp),
                    resolvePercent: result.session.wild.resolve,
                    tutorial: result.session.wild.tutorial,
                }));
                if (result.attempt.success && result.pet) void recordBetaMetric({
                    event: 'pet.acquired', playerName,
                    source: String(result.destination ?? 'roster'),
                    rareGrants: betaRareGrantTally('pet', [result.pet.rarity]),
                });
            }
            return res.status(200).json({ ok: true, ...publicView(result.session, result.character),
                capture: { success: result.attempt.success, chance: result.attempt.chance,
                    sealId: result.attempt.sealId, replayed: result.replayed,
                    pet: result.pet ?? null, destination: result.destination ?? null },
                character: result.character, _saveVersion: result.saveVersion });
        }

        if (action === 'forfeit') {
            const result = await withKvLock(key, async () => {
                const session = await kv.get<WildSession>(key);
                if (!session || session.playerName !== playerName) return null;
                if (!session.finished) {
                    session.finished = true;
                    session.outcome = 'loss';
                    await kv.set(key, session, { ex: PET_ENCOUNTER_POINTER_TTL_SECONDS });
                    await retireShowdownPresence(kv, playerName, token);
                }
                return session;
            }, { failClosed: true });
            if (!result) return res.status(404).json({ error: 'No wild battle found.' });
            await closeDiscovery(playerName, token, result.wild.lastAttempt?.success ? 'befriended' : 'declined');
            return res.status(200).json({ ok: true, state: showdownStateView(result) });
        }
        return res.status(400).json({ error: 'Unknown wild battle action.' });
    } catch (error) {
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'Wild battle is resolving. Retry shortly.', retryable: true });
        console.error('[pet/wild-binding]', safeLogValue(error));
        return res.status(500).json({ error: 'Wild battle could not be resolved.' });
    }
}
