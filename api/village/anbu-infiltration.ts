import { withCombatAdmissionSave } from '../pve/_combat-admission-save.js';
import { handleStrongholdAction, strongholdVaultReady } from './_stronghold.js';
import { villageCampaignStronghold } from '../_village-war-campaign.js';
import { seatedKageOf } from '../_sector-war-garrison-defender.js';
import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { randomUUID, randomInt } from 'node:crypto';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { cors, safeName, clanRecordKey } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { legacyEnabled, bumpLegacyStats } from '../_legacy-track.js';
import { bumpEraContributionOnce } from '../_era.js';
import { reportMissionEvent, type CompletedMissionInfo } from '../missions/_progress.js';
import { withRosterEventContrib } from '../clan/_mission-catalog.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { isWarVillage, isWarSector, homeVillageForSector } from '../_war-map-sectors.js';
import { normalizeVillageWarRecord, sectorConfigFor, villageWarKey } from '../_war-state.js';
import { getSectorOwnerVillage } from '../_sector-war-store.js';
import { anbuInfiltrationEnabled } from '../_release-flags.js';
import {
    buildInfiltrationEncounter,
    infiltrationSessionMatches,
} from '../_anbu-infiltration-encounter.js';
import { sealedSectorWeather } from '../_sector-weather-seal.js';
import {
    readInfilRun,
    writeInfilRun,
    reserveInfilStartAttempt,
    loadAnbuAppointees,
    pickAnbuDefender,
    getOrSealAnbuSnapshot,
    settleInfiltrationWin,
    settleInfiltrationLoss,
    turnInCachesForSave,
    infilRunKey,
    infilActiveRunKey,
    INFIL_RUN_TTL,
    type InfilRun,
} from '../_anbu-infiltration-store.js';

async function deliverInfiltrationLegacy(
    playerName: string,
    runId: string,
    character?: Record<string, unknown> | null,
): Promise<boolean> {
    if (!legacyEnabled()) return true;
    const receiptId = `anbu-infiltration:${runId}`;
    const delivered = await bumpLegacyStats(
        playerName,
        { raidsCompleted: 1, warContribution: 500 },
        { receiptId, characterForBootstrap: character ?? null },
    );
    if (!delivered) return false;
    // bumpEraContributionOnce reports a failed era write as false instead of
    // throwing. The raid reward is already saved, so keeping the report
    // retryable costs the raider nothing, and the retry counts the war battle
    // exactly once.
    return bumpEraContributionOnce('warBattles', receiptId);
}
import { MAX_RAID_ATTEMPTS_PER_DAY, type WarPool } from '../_anbu-infiltration.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { hydrateCharacterFromSave, sealItemCharges } from '../pvp/session.js';
import { readSoloPveSession, repairSoloPveSessionPublication, soloPveSessionKey, writeSoloPveSession } from '../solo-pve/_store.js';
import { withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';
import { findTowerBattleStartConflict, towerBattleActiveErrorBody } from '../_tower-battle-guard.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { settleHeldFights } from '../pve/_held-fights.js';
import { ANBU_RAID_MIN_LEVEL } from '../../shared/sector-stronghold.js';
import { battleAuthorityKeys, battleEvidenceFrom, resolveBattleAuthority } from '../_realtime/battle-authority.js';
import { onlineStore } from '../_realtime/online-store.js';
import { withWorldBossPvpLock } from '../world-boss-event/_pvp-protection.js';

/*
 * /api/village/anbu-infiltration — POST only. The Anbu Vault Infiltration raid
 * (docs/anbu-infiltration-plan.md): a level-100 sector-attrition activity, fully
 * server-authoritative, one route with an action switch (the sector-war.ts shape).
 *
 * Actions (body.action):
 *   - start   : gate-check, pick + daily-seal the defending Anbu, build the vault
 *               Solo PvE fight against a sealed REAL defender snapshot).
 *   - act     : retired compatibility action; combat intents go to /solo-pve/action.
 *   - state   : read-only run fetch (refresh-restore).
 *   - report  : settle a FINISHED run. Win → server-rolled skim of the enemy war
 *               economy (both 50%/day ledgers enforced inside pool locks), caches +
 *               ryo minted under the save lock. Loss persists proven usage and
 *               terminal character state without a reward. Idempotent.
 *   - turn-in : convert held caches into standing points, type-locked (War Supply →
 *               clan 2:1, War Resource → village merit 1:1).
 *
 * LIVE by default — no opt-in flag. Set DISABLE_ANBU_INFILTRATION=1 only as an
 * emergency kill switch. Runs on the base war map (a sector with no seeded
 * world:territory owner falls back to its home village, so it works before any
 * sector-war capture), and defends with the village's appointed Anbu or, if none
 * are appointed yet, its seated Kage. NEVER flips sector ownership; conquest
 * stays with /village/sector-war.
 */

type Identity = NonNullable<Awaited<ReturnType<typeof authedPlayerOrAdmin>>>;

async function resumePreparedCombat(playerName: string, session: Awaited<ReturnType<typeof readSoloPveSession>>): Promise<boolean> {
    if (!session) return false;
    const admission = await withWorldBossPvpLock([playerName], async () => {
        const presence = onlineStore.get(playerName);
        if (presence?.pendingAttacker || (presence?.travelingUntil ?? 0) > Date.now()) return false;
        const evidence = battleEvidenceFrom(await kv.mget(...battleAuthorityKeys(playerName)));
        const authority = await resolveBattleAuthority(playerName, evidence);
        const projection = evidence.battleState as { kind?: string; sessionId?: string } | null;
        if (authority.inBattle && !(authority.source === 'solo-pve' && projection?.sessionId === session.sessionId)) return false;
        await repairSoloPveSessionPublication(session.sessionId);
        return true;
    });
    return admission.ok && admission.value;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!anbuInfiltrationEnabled()) {
        return res.status(404).json({ error: 'Not found.' });
    }

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = String(body.action ?? '');
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act as yourself.' });
        }

        if (action.startsWith('stronghold-')) {
            if (!await enforceRateLimitKv(req, res, 'stronghold-walk', 600, 60_000, playerName)) return;
            const result = await handleStrongholdAction(playerName, action, body);
            return res.status(result.status).json(result.body);
        }

        switch (action) {
            case 'start': return await doStart(req, res, identity, playerName, body);
            case 'act': return res.status(410).json({ error: 'ANBU combat actions moved to /api/solo-pve/action.', code: 'anbu-solo-pve-cutover' });
            case 'state': return await doState(res, identity, playerName, body);
            case 'recover': return await doRecover(res, identity, playerName, body);
            case 'report': return await doReport(req, res, identity, playerName, body);
            case 'turn-in': return await doTurnIn(req, res, identity, playerName, body);
            default: return res.status(400).json({ error: 'Unknown action.' });
        }
    } catch (err) {
        console.error('[village/anbu-infiltration]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

// ── start ─────────────────────────────────────────────────────────────────────
async function doStart(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'anbu-infil-start', 10, 60_000, identity.name))) return;
    if (!identity.admin && await findTowerBattleStartConflict([playerName])) {
        return res.status(409).json(towerBattleActiveErrorBody());
    }
    const sector = Math.floor(Number(body.sector) || 0);
    if (!sector) return res.status(400).json({ error: 'Missing sector.' });

    // The raider: save exists, level 100+, belongs to a village.
    let rec = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
    let char = rec?.character as Record<string, unknown> | undefined;
    if (!char) return res.status(404).json({ error: 'Your save was not found.' });
    const level = Math.floor(Number(char.level) || 0);
    if (!identity.admin && level < ANBU_RAID_MIN_LEVEL) {
        return res.status(403).json({ error: `Anbu infiltration requires level ${ANBU_RAID_MIN_LEVEL}.` });
    }
    const raiderVillage = String(char.village ?? '').trim();
    if (await villageCampaignStronghold(raiderVillage, sector)) return res.status(409).json({ error: 'This is a village war objective. Use its nominated battle mode to attack the ANBU defense.' });
    if (!raiderVillage) return res.status(403).json({ error: 'You must belong to a village.' });

    // The target: an enemy-held war sector. Prefer the live captured owner; fall
    // back to the sector's HOME village when world:territory isn't seeded yet, so
    // infiltration works on the base war map before any sector-war has run.
    if (!isWarSector(sector)) return res.status(400).json({ error: 'That sector is not a war sector.' });
    const targetVillage = (await getSectorOwnerVillage(sector)) || (homeVillageForSector(sector) ?? '');
    if (!targetVillage || !isWarVillage(targetVillage)) return res.status(409).json({ error: 'That sector is not held by a war village.' });
    if (targetVillage === raiderVillage) return res.status(400).json({ error: 'You cannot infiltrate your own village’s sector.' });

    // Defenders: the village's appointed Anbu, or — if none are appointed yet —
    // its seated Kage (also a real appointed leader). Either way the defender is
    // a real player's sealed loadout, shown behind the village's Anbu mask.
    let appointees = await loadAnbuAppointees(targetVillage);
    if (appointees.length === 0) {
        const kage = await seatedKageOf(targetVillage);
        if (kage) appointees = [kage];
    }
    if (appointees.length === 0) {
        return res.status(409).json({ error: 'That village has no Anbu or Kage to defend its vault yet.' });
    }

    // Defender home-terrain edge: the sector's Kage-set terrain seals in as the
    // fight biome (identical mechanic to sector-war's terrain seal).
    const defRec = normalizeVillageWarRecord(targetVillage, (await kv.get<Record<string, unknown>>(villageWarKey(targetVillage))) ?? undefined);
    const terrain: string = sectorConfigFor(defRec, sector).terrain;

    const hospitalized = { status: 409 as const, body: { error: 'You are in the hospital. Recover before starting a fight.', errorCode: 'hospitalized' } };
    const activeKey = infilActiveRunKey(playerName, sector);
    const started = await withKvLock(activeKey, async () => {
        const activeRunId = await kv.get<string>(activeKey);
        if (activeRunId) {
            const activeRun = await readInfilRun(activeRunId);
            let activeSession = await readSoloPveSession(activeRunId);
            const resumable = Boolean(activeRun
                && !activeRun.settlement
                && activeRun.sector === sector
                && activeRun.targetVillage === targetVillage
                && infiltrationSessionMatches(activeRun, activeSession));
            if (resumable && activeRun && activeSession) {
                if (activeRun.startState === 'prepared' && !await resumePreparedCombat(playerName, activeSession)) {
                    return { status: 409 as const, body: { error: 'Finish your current battle or leave its queue before recovering this infiltration.' } };
                }
                activeSession = await readSoloPveSession(activeRunId);
                if (!infiltrationSessionMatches(activeRun, activeSession)) return { status: 409 as const, body: { error: 'The infiltration combat binding is invalid.' } };
                const attempt = identity.admin || activeRun.startState === 'ready'
                    ? { allowed: true, replayed: true, count: 0 }
                    : await reserveInfilStartAttempt(playerName, activeRun.runId, MAX_RAID_ATTEMPTS_PER_DAY, { now: () => activeRun.createdAt });
                if (!attempt.allowed) {
                    await kv.del(activeKey, infilRunKey(activeRunId), soloPveSessionKey(activeRunId));
                    return { status: 429 as const, body: { error: 'Daily infiltration limit reached.' } };
                }
                if (activeRun.startState !== 'ready') {
                    await writeInfilRun({ ...activeRun, startState: 'ready' });
                }
                await kv.set(activeKey, activeRunId, { ex: INFIL_RUN_TTL });
                return { status: 200 as const, body: {
                    ok: true,
                    replayed: true,
                    runId: activeRunId,
                    sector,
                    targetVillage,
                    anbu: { name: activeRun.anbuName },
                    session: activeSession,
                } };
            }
            await kv.del(activeKey);
        }

        // A run already on the board resumes above; a NEW one is not sealed for
        // a hospitalized raider, and no daily attempt is spent refusing it.
        if (!identity.admin && isIncapacitated(char)) return hospitalized;

        if (!identity.admin && !await strongholdVaultReady(playerName, sector)) {
            return { status: 409 as const, body: { error: 'Reach the Anbu inside the stronghold and clear any patrol first.' } };
        }

        // Every fight this player is holding is settled before the raid is
        // sealed from the save, so it is never fought on HP an earlier fight
        // already spent (api/pve/_held-fights.ts). It runs after the stronghold
        // check, so a raid refused there ends no open fight.
        const held = await settleHeldFights(playerName);
        if (!held.ok) return { status: held.status, body: { error: held.error, errorCode: held.reason } };
        if (held.settled > 0) {
            rec = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${playerName}`));
            char = rec?.character as Record<string, unknown> | undefined;
        }
        if (!char) throw new Error('Player save vanished while held fights were settled.');
        // A held fight settled just now can be the defeat that admits them.
        if (held.settled > 0 && !identity.admin && isIncapacitated(char)) return hospitalized;

        // Seal both sides through the canonical server hydrator. Client-computed
        // loadout fields are deliberately ignored; equipped content and passives
        // resolve from the authoritative save and admin catalogs.
        const adminCombatContent = await loadAdminCombatContent();

        // Defender: least-recently-defended Anbu, sealed daily from their save.
        const anbuSlug = await pickAnbuDefender(targetVillage, appointees);
        const snapshot = anbuSlug ? await getOrSealAnbuSnapshot(targetVillage, anbuSlug) : null;
        if (!anbuSlug || !snapshot) {
            return { status: 409 as const, body: { error: 'No defending Anbu could be prepared — try again shortly.' } };
        }

        const runId = `infil-${randomUUID().replace(/-/g, '')}`;
        const now = Date.now();
        const shortVillage = targetVillage.replace(/\s+Village$/i, '').trim();
        const maskedAnbuName = `The ${shortVillage || 'Village'} Anbu`;
        const run: InfilRun = {
            runId, raiderSlug: playerName, sector, targetVillage,
            anbuSlug: snapshot.slug, anbuName: maskedAnbuName, terrain,
            createdAt: now,
            startState: 'prepared',
        };

        // Persist a resumable prepared run before consuming the daily attempt.
        const commit = () => withCombatAdmissionSave(playerName, async (fresh) => {
            if (!identity.admin && !await strongholdVaultReady(playerName, sector)) {
                return { status: 409 as const, body: { error: 'Reach the Anbu inside the stronghold and clear any patrol first.' } };
            }
            rec = await augmentSaveWithForgedDefs(fresh);
            char = rec?.character as Record<string, unknown> | undefined;
            if (!char) throw new Error('Player save vanished at infiltration admission.');
            if (!identity.admin && isIncapacitated(char)) return hospitalized;
            const raiderCharacter = hydrateCharacterFromSave(char, {}, rec ?? null, adminCombatContent);
            const session = buildInfiltrationEncounter({
                runId, now,
                raider: { slug: playerName, name: String(char.name ?? playerName), character: raiderCharacter, itemCharges: sealItemCharges(raiderCharacter, char) },
                anbu: { slug: snapshot.slug, name: maskedAnbuName, character: snapshot.character },
                terrain, sector, targetVillage,
                weather: await sealedSectorWeather(sector, now),
            });
            await writeInfilRun(run);
            await kv.set(activeKey, runId, { ex: INFIL_RUN_TTL });
            await writeSoloPveSession(session);
            const attempt = identity.admin
                ? { allowed: true, replayed: false, count: 0 }
                : await reserveInfilStartAttempt(playerName, runId, MAX_RAID_ATTEMPTS_PER_DAY, { now: () => run.createdAt });
            if (!attempt.allowed) {
                await kv.del(activeKey, infilRunKey(runId), soloPveSessionKey(runId));
                return { status: 429 as const, body: { error: 'Daily infiltration limit reached.' } };
            }
            await writeInfilRun({ ...run, startState: 'ready' });
            return { status: 200 as const, body: {
                ok: true, replayed: attempt.replayed, runId, sector, targetVillage,
                anbu: { name: maskedAnbuName }, session,
            } };
        });
        const admission = identity.admin ? { ok: true as const, value: await commit() } : await withWorldBossPvpLock([playerName], commit);
        return admission.ok ? admission.value : { status: 409 as const, body: { error: 'Leave the world boss queue or finish its fight before challenging the Anbu.' } };
    }, { failClosed: true, ttlSec: 30 });
    return res.status(started.status).json(started.body);
}

/** Recover an admitted raid when the browser never received its run ID. */
async function doRecover(res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const sector = Number(body.sector);
    if (!Number.isInteger(sector) || !isWarSector(sector)) return res.status(400).json({ error: 'That sector has no Anbu raid.' });
    const activeKey = infilActiveRunKey(playerName, sector);
    const reply = await withKvLock(activeKey, async () => {
        const runId = await kv.get<string>(activeKey);
        const run = runId ? await readInfilRun(runId) : null;
        if (!run) return { status: 404, body: { error: 'Run not found or expired.' } };
        if (run.raiderSlug !== playerName || run.sector !== sector) return { status: 403, body: { error: 'Not your run.' } };
        let session = await readSoloPveSession(run.runId);
        if (!session && run.startState === 'prepared') {
            // A context staged before combat publication spent no attempt.
            await kv.del(activeKey, infilRunKey(run.runId));
            return { status: 404, body: { error: 'Run not found or expired.' } };
        }
        if (!infiltrationSessionMatches(run, session)) return { status: 409, body: { error: 'The infiltration combat binding is invalid.' } };
        if (run.startState === 'prepared') {
            // Repair an interrupted first combat write before finishing admission.
            if (!await resumePreparedCombat(playerName, session)) return { status: 409, body: { error: 'Finish your current battle or leave its queue before recovering this infiltration.' } };
            session = await readSoloPveSession(run.runId);
            if (!infiltrationSessionMatches(run, session)) return { status: 409, body: { error: 'The infiltration combat binding is invalid.' } };
            const attempt = identity.admin ? { allowed: true } : await reserveInfilStartAttempt(playerName, run.runId,
                MAX_RAID_ATTEMPTS_PER_DAY, { now: () => run.createdAt });
            if (!attempt.allowed) {
                await kv.del(activeKey, infilRunKey(run.runId), soloPveSessionKey(run.runId));
                return { status: 429, body: { error: 'Daily infiltration limit reached.' } };
            }
            await writeInfilRun({ ...run, startState: 'ready' });
        }
        return { status: 200, body: { ok: true, runId: run.runId, sector: run.sector, targetVillage: run.targetVillage,
            anbu: { name: run.anbuName }, session } };
    }, { failClosed: true, ttlSec: 30 });
    return res.status(reply.status).json(reply.body);
}

// ── state (read-only refresh-restore) ─────────────────────────────────────────
async function doState(res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    const runId = String(body.runId ?? '');
    if (!runId) return res.status(400).json({ error: 'Missing runId.' });
    const run = await readInfilRun(runId);
    if (!run) return res.status(404).json({ error: 'Run not found or expired.' });
    if (!identity.admin && run.raiderSlug !== playerName) return res.status(403).json({ error: 'Not your run.' });
    const session = await readSoloPveSession(runId);
    if (!infiltrationSessionMatches(run, session)) return res.status(409).json({ error: 'The infiltration combat binding is invalid.' });
    return res.status(200).json({ ok: true, runId, sector: run.sector, targetVillage: run.targetVillage, anbu: { name: run.anbuName }, session });
}

// ── report (settle a finished run — the ONLY reward path) ─────────────────────
async function doReport(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'anbu-infil-report', 10, 60_000, identity.name))) return;
    const runId = String(body.runId ?? '');
    if (!runId) return res.status(400).json({ error: 'Missing runId.' });

    return withKvLock(infilRunKey(runId), () => doReportLocked(res, identity, playerName, runId), { failClosed: true, ttlSec: 30 });
}

async function doReportLocked(res: VercelResponse, identity: Identity, playerName: string, runId: string) {
    const run = await readInfilRun(runId);
    if (!run) return res.status(404).json({ error: 'Run not found or expired.' });
    if (!identity.admin && run.raiderSlug !== playerName) return res.status(403).json({ error: 'Not your run.' });
    if (run.settlement) {
        if (run.settlement.response?.won === true && !await deliverInfiltrationLegacy(
            playerName,
            runId,
            run.settlement.response.character as Record<string, unknown> | undefined,
        )) {
            return res.status(503).json({
                error: 'The raid is safe, but its Legacy record is still being sealed. Retry the same run.',
                code: 'legacy-delivery-pending',
                retryable: true,
            });
        }
        return res.status(200).json(run.settlement.response);
    }
    const session = await readSoloPveSession(runId);
    if (!infiltrationSessionMatches(run, session)) return res.status(409).json({ error: 'The infiltration combat binding is invalid.' });
    if (session.status !== 'done' || !session.terminalEvidence) return res.status(409).json({ error: 'The fight is not finished.' });

    if (session.outcome !== 'win') {
        // The Anbu held. No reward, no drain — the vault stands.
        const loss = await settleInfiltrationLoss(run, session);
        if (!loss.ok) {
            return loss.error === 'no-save'
                ? res.status(404).json({ error: 'Your save was not found.' })
                : res.status(409).json({ error: 'The settlement receipt conflicts with this raid.' });
        }
        const settledAt = Date.now();
        await writeSoloPveSession(withSoloPveSettlementReceipt(session, {
            kind: 'anbu-infiltration', id: runId, settledAt, rewards: { won: false },
        }));
        const response = {
            ok: true,
            won: false,
            alreadySettled: false,
            character: loss.character,
            _saveVersion: loss.saveVersion,
        };
        await writeInfilRun({ ...run, settlement: { settledAt, response } });
        return res.status(200).json(response);
    }

    // Server-side roll — the client never picks the pool, the outcome, or amounts.
    const roll = randomInt(0, 1_000_000_000) / 1_000_000_000;
    const out = await settleInfiltrationWin(run, roll, {}, session);
    if (!out.ok) {
        if (out.error === 'no-save') return res.status(404).json({ error: 'Your save was not found.' });
        return res.status(503).json({
            ok: false,
            error: 'The raid succeeded but the reward could not be saved. An admin can reconcile it — please do not retry.',
        });
    }
    const settledAt = Date.now();
    await writeSoloPveSession(withSoloPveSettlementReceipt(session, {
        kind: 'anbu-infiltration',
        id: runId,
        settledAt,
        rewards: {
            won: true,
            supplyCaches: out.supplyCaches,
            wrCaches: out.wrCaches,
            ryo: out.ryo,
        },
    }));

    const economicResponse = {
        ok: true, won: true, alreadySettled: false,
        rolled: out.rolled,
        supplySkim: out.supplySkim, wrSkim: out.wrSkim,
        supplyCaches: out.supplyCaches, wrCaches: out.wrCaches,
        ryo: out.ryo, overflowLost: out.overflowLost,
        character: out.character,
        missionsCompleted: [] as CompletedMissionInfo[], missionXp: 0,
        _saveVersion: out.saveVersion,
    };
    // Persist the replayable response before non-economic hooks or the HTTP
    // response. A lost response can now return the exact paid result for seven days.
    await writeInfilRun({ ...run, settlement: { settledAt, response: economicResponse } });

    // ── Mission / legacy / clan hooks (docs plan §9) ──────────────────────────
    // All run AFTER the authoritative settle, and no hook failure may unwind the
    // paid reward. An infiltration win is a server-proofed raid:
    //   • Vanguards progress their 'vanguard-raids' daily missions (best-effort).
    //   • The raider's clan gets +1 eventContrib, which feeds the EXISTING clan
    //     'raid' mission (progress = eventContrib/3) and 'training' (best-effort).
    //   • Legacy (the L100 system) credits raidsCompleted + warContribution and
    //     the era's warBattles, as a sector-war battle does. These land last;
    //     until they do, the report answers a retryable 503 and a retry replays
    //     the saved settlement.
    let missionsCompleted: CompletedMissionInfo[] = [];
    let missionXp = 0;
    try {
        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const char = save?.character as Record<string, unknown> | undefined;
        if (char?.profession === 'vanguard') {
            const missionRes = await reportMissionEvent({ playerName, profession: 'vanguard', kind: 'vanguard-raids' });
            missionsCompleted = missionRes.missionsCompleted;
            missionXp = missionRes.xpAwarded;
        }
        const clan = String(char?.clan ?? '').trim();
        if (clan) {
            await withKvLock(clanRecordKey(clan), async () => {
                const key = clanRecordKey(clan);
                const rec = await kv.get<Record<string, unknown>>(key);
                if (!rec) return;
                const members = Array.isArray(rec.members) ? [...(rec.members as Record<string, unknown>[])] : [];
                const i = members.findIndex(m => safeName(String((m as Record<string, unknown>)?.name ?? '')) === playerName);
                if (i < 0) return;
                // A stale row restarts this month at zero, so the credit counts
                // toward this month's clan missions (economy rebalance 2026-10, I-15).
                members[i] = withRosterEventContrib(members[i] as Record<string, unknown>, 1, Date.now());
                await kv.set(key, { ...rec, members });
            }); // default lock semantics — contrib is a counter, not currency
        }
    } catch (hookErr) {
        console.error('[village/anbu-infiltration] post-win hooks (non-fatal)', hookErr);
    }

    const response = { ...economicResponse, missionsCompleted, missionXp };
    await writeInfilRun({ ...run, settlement: { settledAt, response } });
    if (legacyEnabled() && !await deliverInfiltrationLegacy(playerName, runId, out.character)) {
        return res.status(503).json({
            error: 'The raid is safe, but its Legacy record is still being sealed. Retry the same run.',
            code: 'legacy-delivery-pending',
            retryable: true,
        });
    }
    return res.status(200).json(response);
}

// ── turn-in (caches → standing points, type-locked) ───────────────────────────
async function doTurnIn(req: VercelRequest, res: VercelResponse, identity: Identity, playerName: string, body: Record<string, unknown>) {
    if (!identity.admin && !(await enforceRateLimitKv(req, res, 'anbu-infil-turnin', 20, 60_000, identity.name))) return;
    const cacheRaw = String(body.cache ?? '');
    if (cacheRaw !== 'warSupply' && cacheRaw !== 'warResources') {
        return res.status(400).json({ error: 'Invalid cache type.' });
    }
    const cache = cacheRaw as WarPool;
    const countRaw = Number(body.count);
    const count = Number.isFinite(countRaw) && countRaw > 0 ? Math.floor(countRaw) : undefined;

    const out = await turnInCachesForSave({ playerName, cache, count });
    if (!out.ok) {
        if (out.error === 'no-save') return res.status(404).json({ error: 'Your save was not found.' });
        if (out.error === 'not-in-clan') return res.status(403).json({ error: 'You are not in a clan.' });
        // nothing-to-turn-in / cap-reached are normal game states, not errors.
        return res.status(200).json({ ok: false, reason: out.error });
    }
    return res.status(200).json({
        ok: true, dest: out.dest, points: out.points, consumed: out.consumed,
        remaining: out.remaining, _saveVersion: out.saveVersion,
    });
}
