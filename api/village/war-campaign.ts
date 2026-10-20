import { randomUUID, randomInt } from 'node:crypto';
import { safeLogValue } from '../_safe-log.js';
import { campaignSupportTiers, campaignPreparationContext, recordPreparationAttack } from '../_war-preparations.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { campaignWarPlayable, mutateCampaignWar, awardCampaignBattle, type CampaignWarRow } from '../_village-war-campaign.js';
import { campaignView, campaignObjectiveAvailable, reserveCampaignOperation, updateShrineControl, advanceCampaign, WAR_OPERATIONS,
    campaignDay, type WarBattleMode, type WarOperation } from '../../shared/village-war-campaign.js';
import { maskedGarrisonDefenderName } from '../_sector-war-garrison-defender.js';
import { campaignAnbuAvatar, fieldCampaignAnbu, sealCampaignAnbuCombat, sealCampaignAnbuTeam } from '../_village-war-anbu-defender.js';
import { STANDARD_PVE_AI_POLICY } from '../solo-pve/_ai-turn-policy.js';
import { buildGarrisonEncounter } from '../_sector-war-garrison-encounter.js';
import { sealWarTeam } from '../_pet-showdown/war-team.js';
import { resolveWarDuel, type WarDuelInput } from '../_pet-showdown/war-duel.js';
import { replayFromOpposingSide } from '../_pet-showdown/_viewer-replay.js';
import { resolveChronicleDeckMutation, resolveChronicleDeckWithSave } from '../card-clash/_deck.js';
import { createAiMatch, applyPlayerAction, projectAiMatch, type AiMatchSession } from '../card-clash/_ai-engine.js';
import { createMatch, applyAction, advanceExpiredChronicleTurn, projectMatchForViewer,
    type ChronicleMatch, type ChronicleActionIntent } from '../../shared/chronicle-duel.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import type { SoloPveSession } from '../solo-pve/_session.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { settleHeldFights } from '../pve/_held-fights.js';
import { settlePveFightOutcome } from '../pve/_fight-outcome-settlement.js';
import { combatMissionByKey } from '../missions/_mission-catalog.js';
import { missionEnemyTemplate } from '../_authoritative-pve.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { hydrateCharacterFromSave, sealItemCharges, type PvpSession } from '../pvp/session.js';
import pvpHandler from '../pvp/session.js';
import { saveChallengeRecord } from '../pvp/_challenge-authorization.js';
import { loadPvpPendingSessionPointer, publishPvpPendingSessionPointers } from '../pvp/_pending-session.js';
import { projectChallengerCharacter } from '../player/challenge.js';
import { kickPlayer } from '../_realtime/notify.js';
import { pushOfflineNotice } from '../player/_offline-notices.js';
import { onlineStore } from '../_realtime/online-store.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { strongholdLocation, touchStrongholdPresence, leaveStrongholdPresence } from '../_stronghold-presence.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { VILLAGE_BIOME, isWarVillage } from '../_war-map-sectors.js';
import { shrineRoomLocation, touchShrineRoom, leaveShrineRoom, shrineRoomPlayers, renewShrineCombatPresence, confirmShrineRoomVillage } from '../_village-war-shrine-presence.js';
import { applyShrineClosingControl, scheduleShrineClosing } from '../_village-war-shrine-closing.js';
import { fieldOperationAction, fieldMissionFor, projectFieldMission, guardStrongholdAction } from '../_village-war-field-operations.js';
import { getSectorOwnerVillage } from '../_sector-war-store.js';

const RETAIN = 14 * 86_400;
const DEFENSE_TTL = 86_400;
interface CampaignRun {
    id: string; warId: string; generation: number; objectiveId?: string; operation?: WarOperation;
    mode: WarBattleMode; attacker: string; defender: string; attackerVillage: string; defenderVillage: string;
    npc: boolean; createdAt: number; status: 'prepared' | 'active' | 'done';
    pet?: WarDuelInput; petWinner?: 'from' | 'to';
    card?: ChronicleMatch; aiCard?: AiMatchSession; battleId?: string;
    result?: { scored: boolean; points: number }; saveVersion?: number; endedAt?: number;
    fieldMissionId?: string;
}
interface Defense { player: string; village: string; objectiveId: string; seenAt: number; }
const runKey = (id: string) => `village-campaign-run:${id}`;
const defensePrefix = (war: CampaignWarRow) => `village-campaign-defense:${war.id}:g${war.declarationGeneration}:`;
const activeKey = (war: CampaignWarRow, player: string) => `village-campaign-active:${war.id}:g${war.declarationGeneration}:${player}`;
/** A player-facing refusal: its message is safe to return verbatim. */
export class WarCampaignRefusal extends Error {
    constructor(message: string) { super(message); this.name = 'WarCampaignRefusal'; }
}
function refuse(message: string): never { throw new WarCampaignRefusal(message); }

export const WAR_CAMPAIGN_BUSY_MESSAGE = 'Village war is busy. Please retry.';
// The shared war helpers (_village-war-campaign.ts, _village-war-field-
// operations.ts) refuse with a plain `new Error('One player-facing sentence.')`.
// Only that exact shape is echoed; anything else (a lock-contention error that
// names its KV key, a storage/driver/runtime error, a TypeError) is logged and
// answered with the generic busy message so internals never reach the client.
const PLAYER_SENTENCE = /^[A-Z][A-Za-z0-9 ,.'’!?()-]{2,159}[.!?]$/;
export function warCampaignErrorMessage(error: unknown): { message: string; internal: boolean } {
    if (error instanceof WarCampaignRefusal) return { message: error.message, internal: false };
    if (error instanceof Error && Object.getPrototypeOf(error) === Error.prototype
        && !('code' in error) && PLAYER_SENTENCE.test(error.message)) {
        return { message: error.message, internal: false };
    }
    return { message: WAR_CAMPAIGN_BUSY_MESSAGE, internal: true };
}
async function notify(to: string, notice: Record<string, unknown>) {
    const key = `challenges:${to}`;
    await withKvLock(key, async () => {
        const notices = await kv.get<Record<string, unknown>[]>(key) ?? [];
        if (!notices.some(n => n.id === notice.id)) await kv.set(key, [...notices, notice].slice(-20), { ex: 600 });
    }, { failClosed: true });
    kickPlayer(to, 'challenge');
}
async function legalDeck(slug: string): Promise<string[] | null> {
    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${slug}`);
    if (!save?.character) return null;
    const deck = resolveChronicleDeckMutation(save.character, []);
    return deck.ok ? deck.value.deck : null;
}
async function shrineRoster(war: CampaignWarRow, sector: number) {
    const candidates = shrineRoomPlayers(war, sector);
    const saves = await Promise.all(candidates.map(({ player }) => kv.get<{ character?: Record<string, unknown> }>(`save:${player.name}`)));
    return candidates.flatMap(({ player, tile }, index) => {
        const character = saves[index]?.character, village = String(character?.village ?? '');
        const eligible = !!character && war.villages.includes(village) && Number(character.level) >= 15 && !isIncapacitated(character);
        confirmShrineRoomVillage(player.name, eligible ? village : undefined);
        return eligible ? [{ name: player.name, displayName: String(character!.name ?? player.displayName), village, tile, inBattle: !!player.inBattle }] : [];
    });
}
async function shrineOpponent(war: CampaignWarRow, objectiveId: string, enemy: string, target?: string): Promise<Defense | null> {
    const objective = war.campaign!.shrine.find(o => o.id === objectiveId)!;
    for (const player of await shrineRoster(war, objective.sector)) {
        if (player.village !== enemy || player.inBattle || (target && player.name !== safeName(target))) continue;
        if (await loadPvpPendingSessionPointer(kv, player.name)) continue;
        const active = await kv.get<string>(activeKey(war, player.name));
        const run = await refreshCombatRun(active ? await kv.get<CampaignRun>(runKey(active)) : null);
        if (run && run.status !== 'done') continue;
        return { player: player.name, village: enemy, objectiveId, seenAt: Date.now() };
    }
    return null;
}
// Call with the run lock held. Combat owns its terminal state; campaign polling
// must not be required to release a completed attack or defense assignment.
async function syncCompletedCombat(run: CampaignRun): Promise<CampaignRun> {
    if (run.mode !== 'combat' || run.npc || !run.battleId || (run.status === 'done' && run.result)) return run;
    const combat = await kv.get<{ status: string; winner?: string; endedAt?: number }>(`pvp:${run.battleId}`);
    if (combat?.status !== 'done') return run;
    if (combat.winner !== 'p1' && combat.winner !== 'p2') {
        await scoreRun(run, 'draw', combat.endedAt ?? Date.now());
        return run;
    }
    const war = await kv.get<CampaignWarRow>(`world:war:${run.warId}`);
    const receipt = war?.declarationGeneration === run.generation ? war.campaign?.receipts[`combat:${run.battleId}`] : undefined;
    run.status = 'done';
    if (receipt) run.result = { scored: receipt.points > 0, points: receipt.points };
    await kv.set(runKey(run.id), run, { ex: RETAIN });
    await kv.delIfEqual(`village-campaign-assigned:${run.defender}`, run.id);
    return run;
}
async function refreshCombatRun(run: CampaignRun | null): Promise<CampaignRun | null> {
    if (!run || run.mode !== 'combat' || run.npc || (run.status === 'done' && run.result)) return run;
    return withKvLock(runKey(run.id), async () => {
        const current = await kv.get<CampaignRun>(runKey(run.id));
        return current ? syncCompletedCombat(current) : null;
    }, { failClosed: true });
}
async function chooseDefense(war: CampaignWarRow, objectiveId: string, enemy: string, mode: WarBattleMode): Promise<Defense | null> {
    const keys = await kv.keys(`${defensePrefix(war)}*`);
    const rows = keys.length ? await kv.mget<Defense[]>(...keys) : [];
    for (const row of rows.filter((r): r is Defense => !!r && r.village === enemy && r.objectiveId === objectiveId && Date.now() - r.seenAt < DEFENSE_TTL * 1000)
        .sort((a, b) => a.seenAt - b.seenAt)) {
        const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${row.player}`);
        const presence = onlineStore.get(row.player);
        if (!presence || !save?.character || save.character.village !== enemy || !(Number(save.character.level) >= 15) || isIncapacitated(save.character)
            || presence?.inBattle || (presence?.travelingUntil ?? 0) > Date.now()) continue;
        if (await loadPvpPendingSessionPointer(kv, row.player)) continue;
        if (mode === 'pet' && !(await sealWarTeam(row.player))?.length) continue;
        if (mode === 'card' && !(await legalDeck(row.player))) continue;
        const active = await kv.get<string>(activeKey(war, row.player));
        const attacking = await refreshCombatRun(active ? await kv.get<CampaignRun>(runKey(active)) : null);
        if (attacking && attacking.status !== 'done') continue;
        // One assignment per defender, across all modes/objectives.
        const assignment = await kv.get<string>(`village-campaign-assigned:${row.player}`);
        if (assignment) {
            const prior = await refreshCombatRun(await kv.get<CampaignRun>(runKey(assignment)));
            if (prior && prior.warId === war.id && prior.generation === war.declarationGeneration && prior.status !== 'done') continue;
            await kv.delIfEqual(`village-campaign-assigned:${row.player}`, assignment);
        }
        return row;
    }
    return null;
}
async function projectRun(run: CampaignRun, me: string) {
    const side = me === run.attacker ? 'p1' : 'p2';
    let session: unknown;
    if (run.card) session = projectMatchForViewer(run.card, side);
    if (run.aiCard) session = projectAiMatch(run.aiCard);
    if (run.mode === 'combat' && run.npc) session = await readSoloPveSession(run.id);
    if (run.pet) session = { status: run.status, winner: run.petWinner === 'from' ? 'p1' : 'p2',
        p1: { name: run.attacker, pet: run.pet.fromPets[0] }, p2: { name: run.pet.toName, pet: run.pet.toPets[0] }, seed: run.pet.seed };
    return { runId: run.id, mode: run.mode, npc: run.npc, status: run.status, battleId: run.battleId,
        session, warResult: run.result, ...(run.saveVersion === undefined ? {} : { _saveVersion: run.saveVersion }) };
}
async function scoreRun(run: CampaignRun, winner: 'p1' | 'p2' | 'draw', at: number): Promise<void> {
    const result = await mutateCampaignWar(run.warId, async war => {
        if (war.declarationGeneration !== run.generation || !war.campaign?.admissions[run.id]) refuse('This battle belongs to another war.');
        const receipt = run.fieldMissionId ? `field:${run.fieldMissionId}` : `run:${run.id}`;
        war.campaign!.admissions[run.id].finished = true;
        const field = run.fieldMissionId ? war.campaign!.admissions[run.fieldMissionId]?.field : undefined;
        if (field?.status === 'active' && field.battleRunId === run.id) {
            field.status = winner === 'p1' && at < war.campaign!.endsAt && !war.endedAt ? 'complete' : 'failed'; field.finishedAt = at;
            war.campaign!.admissions[field.id].finished = true;
        }
        if (war.campaign!.receipts[receipt]) return { row: war, value: war.campaign!.receipts[receipt].points };
        if (winner === 'draw' || (run.npc && winner !== 'p1')) {
            war.campaign!.receipts[receipt] = { points: 0, village: run.attackerVillage, player: run.attacker, at };
            return { row: war, value: 0 };
        }
        const village = winner === 'p1' ? run.attackerVillage : run.defenderVillage;
        const player = winner === 'p1' ? run.attacker : run.defender;
        const awarded = awardCampaignBattle(war, { receipt, village, player, createdAt: run.createdAt, at,
            objectiveId: run.objectiveId, pve: run.npc, operation: run.operation }, player);
        return { row: awarded.row, value: awarded.points };
    });
    run.status = 'done'; run.result = { scored: result > 0, points: result };
    await kv.set(runKey(run.id), run, { ex: RETAIN });
    if (!run.npc) await kv.delIfEqual(`village-campaign-assigned:${run.defender}`, run.id);
}
export async function settleTerminalCampaignSession(session: SoloPveSession): Promise<void> {
    if (session.status !== 'done' || !session.encounter.kind.startsWith('village-war-')) return;
    await withKvLock(runKey(session.sessionId), async () => {
        const run = await kv.get<CampaignRun>(runKey(session.sessionId));
        if (!run?.npc || run.attacker !== session.ownerSlug || session.encounter.bindingId !== run.id) return;
        const physical = await settlePveFightOutcome(session, run.attacker);
        if (!physical.ok) refuse(physical.error);
        await scoreRun(run, session.winner === 'player' ? 'p1' : session.winner === 'enemy' ? 'p2' : 'draw', session.terminalEvidence!.finishedAt);
    }, { failClosed: true });
}
async function finishPreparedRun(war: CampaignWarRow, run: CampaignRun, solo: SoloPveSession | undefined, req: VercelRequest) {
    return withKvLock(runKey(run.id), async () => {
        // A failed cleanup can leave prepared inputs behind after players have already
        // acted. Resume the published runtime instead of rewinding that battle.
        const published = await kv.get<CampaignRun>(runKey(run.id));
        if (published && published.status !== 'prepared') run = published;
        run = await syncCompletedCombat(run);
        await kv.set(activeKey(war, run.attacker), run.id, { ex: RETAIN });
        if (!run.npc && run.status !== 'done') {
            await kv.set(`village-campaign-assigned:${run.defender}`, run.id, { ex: RETAIN });
            await kv.set(activeKey(war, run.defender), run.id, { ex: RETAIN });
            await kv.del(`${defensePrefix(war)}${run.defender}`);
        }
        if (solo && !(await readSoloPveSession(run.id))) await writeSoloPveSession(solo);
        if (run.pet && run.status !== 'done') {
            run.petWinner = resolveWarDuel(run.pet).outcome;
            await scoreRun(run, run.petWinner === 'from' ? 'p1' : 'p2', run.createdAt);
        } else if (run.status !== 'done' && (run.card || run.aiCard || solo)) run.status = 'active';
        await kv.set(runKey(run.id), run, { ex: RETAIN });
        if (run.mode === 'combat' && !run.npc && run.status !== 'done') await resumeCombat(run, req, war);
        if (run.card && run.status !== 'done') {
            await pushOfflineNotice(run.defender, { kind: 'village-war-card-defense', by: run.attacker,
                sector: war.campaign!.strongholds.find(o => o.id === run.objectiveId)!.sector, at: run.createdAt, campaignRunId: run.id });
            kickPlayer(run.defender, 'challenge');
        }
        await mutateCampaignWar(war.id, async fresh => {
            if (fresh.declarationGeneration !== run.generation) refuse('War declaration changed.');
            delete fresh.campaign!.admissions[run.id].prepared;
            return { row: fresh, value: true };
        });
        const objective = war.campaign!.strongholds.find(o => o.id === run.objectiveId);
        const context = objective?.village ? campaignPreparationContext(war, objective.village, run.createdAt) : null;
        if (objective && context) await recordPreparationAttack(context, objective.village!, run.id, objective.sector, run.mode, run.createdAt)
            .catch(error => console.warn('[war-watchtower] alert deferred', safeLogValue(error)));
        return run;
    }, { failClosed: true });
}
async function resumeCombat(run: CampaignRun, req: VercelRequest, war: CampaignWarRow) {
    if (run.npc || run.mode !== 'combat') return;
    const challengeId = `campaign-${run.id}`;
    const binding = { warId: run.warId, generation: run.generation, objectiveId: run.objectiveId!, runId: run.id };
    await saveChallengeRecord({ id: challengeId, from: run.attacker, to: run.defender, mode: 'standard', status: 'pending',
        createdAt: run.createdAt, challenge: { villageWarObjective: binding } });
    let status = 200; let answer: Record<string, unknown> = {};
    const response = { status(code: number) { status = code; return this; }, json(value: Record<string, unknown>) { answer = value; return this; },
        setHeader() {}, end() { return this; } };
    await pvpHandler({ ...req, method: 'POST', body: { challengeId, battleId: run.battleId,
        p1Character: { name: run.attacker }, p2Character: { name: run.defender }, useCurrentVitals: true, baseRewards: false } } as VercelRequest,
        response as unknown as VercelResponse);
    if (status !== 200) refuse(String(answer.error ?? 'Could not dispatch the combat defense.'));
    run.battleId = String(answer.battleId ?? run.battleId ?? run.id);
    if ((answer.session as { status?: string } | undefined)?.status === 'done') { await syncCompletedCombat(run); return; }
    // Campaign dispatch seats both real players immediately. Publish their
    // battle presence now, before room cleanup or another assignment can run.
    const session = answer.session as PvpSession | undefined;
    if (!session || session.battleId !== run.battleId || session.villageWarObjective?.runId !== run.id) refuse('The dispatched battle authority is incomplete. Retry the same battle.');
    await publishPvpPendingSessionPointers(kv, session);
    if (war.campaign!.shrine.some(o => o.id === run.objectiveId)) {
        renewShrineCombatPresence(run.attacker, war, run.objectiveId!, run.battleId!);
        renewShrineCombatPresence(run.defender, war, run.objectiveId!, run.battleId!);
    }
    run.status = 'active';
    await kv.set(runKey(run.id), run, { ex: RETAIN });
    const attackerSave = await kv.get<{ character?: Record<string, unknown> }>(`save:${run.attacker}`);
    const common = { id: challengeId, fromName: run.attacker, toName: run.defender, mode: 'standard',
        challenger: projectChallengerCharacter(attackerSave?.character), createdAt: run.createdAt, battleId: run.battleId };
    await notify(run.defender, { ...common, sectorAttack: true });
    await notify(run.attacker, { ...common, toName: run.attacker, fromName: run.defender, accepted: true });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST required.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
    const identity = await authedPlayerOrAdmin(req, String(body.name ?? ''));
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    const me = identity.admin ? safeName(String(body.name ?? '')) : identity.name;
    if (!(await enforceRateLimitKv(req, res, 'village-campaign', 90, 60_000, me))) return;
    try {
        const save = await kv.get<Record<string, unknown>>(`save:${me}`);
        const character = save?.character as Record<string, unknown> | undefined;
        if (!character) return res.status(404).json({ error: 'Player save missing.' });
        const village = String(character.village ?? '');
        const action = String(body.action ?? 'view');
        const warId = String(body.warId ?? '');
        const war = await kv.get<CampaignWarRow>(`world:war:${warId}`);
        if (!war?.campaign || !war.villages.includes(village)) return res.status(403).json({ error: 'You are not a participant in this village war.' });
        if (action.startsWith('guard-')) {
            if (action !== 'guard-leave' && (isIncapacitated(character) || !Number.isFinite(Number(character.level)) || Number(character.level) < 15)) refuse('Recover and reach level 15 before taking guard duty.');
            if (action === 'guard-enter' && await loadPvpPendingSessionPointer(kv, me)) refuse('Finish the pending PvP settlement before taking guard duty.');
            return res.status(200).json(await guardStrongholdAction(warId, war.declarationGeneration!, me, village, action, body.sector, body.visitId));
        }
        if (action.startsWith('operation-')) {
            if (!['operation-leave', 'operation-abandon'].includes(action) && (isIncapacitated(character) || Number(character.level) < 15)) refuse('Recover and reach level 15 before carrying out field orders.');
            return res.status(200).json(await fieldOperationAction(warId, war.declarationGeneration!, me, village, action, body.operation, body.missionId));
        }
        if (['shrine-enter', 'shrine-state', 'shrine-step', 'shrine-leave'].includes(action)) {
            const result = await mutateCampaignWar(warId, async current => {
                const now = Date.now(), objective = current.campaign!.shrine.find(o => o.id === body.objectiveId);
                if (!objective || current.declarationGeneration !== war.declarationGeneration) refuse('This shrine belongs to another war.');
                applyShrineClosingControl(current, now);
                advanceCampaign(current.campaign!, now);
                // Record the old roster before changing membership, so leaving or
                // entering from another village cannot preserve a stale sole hold.
                const before = await shrineRoster(current, objective.sector);
                updateShrineControl(current.campaign!, objective, before.map(p => p.village), now);
                if (action === 'shrine-leave') {
                    if (onlineStore.get(me)?.inBattle) refuse('Finish your battle before leaving the shrine.');
                    leaveShrineRoom(me);
                } else if (action === 'shrine-state' && now >= objective.closesAt) {
                    // The room can show its final result without extending an
                    // expired entry lease or requiring a new admission.
                } else {
                    if (!campaignWarPlayable(current) || isIncapacitated(character) || Number(character.level) < 15) refuse('Recover and reach level 15 before entering the shrine.');
                    const block = sectorPresenceBlock(me, objective.sector);
                    if (block) refuse(block.error);
                    const player = onlineStore.get(me);
                    if (player?.locationUnverified || (player?.travelingUntil ?? 0) > now) refuse('Finish your travel before entering the shrine.');
                    const location = shrineRoomLocation(me, current, objective.sector, now);
                    if (action === 'shrine-enter') {
                        if (!campaignObjectiveAvailable(current.campaign!, objective, village, now)) refuse('The shrine is locked or its scoring window is complete.');
                        if (player?.inBattle || await loadPvpPendingSessionPointer(kv, me)) refuse('Finish your battle and settlement before entering.');
                        // Entry is a fresh visit. Drop the old lease before its
                        // replacement so a concurrent exterior move or reconnect
                        // cannot carry a sole occupant's previous hold forward.
                        leaveShrineRoom(me);
                        const enteringRoster = await shrineRoster(current, objective.sector);
                        updateShrineControl(current.campaign!, objective, enteringRoster.map(p => p.village), now);
                        touchShrineRoom(me, current, objective.sector, objective.id, undefined, now, village);
                        scheduleShrineClosing(current, objective);
                    } else {
                        if (!location || location.objectiveId !== objective.id) refuse('Travel to the shrine sector and enter its golden shrine first.');
                        let tile = location.tile;
                        if (action === 'shrine-step') {
                            const next = Number(body.tile), x = next % 12, y = Math.floor(next / 12);
                            if (player?.inBattle || !Number.isInteger(next) || x < 1 || x > 10 || y < 1 || y > 10
                                || Math.abs(x - tile % 12) + Math.abs(y - Math.floor(tile / 12)) !== 1) refuse('Choose an adjacent floor tile while out of battle.');
                            tile = next;
                        }
                        touchShrineRoom(me, current, objective.sector, objective.id, tile, now);
                    }
                }
                const players = await shrineRoster(current, objective.sector);
                updateShrineControl(current.campaign!, objective, players.map(p => p.village), now);
                applyShrineClosingControl(current, now);
                current.updatedAt = now;
                const { controlParticipantMs: _private, ...publicObjective } = objective;
                return { row: current, value: { ok: true, room: { objective: publicObjective, players, serverNow: now },
                    campaign: campaignView(current.campaign!, current.villages, village, now) } };
            });
            return res.status(200).json(result);
        }
        if (action === 'view') {
            const active = await kv.get<string>(activeKey(war, me));
            const assigned = await kv.get<string>(`village-campaign-assigned:${me}`);
            let run = assigned ? await kv.get<CampaignRun>(runKey(assigned)) : null;
            if (run?.warId !== warId || run.generation !== war.declarationGeneration || run.status === 'done') {
                if (assigned) await kv.delIfEqual(`village-campaign-assigned:${me}`, assigned);
                run = active ? await kv.get<CampaignRun>(runKey(active)) : null;
            }
            run = await refreshCombatRun(run);
            const mine = await kv.get<Defense>(`${defensePrefix(war)}${me}`);
            // Keep an entered interior alive while its objective panel is open.
            const sector = onlineStore.get(me)?.sector;
            if (sector !== undefined && war.campaign.strongholds.some(o => o.sector === sector) && strongholdLocation(me, sector) && !strongholdLocation(me, sector)?.room) touchStrongholdPresence(me, sector, 0);
            return res.status(200).json({ campaign: { ...campaignView(war.campaign, war.villages, village, Date.now()),
                supportTiers: await campaignSupportTiers(war, village, Date.now()),
                espionageBonusUsed: !!war.campaign.espionageIntelBonuses?.[`${village}:${me}:${campaignDay(war.campaign, Date.now())}`] },
                mission: projectFieldMission(war, me),
                defense: mine, run: run && run.warId === warId && run.generation === war.declarationGeneration && (run.attacker === me || (!run.npc && run.defender === me)) ? await projectRun(run, me) : null });
        }
        if (action === 'defend' || action === 'dequeue') {
            const key = `${defensePrefix(war)}${me}`;
            if (action === 'dequeue') { await kv.del(key); return res.status(200).json({ ok: true }); }
            if (!campaignWarPlayable(war) || isIncapacitated(character) || Number(character.level ?? 0) < 15) refuse('Recover and reach level 15 before defending.');
            const objective = [...war.campaign.shrine, ...war.campaign.strongholds].find(o => o.id === body.objectiveId);
            if (objective && !objective.village) refuse('Travel to the golden shrine and enter it to defend. Shrine defenders cannot queue from town.');
            if (!objective || (objective.village && objective.village !== village) || Date.now() >= objective.closesAt || objective.bouts >= objective.limit) refuse('Choose one of your available village objectives.');
            if (objective.mode === 'pet' && !(await sealWarTeam(me))?.length) refuse('You need an available pet team.');
            if (objective.mode === 'card' && !(await legalDeck(me))) refuse('Save a legal Chronicle deck before defending.');
            await kv.set(key, { player: me, village, objectiveId: objective.id, seenAt: Date.now() }, { ex: DEFENSE_TTL });
            return res.status(200).json({ ok: true });
        }
        if (action === 'leave') {
            const objective = war.campaign.strongholds.find(o => o.id === body.objectiveId);
            if (objective && strongholdLocation(me, objective.sector) && !onlineStore.get(me)?.inBattle) leaveStrongholdPresence(me);
            return res.status(200).json({ ok: true });
        }
        if (action === 'enter') {
            if (!campaignWarPlayable(war) || isIncapacitated(character) || Number(character.level ?? 0) < 15) refuse('Recover and reach level 15 before entering a war stronghold.');
            const objective = campaignView(war.campaign, war.villages, village, Date.now()).strongholds.find(o => o.id === body.objectiveId);
            if (!objective) refuse('Discover this stronghold through war operations first.');
            const block = sectorPresenceBlock(me, objective.sector);
            if (block) refuse(block.error);
            if (onlineStore.get(me)?.inBattle || (onlineStore.get(me)?.travelingUntil ?? 0) > Date.now()) refuse('Finish your battle or travel before entering.');
            touchStrongholdPresence(me, objective.sector, 0);
            return res.status(200).json({ ok: true });
        }
        if (action === 'start') {
            const started = await withKvLock(`village-campaign-dispatch:${warId}`, async () => {
                const freshWar = await kv.get<CampaignWarRow>(`world:war:${warId}`);
                if (!freshWar?.campaign) refuse('Campaign missing.');
                const pending = Object.values(freshWar.campaign.admissions).find(a => a.player === me && a.prepared);
                if (pending?.prepared) return finishPreparedRun(freshWar, pending.prepared.run as CampaignRun, pending.prepared.solo as SoloPveSession | undefined, req);
                const active = await kv.get<string>(activeKey(war, me));
                const previous = await refreshCombatRun(active ? await kv.get<CampaignRun>(runKey(active)) : null);
                if (previous && previous.status !== 'done') {
                    return withKvLock(runKey(previous.id), async () => {
                        const current = await kv.get<CampaignRun>(runKey(previous.id));
                        if (!current) refuse('The previous battle is unavailable.');
                        await syncCompletedCombat(current);
                        if (current.status !== 'done' && current.mode === 'combat' && !current.npc) await resumeCombat(current, req, freshWar);
                        return current;
                    }, { failClosed: true });
                }
                if (isIncapacitated(character) || Number(character.level ?? 0) < 15) refuse('Recover and reach level 15 before joining the war.');
                if (await loadPvpPendingSessionPointer(kv, me)) refuse('Finish the pending PvP battle settlement before starting another war battle.');
                const currentPresence = onlineStore.get(me);
                if (currentPresence?.inBattle || (currentPresence?.travelingUntil ?? 0) > Date.now()) refuse('Finish your battle or travel before joining another war battle.');
                const now = Date.now();
                const objective = [...war.campaign!.shrine, ...war.campaign!.strongholds].find(o => o.id === body.objectiveId);
                const operation = WAR_OPERATIONS.includes(body.operation) ? body.operation as WarOperation : undefined;
                const field = fieldMissionFor(freshWar, me);
                const spy = body.fieldMissionId && field && field.id === body.fieldMissionId && field.village === village && field.status === 'active' && field.kind === 'espionage' ? field : undefined;
                if (operation && !spy) refuse('Accept a field mission from Town Hall and travel to its objectives.');
                if (body.fieldMissionId && !spy) refuse('This espionage order is not active.');
                if (body.fieldMissionId && body.objectiveId) refuse('Choose a field order or a war objective.');
                if (spy) {
                    const block = sectorPresenceBlock(me, spy.sectors[0]); if (block) refuse(block.error);
                    if (onlineStore.get(me)?.locationUnverified || !strongholdLocation(me, spy.sectors[0]) || strongholdLocation(me, spy.sectors[0])?.room
                        || await getSectorOwnerVillage(spy.sectors[0]) !== spy.enemy) refuse('Enter your assigned enemy stronghold before fighting its sentry.');
                } else if (field?.status === 'active' && !objective) refuse('Finish or abandon your field order first.');
                if (body.objectiveId && body.operation) refuse('Choose an objective or a supporting operation, not both.');
                if (!operation && !objective && !spy) refuse('Choose a war objective or operation.');
                if (objective && !campaignObjectiveAvailable(war.campaign!, objective, village, now)) refuse('This objective is locked, undiscovered, or complete.');
                if (objective?.village === village) refuse('Queue to defend your own stronghold from Town Hall.');
                if (objective) {
                    const block = sectorPresenceBlock(me, objective.sector);
                    if (block) refuse(block.error);
                }
                if (objective?.village && (!strongholdLocation(me, objective.sector) || strongholdLocation(me, objective.sector)?.room)) refuse('Find and enter this sector stronghold before attacking its ANBU defense.');
                if (objective && !objective.village && !shrineRoomLocation(me, war, objective.sector)) refuse(`Travel to shrine sector ${objective.sector} and enter the golden shrine before fighting.`);
                const enemy = war.villages.find(v => v !== village)!;
                const mode = objective?.mode ?? 'combat';
                const defense = objective ? objective.village ? await chooseDefense(war, objective.id, enemy, mode)
                    : await shrineOpponent(war, objective.id, enemy, typeof body.target === 'string' ? body.target : undefined) : null;
                if (objective && !objective.village && !defense) refuse('No available enemy player is inside the shrine. Keep control until the window closes to earn its bonus.');
                const id = `vwc${randomUUID().replace(/-/g, '')}`;
                const run: CampaignRun = { id, warId, generation: war.declarationGeneration ?? 1,
                    objectiveId: objective?.id, operation: spy ? 'espionage' : operation ?? (!defense ? 'sabotage' : undefined), fieldMissionId: spy?.id,
                    mode, attacker: me, defender: defense?.player ?? '', attackerVillage: village,
                    defenderVillage: enemy, npc: !defense, createdAt: now, status: 'prepared' };
                if (mode === 'combat' && defense) run.battleId = `pvp-${randomUUID()}`;
                let solo: SoloPveSession | undefined;
                if (mode === 'combat' && run.npc) {
                    const held = await settleHeldFights(me);
                    if (!held.ok) refuse(held.error);
                    const fresh = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${me}`));
                    const freshChar = fresh?.character as Record<string, unknown> | undefined;
                    if (!fresh || !freshChar || isIncapacitated(freshChar)) refuse('Recover before starting a war operation.');
                    const admin = await loadAdminCombatContent();
                    if (objective) {
                        const fielded = await fieldCampaignAnbu(enemy, sealCampaignAnbuCombat);
                        if (!fielded.ok) refuse('The enemy village has no ANBU or Kage able to defend this stronghold.');
                        run.defender = fielded.fielded.slug;
                        solo = buildGarrisonEncounter({ runId: id, now, attacker: { slug: me, name: me,
                            character: hydrateCharacterFromSave(freshChar, {}, fresh, admin), itemCharges: sealItemCharges(freshChar, freshChar) },
                            anbu: { ...fielded.fielded, name: maskedGarrisonDefenderName(enemy, fielded.defender, fielded.appointees),
                                character: { ...fielded.fielded.character, avatarImage: campaignAnbuAvatar(enemy) } }, terrain: isWarVillage(enemy) ? VILLAGE_BIOME[enemy] : 'central', sector: objective.sector,
                            contestId: warId, attackerVillage: village, defenderVillage: enemy });
                        solo.encounter.kind = 'village-war-garrison';
                        delete solo.enemy.character.boss;
                        solo.enemy.character.aiTurnPolicy = STANDARD_PVE_AI_POLICY;
                        solo.enemy.character.masterAi = true;
                        solo.encounter.sourceId = 'village-war-anbu';
                        delete solo.encounter.metadata?.anbuSlug;
                    } else {
                        const mission = combatMissionByKey('combat-c-patrol')!;
                        solo = buildSoloPveAiEncounter({ sessionId: id, playerName: me, save: fresh,
                            profile: { ...missionEnemyTemplate(mission), id: 'war-espionage', name: 'Enemy Stronghold Sentry' },
                            scaling: { level: Math.max(15, Math.min(100, Number(freshChar.level))) }, difficultyMode: 'MISSION', now, admin,
                            continuousVitals: true, encounter: { kind: 'village-war-operation', id: 'espionage', bindingId: id } });
                    }
                    solo.encounter.bindingId = id;
                    solo.encounter.metadata = { ...solo.encounter.metadata, warId, generation: run.generation, objectiveId: run.objectiveId ?? null, operation: run.operation ?? null,
                        ...(spy ? { fieldMissionId: spy.id, sector: spy.sectors[0] } : {}) };
                }
                if (mode === 'pet') {
                    const team = await sealWarTeam(me);
                    if (!team?.length) refuse('You need an available pet team.');
                    let theirTeam;
                    let defenderName = run.defender;
                    if (defense) theirTeam = await sealWarTeam(defense.player);
                    else {
                        const fielded = await fieldCampaignAnbu(enemy, sealCampaignAnbuTeam);
                        if (!fielded.ok) refuse('No enemy ANBU or Kage can field a pet team.');
                        run.defender = fielded.defender.slug; theirTeam = fielded.fielded;
                        defenderName = maskedGarrisonDefenderName(enemy, fielded.defender, fielded.appointees);
                    }
                    if (!theirTeam?.length) refuse('The defender cannot field pets right now.');
                    run.pet = { sessionId: id, seed: randomInt(0x1_0000_0000), fromName: me, toName: defenderName,
                        fromPets: team, toPets: theirTeam, terrain: isWarVillage(enemy) ? VILLAGE_BIOME[enemy] : 'central' };
                }
                if (mode === 'card') {
                    const mine = await resolveChronicleDeckWithSave(me, [], identity.admin);
                    if (!mine) refuse('Save a legal Chronicle deck before attacking.');
                    run.saveVersion = mine.saveVersion;
                    if (defense) {
                        const theirs = await legalDeck(defense.player);
                        if (!theirs) refuse('The defender has no legal deck.');
                        run.card = createMatch(me, mine.deck, defense.player, theirs, Math.random, now);
                    } else {
                        const fielded = await fieldCampaignAnbu(enemy, legalDeck);
                        if (!fielded.ok) refuse('No enemy ANBU or Kage can field a Chronicle deck.');
                        run.defender = fielded.defender.slug;
                        run.aiCard = createAiMatch(id, me, mine.deck, 'hard', now, Math.random, 'external', undefined,
                            { name: maskedGarrisonDefenderName(enemy, fielded.defender, fielded.appointees), deck: fielded.fielded });
                    }
                }
                // Prepared inputs precede admission. A crash cannot award an unadmitted run.
                await kv.set(runKey(id), run, { ex: RETAIN });
                await mutateCampaignWar(warId, async fresh => {
                    if (!campaignWarPlayable(fresh, now) || fresh.declarationGeneration !== run.generation) refuse('This war is not active.');
                    const c = fresh.campaign!;
                    const o = [...c.shrine, ...c.strongholds].find(o => o.id === run.objectiveId);
                    if (o && !campaignObjectiveAvailable(c, o, village, now)) refuse('The objective has closed.');
                    if (o?.village && !run.npc && o.bouts + Object.values(c.admissions).filter(a => !a.npc && !a.finished && a.objectiveId === o.id).length >= o.limit) refuse('All remaining objective battles are already assigned.');
                    if (run.fieldMissionId) {
                        const mission = c.admissions[run.fieldMissionId]?.field;
                        if (!mission || mission.status !== 'active' || mission.kind !== 'espionage' || mission.battleRunId) refuse('Your espionage order has already been assigned.');
                        mission.battleRunId = run.id;
                    } else if (run.npc && !reserveCampaignOperation(c, village, me, run.operation!, now)) refuse('Your personal daily PvE allowance is exhausted.');
                    c.admissions[id] = { player: me, objectiveId: run.objectiveId, operation: run.operation, createdAt: now, npc: run.npc,
                        ...(run.npc ? { supportTiers: run.fieldMissionId ? c.admissions[run.fieldMissionId]?.supportTiers
                            : await campaignSupportTiers(fresh, village, now) } : {}),
                        prepared: { run, ...(solo ? { solo } : {}) } };
                    return { row: fresh, value: true };
                });
                return finishPreparedRun(war, run, solo, req);
            }, { failClosed: true });
            return res.status(200).json(await projectRun(started, me));
        }
        const id = String(body.runId ?? '');
        if (!/^vwc[a-f0-9]{32}$/.test(id)) refuse('Invalid campaign battle.');
        const result = await withKvLock(runKey(id), async () => {
            const run = await kv.get<CampaignRun>(runKey(id));
            if (!run || run.warId !== warId || run.generation !== war.declarationGeneration
                || (me !== run.attacker && (run.npc || me !== run.defender))) refuse('This battle does not belong to you.');
            if (!war.campaign!.admissions[id]) refuse('Battle admission is missing.');
            await syncCompletedCombat(run);
            if (action === 'watch') {
                if (!run.pet || !run.petWinner) refuse('No pet replay is ready.');
                const script = resolveWarDuel(run.pet).script;
                return { script: me === run.defender ? replayFromOpposingSide(script, run.pet.fromName) : script };
            }
            if (run.card || run.aiCard) {
                if (run.card) run.card = advanceExpiredChronicleTurn(run.card, Date.now());
                if (action !== 'state' && action !== 'join' && action !== 'resolve') {
                    const intent = { ...body, action } as ChronicleActionIntent;
                    if (run.card) {
                        const applied = applyAction(run.card, me === run.attacker ? 'p1' : 'p2', intent, Date.now());
                        if (!applied.ok) refuse(applied.error);
                        run.card = applied.state;
                    } else {
                        const applied = applyPlayerAction(run.aiCard!, intent, Date.now());
                        if (!applied.ok) refuse(applied.error);
                    }
                }
                const state = run.card ?? run.aiCard!.state;
                if (state.status === 'complete') run.endedAt ??= Date.now();
                await kv.set(runKey(id), run, { ex: RETAIN });
                if (state.status === 'complete') await scoreRun(run, state.winner ?? 'draw', run.endedAt!);
            }
            if (action === 'resolve' && run.mode === 'combat' && run.npc) {
                const session = await readSoloPveSession(id);
                if (!session || session.ownerSlug !== me || session.encounter.bindingId !== id || session.status !== 'done') refuse('Finish the server battle before reporting its outcome.');
                const physical = await settlePveFightOutcome(session, me);
                if (!physical.ok) refuse(physical.error);
                await scoreRun(run, session.winner === 'player' ? 'p1' : session.winner === 'enemy' ? 'p2' : 'draw', session.terminalEvidence!.finishedAt);
                return { ...await projectRun(run, me), character: physical.character, _saveVersion: physical._saveVersion };
            }
            return await projectRun(run, me);
        }, { failClosed: true });
        return res.status(200).json(result);
    } catch (error) {
        const { message, internal } = warCampaignErrorMessage(error);
        if (internal) console.error('[village/war-campaign]', safeLogValue(error instanceof Error ? (error.stack ?? error.message) : String(error), 2000));
        return res.status(409).json({ error: message });
    }
}
