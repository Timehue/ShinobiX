import { randomInt, randomUUID } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { getFloor, isPublicFloor, MAX_PARTY_SIZE } from './_floor-catalog.js';
import { getSpireFloor, spireBossForFloor, isValidSpireTier, spireRequiresFullSquad } from './_spire-catalog.js';
import { resolveAscensionModifiers, weeklySpireBlessing, type AscensionSeal } from './_modifiers.js';
import { weekIndex } from '../missions/_weekly-board.js';
import { sealTowerFighter, sealTowerItemCharges } from './_seal.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { buildTowerEncounter, type SquadMemberInput } from './_encounter.js';
import { startRound, runAiUntilHuman } from './_engine.js';
import { makeRng } from './_sim.js';
import {
    readSession,
    writeSession,
    setTowerInvite,
    bumpDailyStartCount,
    isPublicTowerRun,
    isSpireRun,
    MAX_TOWER_STARTS_PER_DAY,
} from './_tower-store.js';
import { stampTurnClock } from './_tower-mp.js';
import { sealPveDifficultyBand } from '../_pve-band-seal.js';
import { sealPveAiMastery } from '../_pve-ai-mastery.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { withKvLock } from '../_lock.js';
import { bumpSaveVersion } from '../save/_save-version.js';
import { writeSaveProjected } from '../save/_projected-write.js';
import {
    refundTowerDirectEntryReservation,
    refundTowerPartyEntryReservation,
    reserveTowerDirectEntry,
    reserveTowerPartyEntry,
} from './_party-entry.js';
import { STORY_TOWER_MIN_LEVEL, storyTowerMemberRequirements } from './_story-eligibility.js';
import { initializeTowerActionVersion } from './_action-idempotency.js';
import { floorForSession, sealTowerCatalogFloor, sealedStoryFloorForSession } from './_session-floor.js';
import { recordTowerRunStarted } from './_telemetry.js';
import { towerModeDisabled } from './_mode-control.js';
import { battleLockKey, claimTowerBattleLeases, releaseTowerBattleLeases, towerBattleLeaseMembers } from './_battle-lease.js';
import { isTowerBattleLock } from '../_tower-battle-guard.js';
import { activeClanBossConflictMembers } from './_clan-boss-conflict.js';
import { buildGenericTowerAiCharacter, GENERIC_TOWER_AI_PROFILE } from './_generic-party-ai.js';
import { kickTowerPlayers } from '../_realtime/notify.js';
import {
    TOWER_PARTY_ID,
    TOWER_PARTY_REQUEST_ID,
    activateTowerPartyLaunch,
    loadTowerParty,
    prepareTowerPartyLaunch,
    reopenTowerPartyLaunch,
    towerPartyAiMembers,
    towerPartyHumanMembers,
    towerPartyView,
    type StoredTowerParty,
    type TowerPartyBinding,
} from './_party.js';
import type { TowerSession } from './_tower-session.js';

type PartyBoundSession = TowerSession & {
    towerPartyId?: string;
    towerPartyLaunchRequestId?: string;
};

function sameBinding(party: StoredTowerParty, binding: TowerPartyBinding): boolean {
    return party.binding.mode === binding.mode
        && (binding.mode === 'story'
            ? party.binding.mode === 'story' && party.binding.floor === binding.floor
            : party.binding.mode === 'spire' && party.binding.ascensionTier === binding.ascensionTier);
}

function sameMembers(session: TowerSession, party: StoredTowerParty): boolean {
    const members = towerPartyHumanMembers(party).map(member => member.slug);
    const owners = [...new Set(session.actors
        .filter(actor => actor.side === 'squad' && actor.ai === false)
        .map(actor => actor.ownerSlug)
        .filter((slug): slug is string => !!slug))].sort();
    const genericCount = session.actors.filter(actor => actor.side === 'squad'
        && actor.ai === true
        && actor.ownerSlug === null
        && actor.character.towerGenericAiProfile === GENERIC_TOWER_AI_PROFILE).length;
    return owners.length === members.length
        && owners.every((slug, index) => slug === [...members].sort()[index])
        && genericCount === towerPartyAiMembers(party).length;
}

function publishTowerStart(session: TowerSession, party?: StoredTowerParty | null): void {
    const players = towerBattleLeaseMembers(session);
    kickTowerPlayers(players, {
        channel: 'session',
        reason: 'started',
        runId: session.runId,
        actionVersion: Number((session as TowerSession & { actionVersion?: number }).actionVersion ?? 0),
    });
    if (party) {
        kickTowerPlayers(towerPartyHumanMembers(party).map(member => member.slug), {
            channel: 'party',
            reason: 'launched',
            partyId: party.id,
            version: party.version,
        });
    }
}

/*
 * POST /api/towers/start — begin a Battle Towers run.
 *
 * `partyId` launches an authoritative ready room: the server derives the exact
 * live roster plus its optional, ownerless novice recruit. A direct Story start
 * is host-only. Borrowed player saves are never accepted as new AI teammates;
 * already-published legacy sessions remain recoverable through their run ID.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    let preparedParty: { partyId: string; requestId: string; runId: string } | null = null;
    let claimedLease: { runId: string; members: string[] } | null = null;
    let sessionPublished = false;
    let publicationInconclusive = false;
    const releaseClaimedLease = async (): Promise<void> => {
        const claim = claimedLease;
        if (!claim) return;
        await releaseTowerBattleLeases(claim.runId, claim.members);
        claimedLease = null;
    };
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const hostName = safeName(String(body.hostName ?? ''));
        if (!hostName) return res.status(400).json({ error: 'Invalid host name.' });
        if (!enforceRateLimit(req, res, 'towers-start', 6, 60_000, hostName)) return;

        const identity = await authedPlayerOrAdmin(req, hostName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== hostName) return res.status(403).json({ error: 'Can only start your own runs.' });

        const mode: 'story' | 'spire' = String(body.mode ?? 'story') === 'spire' ? 'spire' : 'story';
        const spireTier = Math.floor(Number(body.ascensionTier));
        if (mode === 'spire' && !isValidSpireTier(spireTier)) return res.status(400).json({ error: 'Invalid spire tier.' });
        const floorNum = Math.floor(Number(body.floor));
        const floor = mode === 'spire'
            ? getSpireFloor(spireTier)
            : (isPublicFloor(floorNum) ? getFloor(floorNum) : undefined);
        if (!floor) return res.status(400).json({ error: mode === 'spire' ? 'Unknown spire tier.' : 'Unknown floor.' });
        const binding: TowerPartyBinding = mode === 'spire'
            ? { mode, ascensionTier: spireTier }
            : { mode, floor: floorNum };

        const partyId = String(body.partyId ?? '');
        const partyRequestId = String(body.requestId ?? '');
        const expectedVersion = Number(body.expectedVersion);
        let authoritativeParty: StoredTowerParty | null = null;
        let disabledReplaySession: TowerSession | null = null;
        if (partyId) {
            if (!TOWER_PARTY_ID.test(partyId)) return res.status(400).json({ error: 'Invalid party.', errorCode: 'invalid-party' });
            if (!TOWER_PARTY_REQUEST_ID.test(partyRequestId)) return res.status(400).json({ error: 'A valid request ID is required.', errorCode: 'invalid-request-id' });
            if (!Number.isSafeInteger(expectedVersion)) return res.status(400).json({ error: 'A valid expectedVersion is required.', errorCode: 'invalid-version' });
            authoritativeParty = await loadTowerParty(partyId);
            if (!authoritativeParty) return res.status(404).json({ error: 'That Tower party no longer exists.', errorCode: 'party-not-found' });
            if (authoritativeParty.hostSlug !== hostName) return res.status(403).json({ error: 'Only the party host can launch.', errorCode: 'host-required' });
            if (!sameBinding(authoritativeParty, binding)) {
                return res.status(409).json({ error: 'The requested Tower floor does not match the party ready room.', errorCode: 'binding-mismatch', party: towerPartyView(authoritativeParty) });
            }
            if (towerModeDisabled()) {
                const replayable = authoritativeParty.launch?.requestId === partyRequestId
                    && (authoritativeParty.status === 'launching' || authoritativeParty.status === 'active');
                disabledReplaySession = replayable && authoritativeParty.launch
                    ? await readSession(authoritativeParty.launch.runId)
                    : null;
                if (!disabledReplaySession) {
                    return res.status(503).json({ error: 'Battle Towers launches are temporarily disabled.', errorCode: 'tower-mode-disabled' });
                }
            }
        } else {
            if (towerModeDisabled()) {
                return res.status(503).json({ error: 'Battle Towers launches are temporarily disabled.', errorCode: 'tower-mode-disabled' });
            }
            if (mode === 'spire' && !identity.admin) {
                return res.status(403).json({
                    error: 'The Endless Spire requires an authoritative ready room with exactly four live members.',
                    errorCode: 'party-required',
                    requiredPartySize: MAX_PARTY_SIZE,
                });
            }
        }

        const hostLoadout = body.hostLoadout && typeof body.hostLoadout === 'object'
            ? body.hostLoadout as Record<string, unknown>
            : {};
        const submittedAllies = body.allies;
        const hasBorrowedAllyInput = Array.isArray(submittedAllies)
            ? submittedAllies.length > 0
            : submittedAllies !== undefined && submittedAllies !== null;
        if (hasBorrowedAllyInput) {
            return res.status(400).json({
                error: 'Borrowed player AI assists are no longer available. Open a Story Ready Room and add the Novice Tower Recruit.',
                errorCode: 'borrowed-allies-disabled',
            });
        }
        const memberSlugs = authoritativeParty
            ? towerPartyHumanMembers(authoritativeParty).map(member => member.slug)
            : [hostName];
        const genericAiMembers = authoritativeParty ? towerPartyAiMembers(authoritativeParty) : [];

        const unavailable: string[] = [];
        const ineligible: string[] = [];
        const storyMembers: { member: string; character: Record<string, unknown> }[] = [];
        let hostAscensionUnlocked = 0;
        let availableMemberCount = 0;
        for (let index = 0; index < memberSlugs.length; index++) {
            const slug = memberSlugs[index]!;
            const record = await augmentSaveWithForgedDefs(
                await kv.get<Record<string, unknown>>(`save:${slug}`),
            );
            const character = record?.character as Record<string, unknown> | undefined;
            if (!character || typeof character !== 'object') {
                if (authoritativeParty) unavailable.push(slug);
                else if (slug === hostName) return res.status(400).json({ error: 'Your save was not found.' });
                continue;
            }
            availableMemberCount++;
            const unlocked = Math.max(0, Math.floor(Number(character.battleTowerAscension) || 0));
            if (slug === hostName) hostAscensionUnlocked = unlocked;
            if (mode === 'spire' && authoritativeParty && !identity.admin && spireTier > unlocked + 1) ineligible.push(slug);
            if (mode === 'story' && (authoritativeParty || slug === hostName)) {
                storyMembers.push({ member: slug, character });
            }
        }
        if (unavailable.length) {
            return res.status(409).json({
                error: 'One or more ready party members no longer has an available save.',
                errorCode: 'member-unavailable',
                members: unavailable,
                party: authoritativeParty ? towerPartyView(authoritativeParty) : null,
            });
        }
        if (availableMemberCount === 0) return res.status(400).json({ error: 'No valid squad members.' });
        const storyRequirements = mode === 'story' && !identity.admin
            ? storyTowerMemberRequirements(storyMembers, floorNum)
            : [];
        if (storyRequirements.length) {
            const requiredFloor = storyRequirements.some(requirement => requirement.requiredFloor !== undefined)
                ? floorNum
                : undefined;
            const requiredLevel = storyRequirements.some(requirement => requirement.requiredLevel !== undefined)
                ? STORY_TOWER_MIN_LEVEL
                : undefined;
            return res.status(403).json({
                error: 'Every live party member must meet the Story Tower entry requirements.',
                errorCode: 'member-ineligible',
                mode: 'story',
                members: storyRequirements.map(requirement => requirement.member),
                memberRequirements: storyRequirements,
                ...(requiredFloor === undefined ? {} : { requiredFloor }),
                ...(requiredLevel === undefined ? {} : { requiredLevel }),
                party: authoritativeParty ? towerPartyView(authoritativeParty) : null,
            });
        }
        if (ineligible.length) {
            return res.status(403).json({
                error: `Every party member must unlock Spire tier ${spireTier} before launch.`,
                errorCode: 'member-ineligible',
                members: ineligible,
                requiredTier: spireTier,
                party: authoritativeParty ? towerPartyView(authoritativeParty) : null,
            });
        }

        const liveLaunchMembers = authoritativeParty ? memberSlugs : [hostName];
        const clanBossBusy = await activeClanBossConflictMembers(liveLaunchMembers);
        if (clanBossBusy.length) {
            return res.status(409).json({
                error: 'One or more party members has an active Clan Boss assault.',
                errorCode: 'member-busy',
                members: clanBossBusy,
                party: authoritativeParty ? towerPartyView(authoritativeParty) : null,
            });
        }

        // Ready-room launch preparation reserves the attempt count atomically.
        // Preflight known battle locks first so an already-busy member does not
        // consume that attempt. The later atomic claim remains final authority.
        if (authoritativeParty?.status === 'forming') {
            const allowedRecoveryRun = authoritativeParty.launch?.requestId === partyRequestId
                ? authoritativeParty.launch.runId
                : null;
            const battleBusy = (await Promise.all(memberSlugs.map(async member => {
                const current = await kv.get<unknown>(battleLockKey(member));
                if (!current) return null;
                if (allowedRecoveryRun && isTowerBattleLock(current) && current.battleId === allowedRecoveryRun) return null;
                return member;
            }))).filter((member): member is string => !!member);
            if (battleBusy.length) {
                return res.status(409).json({
                    error: 'One or more party members is already in another active battle.',
                    errorCode: 'member-busy',
                    members: battleBusy,
                    party: towerPartyView(authoritativeParty),
                });
            }
        }

        let ascension: AscensionSeal | undefined;
        let spireBossId: string | undefined;
        if (mode === 'spire') {
            if (!identity.admin && !authoritativeParty && spireTier > hostAscensionUnlocked + 1) {
                return res.status(403).json({ error: `Spire floor ${spireTier} is locked — clear floor ${hostAscensionUnlocked + 1} first.`, errorCode: 'member-ineligible' });
            }
            // Legacy testing access retains its existing environment switch. A
            // real ready-room launch is independently forced to four below.
            if (!authoritativeParty && spireRequiresFullSquad() && !identity.admin && availableMemberCount < MAX_PARTY_SIZE) {
                return res.status(403).json({ error: 'The Endless Spire requires a full squad.', errorCode: 'invalid-size' });
            }
            spireBossId = spireBossForFloor(spireTier);
            const blessing = weeklySpireBlessing(weekIndex(Date.now()));
            ascension = resolveAscensionModifiers(spireTier, spireBossId ?? 'sovereign', floor.roundBudget, blessing.modifier);
        }

        let runId = `tower-${randomUUID().replace(/-/g, '')}`;
        let seed = identity.admin ? 12345 : randomInt(1, 0x7fffffff);
        let preparedView: StoredTowerParty | null = null;
        if (authoritativeParty) {
            const prepared = await prepareTowerPartyLaunch({
                partyId: authoritativeParty.id,
                hostSlug: hostName,
                requestId: partyRequestId,
                expectedVersion,
                binding,
                enforceStartCap: !identity.admin,
                allowShortSpireParty: identity.admin,
            }, identity.admin ? { seed: () => 12345 } : {});
            if (!prepared.ok) {
                return res.status(prepared.status).json({ error: prepared.error, errorCode: prepared.code, party: prepared.party ? towerPartyView(prepared.party) : null });
            }
            preparedView = prepared.party;
            const launch = prepared.party.launch;
            if (!launch) throw new Error('Tower party launch preparation did not mint a launch record.');
            const preparedMembers = towerPartyHumanMembers(prepared.party).map(member => member.slug);
            const preparedAi = towerPartyAiMembers(prepared.party).map(member => member.slug);
            if (preparedMembers.length !== memberSlugs.length
                || preparedMembers.some((slug, index) => slug !== memberSlugs[index])
                || preparedAi.length !== genericAiMembers.length
                || preparedAi.some((slug, index) => slug !== genericAiMembers[index]?.slug)) {
                await reopenTowerPartyLaunch(prepared.party.id, partyRequestId);
                return res.status(409).json({ error: 'The party roster changed. Review the latest status and retry.', errorCode: 'party-changed', party: towerPartyView(prepared.party) });
            }
            runId = launch.runId;
            seed = launch.seed;
            preparedParty = { partyId: prepared.party.id, requestId: partyRequestId, runId };

            const existing = disabledReplaySession ?? await readSession(runId);
            if (existing) {
                const bound = existing as PartyBoundSession;
                const existingFloor = floorForSession(existing);
                const expectedFloorId = mode === 'story' ? floorNum : spireTier;
                const validModeIdentity = mode === 'story' ? isPublicTowerRun(existing) : isSpireRun(existing);
                if (bound.towerPartyId !== prepared.party.id
                    || bound.towerPartyLaunchRequestId !== partyRequestId
                    || !sameMembers(existing, prepared.party)
                    || !validModeIdentity
                    || existingFloor?.id !== expectedFloorId) {
                    throw new Error('Tower party launch record collided with another session.');
                }
                const lease = await claimTowerBattleLeases({
                    runId,
                    members: towerBattleLeaseMembers(existing),
                    partyId: prepared.party.id,
                    preserveExistingOnConflict: true,
                });
                if (!lease.ok) {
                    return res.status(409).json({
                        error: 'One or more party members is already in another active battle.',
                        errorCode: lease.code,
                        members: lease.members,
                        party: towerPartyView(prepared.party),
                    });
                }
                claimedLease = { runId, members: lease.members };
                sessionPublished = true;
                let chargedRyo = 0;
                let authoritativeCharacter: Record<string, unknown> | null = null;
                let saveVersion = 0;
                if (mode === 'story' && !identity.admin) {
                    const saveKey = `save:${hostName}`;
                    const reservation = await withKvLock(saveKey, async () => {
                        const record = await kv.get<Record<string, unknown>>(saveKey);
                        const character = record?.character as Record<string, unknown> | undefined;
                        if (!record || !character) throw new Error('Tower party host save missing during launch replay.');
                        const reserved = reserveTowerPartyEntry({
                            character,
                            partyId: prepared.party.id,
                            runId,
                            day: new Date().toISOString().slice(0, 10),
                            floorId: existingFloor.id,
                            now: Date.now(),
                        });
                        if (!reserved.ok) return { ok: false as const, reserved };
                        if (!reserved.changed) return { ok: true as const, charged: reserved.charged, character, saveVersion: Number(record._saveVersion ?? 0) };
                        const nextRecord = bumpSaveVersion<Record<string, unknown>>({ ...record, character: reserved.character });
                        await writeSaveProjected(saveKey, nextRecord, record);
                        return { ok: true as const, charged: reserved.charged, character: reserved.character as Record<string, unknown>, saveVersion: Number(nextRecord._saveVersion ?? 0) };
                    }, { failClosed: true });
                    if (!reservation.ok) return res.status(409).json({ error: 'The Tower entry reservation could not be recovered.', errorCode: reservation.reserved.code });
                    chargedRyo = reservation.charged;
                    authoritativeCharacter = reservation.character;
                    saveVersion = reservation.saveVersion;
                }
                const activated = await activateTowerPartyLaunch(prepared.party.id, partyRequestId, runId);
                for (const slug of towerBattleLeaseMembers(existing)) if (slug !== hostName) await setTowerInvite(slug, runId).catch(() => undefined);
                await recordTowerRunStarted(existing);
                publishTowerStart(existing, activated ?? prepared.party);
                return res.status(200).json({
                    runId,
                    partyId: prepared.party.id,
                    party: activated ? towerPartyView(activated) : towerPartyView(prepared.party),
                    session: existing,
                    chargedRyo,
                    replayed: true,
                    ...(authoritativeCharacter ? { character: authoritativeCharacter, _saveVersion: saveVersion } : {}),
                });
            }
            if (prepared.party.launch?.state === 'active') {
                // The launch points at no durable session. Exact-run release is
                // safe and lets stale-room reconciliation free the party indexes.
                await releaseTowerBattleLeases(runId, memberSlugs);
                return res.status(409).json({ error: 'The active Tower run is no longer available.', errorCode: 'run-unavailable', party: towerPartyView(prepared.party) });
            }
        }

        const lease = await claimTowerBattleLeases({
            runId,
            members: authoritativeParty ? memberSlugs : [hostName],
            ...(authoritativeParty ? { partyId: authoritativeParty.id } : {}),
        });
        if (!lease.ok) {
            if (preparedParty) {
                await reopenTowerPartyLaunch(preparedParty.partyId, preparedParty.requestId);
                preparedParty = null;
            }
            return res.status(409).json({
                error: authoritativeParty
                    ? 'One or more party members is already in another active battle.'
                    : 'Finish your current battle before entering the Battle Towers.',
                errorCode: lease.code,
                members: lease.members,
                party: authoritativeParty ? towerPartyView(authoritativeParty) : null,
            });
        }
        claimedLease = { runId, members: lease.members };

        // The cap is intentionally attempt-based. Known party-member conflicts
        // were preflighted above; party launches reserve their attempt atomically
        // with the launch record, while direct launches count after lease claim.
        if (!authoritativeParty) {
            const started = await bumpDailyStartCount(hostName);
            if (!identity.admin && started > MAX_TOWER_STARTS_PER_DAY) {
                await releaseClaimedLease();
                return res.status(429).json({ error: 'Daily Battle Towers start limit reached.' });
            }
        }

        // Seal combat snapshots only after every live account is leased. Direct
        // starts have exactly one human; AI teammates exist only in Story parties.
        const admin = await loadAdminCombatContent();
        const squad: SquadMemberInput[] = [];
        const unavailableAfterClaim: string[] = [];
        for (let index = 0; index < memberSlugs.length; index++) {
            const slug = memberSlugs[index]!;
            const record = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${slug}`));
            const character = record?.character as Record<string, unknown> | undefined;
            if (!character || typeof character !== 'object') {
                if (authoritativeParty || slug === hostName) unavailableAfterClaim.push(slug);
                continue;
            }
            squad.push({
                id: `sq-${index}`,
                name: String(character.name ?? slug),
                ownerSlug: slug,
                ai: false,
                character: sealTowerFighter(character, record, slug === hostName ? hostLoadout : {}, admin),
                itemCharges: sealTowerItemCharges(character),
            });
        }
        for (const member of genericAiMembers) {
            squad.push({
                id: `sq-${member.slug}`,
                name: member.displayName,
                ownerSlug: '',
                ownerless: true,
                ai: true,
                character: buildGenericTowerAiCharacter(floorNum),
                itemCharges: {},
            });
        }
        if (unavailableAfterClaim.length || squad.length === 0) {
            await releaseClaimedLease();
            if (preparedParty) {
                await reopenTowerPartyLaunch(preparedParty.partyId, preparedParty.requestId);
                preparedParty = null;
            }
            return res.status(authoritativeParty ? 409 : 400).json({
                error: authoritativeParty
                    ? 'One or more ready party members no longer has an available save.'
                    : 'Your save was not found.',
                errorCode: authoritativeParty ? 'member-unavailable' : 'save-unavailable',
                members: unavailableAfterClaim,
                party: authoritativeParty ? towerPartyView(authoritativeParty) : null,
            });
        }

        const now = Date.now();
        const session = buildTowerEncounter({ floor, squad, runId, seed, partySize: squad.length, now, ascension, spireBossId });
        if (authoritativeParty) {
            const bound = session as PartyBoundSession;
            bound.towerPartyId = authoritativeParty.id;
            bound.towerPartyLaunchRequestId = partyRequestId;
        }
        // Seal exact deploy-stable rules/reward data before the first engine read.
        // Spire tiers overlap Story floor IDs 1–15 and extend through 20, so
        // provenance is load-bearing for both action resolution and settlement.
        sealTowerCatalogFloor(session, floor, mode);
        initializeTowerActionVersion(session);
        sealPveDifficultyBand(session, { mode: 'TOWER', scaleHp: false, scaleStats: false });
        sealPveAiMastery(session, { mode: mode === 'spire' ? 'SPIRE' : 'TOWER' });
        startRound(session);
        runAiUntilHuman(session, floor, makeRng(seed));
        stampTurnClock(session, now);

        let chargedRyo = 0;
        let authoritativeCharacter: Record<string, unknown> | null = null;
        let saveVersion = 0;
        let entryReserved = false;
        const entryDay = new Date(now).toISOString().slice(0, 10);
        if (mode === 'story' && !identity.admin) {
            const entryFloor = sealedStoryFloorForSession(session);
            if (!entryFloor || entryFloor.id !== floorNum) {
                throw new Error('Story Tower entry floor was not sealed before reservation.');
            }
            const saveKey = `save:${hostName}`;
            let reservationWriteAttempted = false;
            const debit = await withKvLock(saveKey, async () => {
                const record = await kv.get<Record<string, unknown>>(saveKey);
                const character = record?.character as Record<string, unknown> | undefined;
                if (!record || !character) return { ok: false as const, status: 404, error: 'Your save was not found.' };
                if (authoritativeParty) {
                    const reserved = reserveTowerPartyEntry({
                        character,
                        partyId: authoritativeParty.id,
                        runId,
                        day: entryDay,
                        floorId: entryFloor.id,
                        now,
                    });
                    if (!reserved.ok) {
                        const error = reserved.code === 'insufficient-ryo'
                            ? `Entry costs ${reserved.required.toLocaleString()} ryo — not enough ryo.`
                            : 'The Tower entry receipt is invalid.';
                        return { ok: false as const, status: 409, error, errorCode: reserved.code };
                    }
                    const nextRecord = reserved.changed
                        ? bumpSaveVersion<Record<string, unknown>>({ ...record, character: reserved.character })
                        : record;
                    if (reserved.changed) {
                        reservationWriteAttempted = true;
                        await writeSaveProjected(saveKey, nextRecord, record);
                    }
                    return {
                        ok: true as const,
                        charged: reserved.charged,
                        counted: reserved.counted,
                        reserved: true,
                        character: reserved.character as Record<string, unknown>,
                        saveVersion: Number(nextRecord._saveVersion ?? 0),
                    };
                }
                const reserved = reserveTowerDirectEntry({
                    character,
                    runId,
                    day: entryDay,
                    floorId: entryFloor.id,
                    now,
                });
                if (!reserved.ok) {
                    const error = reserved.code === 'insufficient-ryo'
                        ? `Entry costs ${reserved.required.toLocaleString()} ryo — not enough ryo.`
                        : 'The Tower entry receipt is invalid.';
                    return { ok: false as const, status: 409, error, errorCode: reserved.code };
                }
                const nextRecord = reserved.changed
                    ? bumpSaveVersion<Record<string, unknown>>({ ...record, character: reserved.character })
                    : record;
                if (reserved.changed) {
                    reservationWriteAttempted = true;
                    await writeSaveProjected(saveKey, nextRecord, record);
                }
                return {
                    ok: true as const,
                    charged: reserved.charged,
                    counted: reserved.counted,
                    reserved: true,
                    character: reserved.character,
                    saveVersion: Number(nextRecord._saveVersion ?? 0),
                };
            }, { failClosed: true }).catch(error => {
                // A remote save write may commit before its acknowledgement is
                // lost. Preserve the minted run/lease so confirmed-missing
                // recovery can inspect and compensate the durable receipt;
                // reopening with a new run here could double-charge.
                if (reservationWriteAttempted) publicationInconclusive = true;
                throw error;
            });
            if (!debit.ok) {
                await releaseClaimedLease();
                if (preparedParty) {
                    await reopenTowerPartyLaunch(preparedParty.partyId, preparedParty.requestId);
                    preparedParty = null;
                }
                return res.status(debit.status).json({ error: debit.error, ...('errorCode' in debit ? { errorCode: debit.errorCode } : {}) });
            }
            chargedRyo = debit.charged;
            authoritativeCharacter = debit.character;
            saveVersion = debit.saveVersion;
            entryReserved = debit.reserved;
        }

        try {
            await writeSession(session);
            sessionPublished = true;
        } catch (publishError) {
            let published: TowerSession | null;
            try {
                published = await readSession(runId);
            } catch {
                publicationInconclusive = true;
                throw publishError;
            }
            if (published) {
                sessionPublished = true;
            } else if (entryReserved) {
                const saveKey = `save:${hostName}`;
                const compensation = await withKvLock(saveKey, async () => {
                    const record = await kv.get<Record<string, unknown>>(saveKey);
                    const character = record?.character as Record<string, unknown> | undefined;
                    if (!record || !character) throw new Error('Tower entry compensation save missing.');
                    let refunded: Record<string, unknown>;
                    if (authoritativeParty) {
                        const result = refundTowerPartyEntryReservation({ character, partyId: authoritativeParty.id, runId, now: Date.now() });
                        if (!result.ok) throw new Error(`Tower party entry compensation failed: ${result.code}`);
                        refunded = result.character as Record<string, unknown>;
                    } else {
                        const result = refundTowerDirectEntryReservation({ character, runId, now: Date.now() });
                        if (!result.ok) throw new Error(`Tower direct entry compensation failed: ${result.code}`);
                        refunded = result.character as Record<string, unknown>;
                    }
                    const nextRecord = bumpSaveVersion<Record<string, unknown>>({ ...record, character: refunded });
                    await writeSaveProjected(saveKey, nextRecord, record);
                    return { character: refunded, saveVersion: Number(nextRecord._saveVersion ?? 0) };
                }, { failClosed: true });
                authoritativeCharacter = compensation.character;
                saveVersion = compensation.saveVersion;
            }
            if (!published) throw publishError;
        }

        let activatedParty: StoredTowerParty | null = preparedView;
        if (preparedParty) {
            activatedParty = await activateTowerPartyLaunch(preparedParty.partyId, preparedParty.requestId, runId);
            for (const slug of towerBattleLeaseMembers(session)) if (slug !== hostName) await setTowerInvite(slug, runId).catch(() => undefined);
        }
        await recordTowerRunStarted(session);
        publishTowerStart(session, activatedParty);

        return res.status(200).json({
            runId,
            session,
            chargedRyo,
            replayed: false,
            ...(authoritativeParty ? { partyId: authoritativeParty.id, party: activatedParty ? towerPartyView(activatedParty) : null } : {}),
            ...(authoritativeCharacter ? { character: authoritativeCharacter, _saveVersion: saveVersion } : {}),
        });
    } catch (error) {
        if (preparedParty && !sessionPublished && !publicationInconclusive) {
            await reopenTowerPartyLaunch(preparedParty.partyId, preparedParty.requestId).catch(() => undefined);
        }
        if (!sessionPublished && !publicationInconclusive) {
            await releaseClaimedLease().catch(() => undefined);
        }
        console.error('[towers/start]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
