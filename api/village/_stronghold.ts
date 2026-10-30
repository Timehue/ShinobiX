import { withCombatAdmissionSave } from '../pve/_combat-admission-save.js';
import { randomUUID } from 'node:crypto';
import { kv } from '../_storage.js';
import { readKvProjection } from '../_storage-projection.js';
import { readSavePresenceFacts, type SavePresenceFacts } from '../_save-presence-facts.js';
import { withKvLock } from '../_lock.js';
import { onlineStore } from '../_realtime/online-store.js';
import { battleAuthorityKeys, battleEvidenceFrom, resolveBattleAuthority } from '../_realtime/battle-authority.js';
import { toPlayerRecord } from '../_realtime/presence-input.js';
import { leaveStrongholdPresence, strongholdLocation, touchStrongholdPresence } from '../_stronghold-presence.js';
import { sectorPresenceBlock } from '../_sector-presence-gate.js';
import { villageCampaignStrongholdLookup } from '../_village-war-campaign.js';
import { isIncapacitated } from '../_elapsed-state.js';
import { isWarSector } from '../_war-map-sectors.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { settlePveFightOutcome } from '../pve/_fight-outcome-settlement.js';
import { settleHeldFights } from '../pve/_held-fights.js';
import { withSoloPveSettlementReceipt } from '../solo-pve/_settlement.js';
import { terminalizeLapsedSoloPveSession } from '../solo-pve/_abandon.js';
import { advanceStronghold, isDeathsGateStronghold, strongholdLevelEligible, strongholdSafeTile, STRONGHOLD_MIN_LEVEL, STRONGHOLD_INTEL_TILE, STRONGHOLD_LAYOUT_VERSION, STRONGHOLD_SPAWN, STRONGHOLD_VAULT, STRONGHOLD_DIMS, type StrongholdVisit } from '../../shared/sector-stronghold.js';
import { sectorPlace } from '../../shared/sector-geo.js';
import { sealedSectorWeather } from '../_sector-weather-seal.js';
import { withWorldBossPvpLock } from '../world-boss-event/_pvp-protection.js';

const TTL = 24 * 60 * 60;
export const strongholdVisitKey = (name: string, sector: number) => `stronghold:${name}:${sector}`;
type Result = { status: number; body: Record<string, unknown> };
const fail = (error: string, status = 409): Result => ({ status, body: { error } });

/**
 * The save fields a stronghold entry or step decides on (SAVE_PRESENCE_FACTS).
 * A step used to read the whole save twice, hundreds of KB per tile.
 */
async function strongholdSaveFacts(playerName: string): Promise<SavePresenceFacts> {
    const [facts] = await readSavePresenceFacts([playerName]);
    return facts;
}

/** `values` is the battleAuthorityKeys read when the caller already made it. */
async function unrelatedStrongholdBattle(playerName: string, ownedPatrolId?: string, values?: readonly unknown[] | null): Promise<boolean> {
    const evidence = battleEvidenceFrom(values ?? await kv.mget(...battleAuthorityKeys(playerName)));
    const authority = await resolveBattleAuthority(playerName, evidence);
    const projection = evidence.battleState as { kind?: string; sessionId?: string } | null;
    const ownedPatrol = !!ownedPatrolId && authority.source === 'solo-pve' && projection?.kind === 'solo-pve' && projection.sessionId === ownedPatrolId;
    return authority.inBattle && !ownedPatrol;
}

function snapshot(playerName: string, visit: StrongholdVisit, extra: Record<string, unknown> = {}): Result {
    if (visit.presenceId) touchStrongholdPresence(playerName, visit.sector, visit.tile);
    const peers = onlineStore.listSector(visit.sector)
        .filter(p => p.name !== playerName && strongholdLocation(p.name, p.sector) && !strongholdLocation(p.name, p.sector)?.room)
        .map(toPlayerRecord);
    return { status: 200, body: { ok: true, visit, peers, ...extra } };
}

/** Shared by final-boss admission: the Anbu cannot be reached by skipping patrols. */
export async function strongholdVaultReady(playerName: string, sector: number): Promise<boolean> {
    if (isDeathsGateStronghold(sector)) return false;
    if (sectorPresenceBlock(playerName, sector)) return false;
    const presence = onlineStore.get(playerName);
    if (presence?.pendingAttacker || (presence?.travelingUntil ?? 0) > Date.now()) return false;
    const visit = await kv.get<StrongholdVisit>(strongholdVisitKey(playerName, sector));
    if (!visit?.presenceId || visit.layoutVersion !== STRONGHOLD_LAYOUT_VERSION || visit.patrolId || visit.threat >= 100) return false;
    if (await unrelatedStrongholdBattle(playerName)) return false;
    const w = STRONGHOLD_DIMS.width;
    return !!strongholdLocation(playerName, sector) && !strongholdLocation(playerName, sector)?.room
        && Math.abs(visit.tile % w - STRONGHOLD_VAULT % w) + Math.abs(Math.floor(visit.tile / w) - Math.floor(STRONGHOLD_VAULT / w)) === 1;
}

/** Called only after the infiltration route authenticates the player and checks its feature flag. */
export async function handleStrongholdAction(playerName: string, action: string, body: Record<string, unknown>): Promise<Result> {
    const sector = Number(body.sector);
    if (!Number.isInteger(sector) || (!isWarSector(sector) && !isDeathsGateStronghold(sector))) return fail('That sector has no stronghold.', 400);
    const key = strongholdVisitKey(playerName, sector);
    if (action === 'stronghold-leave') {
        return withKvLock(key, async () => {
            const visit = await kv.get<StrongholdVisit>(key);
            if (body.presenceId && visit?.presenceId !== body.presenceId) return fail('This stronghold is open in another tab.');
            const presence = onlineStore.get(playerName);
            if (presence?.pendingAttacker || presence?.inBattle || await unrelatedStrongholdBattle(playerName)) return fail('Finish your current battle before leaving.');
            if (visit) await kv.set(key, { ...visit, presenceId: undefined }, { ex: TTL });
            leaveStrongholdPresence(playerName);
            // A queued poll/step must carry the still-active tab lease. Keep exploration
            // and threat so leaving/reloading cannot erase an owed patrol.
            return { status: 200, body: { ok: true } };
        }, { failClosed: true });
    }
    const presenceBlock = sectorPresenceBlock(playerName, sector);
    if (presenceBlock) return fail(presenceBlock.error, presenceBlock.status);
    if (action === 'stronghold-enter' || action === 'stronghold-step') {
        // The war rows do not depend on the village, so both reads go at once.
        const [[save], objectiveFor] = await Promise.all([
            readKvProjection(kv, [`save:${playerName}`], { village: ['character', 'village'] }),
            villageCampaignStrongholdLookup(sector),
        ]);
        if (objectiveFor(String(save?.village ?? ''))) return fail('This village war stronghold uses its nominated battle mode. Open the war objective to enter.');
    }
    return withKvLock(key, async () => {
        // Every read this action can need, at once: each statement under the
        // lock is its own fenced transaction, so three serial reads cost three
        // times the round trips. The checks below still run in their original
        // order, and nothing is written before the last of them.
        const needsSaveFacts = action === 'stronghold-enter' || action === 'stronghold-step';
        const [storedVisit, battleValues, saveFacts] = await Promise.all([
            kv.get<StrongholdVisit>(key),
            action === 'stronghold-patrol-report' ? null : kv.mget(...battleAuthorityKeys(playerName)),
            needsSaveFacts ? strongholdSaveFacts(playerName) : null,
        ]);
        let visit = storedVisit;
        const presenceId = typeof body.presenceId === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(body.presenceId) ? body.presenceId : undefined;
        if (action === 'stronghold-enter' && !presenceId) return fail('Re-enter the stronghold to reconnect.');
        if (action === 'stronghold-enter') {
            const presence = onlineStore.get(playerName);
            if (presence?.pendingAttacker || (presence?.travelingUntil ?? 0) > Date.now()) return fail('Finish your current combat or travel before entering.');
            if (presence?.inBattle && !visit?.patrolId) return fail('Finish your current battle before entering.');
            if (await unrelatedStrongholdBattle(playerName, visit?.patrolId, battleValues)) return fail('Finish your current battle before entering.');
            const record = saveFacts;
            if (!record?.character || !strongholdLevelEligible(record.character.level)) return fail(`Strongholds require level ${STRONGHOLD_MIN_LEVEL}.`, 403);
            // A pending patrol may be terminal and still owe its settlement after a reload.
            if (!visit?.patrolId && isIncapacitated(record.character, Date.now())) return fail('Recover before entering the stronghold.');
        }
        if (!visit || visit.layoutVersion !== STRONGHOLD_LAYOUT_VERSION) {
            if (action !== 'stronghold-enter') return fail('Re-enter the stronghold to reconnect.');
            const record = saveFacts;
            if (!record?.character || !strongholdLevelEligible(record.character.level)) return fail(`Strongholds require level ${STRONGHOLD_MIN_LEVEL}.`, 403);
            if (isIncapacitated(record.character, Date.now())) return fail('Recover before entering the stronghold.');
            visit = { id: randomUUID(), layoutVersion: STRONGHOLD_LAYOUT_VERSION, sector, tile: STRONGHOLD_SPAWN,
                steps: 0, threat: 0, version: 0, visited: [STRONGHOLD_SPAWN] };
            await kv.set(key, visit, { ex: TTL });
        }
        if (action === 'stronghold-enter') {
            const safeTile = strongholdSafeTile(visit.tile, sector);
            visit = { ...visit, presenceId, ...(safeTile !== visit.tile ? { tile: safeTile, version: visit.version + 1, visited: [...new Set([...visit.visited, safeTile])] } : {}) };
            await kv.set(key, visit, { ex: TTL });
        } else if (action !== 'stronghold-patrol-report' && (!presenceId || visit.presenceId !== presenceId)) {
            return fail('This stronghold session ended or opened in another tab. Reconnect to continue.');
        }
        if (action !== 'stronghold-patrol-report' && action !== 'stronghold-enter' && await unrelatedStrongholdBattle(playerName, visit.patrolId, battleValues)) {
            if (action === 'stronghold-state') return snapshot(playerName, visit, { combatBlocked: true });
            return fail('Finish your current battle before exploring the stronghold.');
        }
        if (action === 'stronghold-patrol-report') {
            const session = await readSoloPveSession(String(body.runId ?? ''));
            if (!session || session.ownerSlug !== playerName || session.encounter.kind !== 'stronghold-patrol'
                || session.encounter.bindingId !== visit.id || session.encounter.metadata?.sector !== sector) return fail('That patrol does not belong to this visit.');
            if (session.status !== 'done' || !session.terminalEvidence) return fail('Finish the patrol fight first.');
            const settled = await settlePveFightOutcome(session, playerName);
            if (!settled.ok) return fail(settled.error, settled.status);
            await writeSoloPveSession(withSoloPveSettlementReceipt(session, { kind: 'stronghold-patrol', id: session.sessionId, settledAt: Date.now() }));
            if (visit.patrolId === session.sessionId) {
                visit = { ...visit, patrolId: undefined, threat: 0, version: visit.version + 1,
                    ...(session.outcome !== 'win' ? { tile: STRONGHOLD_SPAWN, presenceId: undefined } : {}) };
                await kv.set(key, visit, { ex: TTL });
                if (session.outcome !== 'win') leaveStrongholdPresence(playerName);
            }
            return snapshot(playerName, visit, { ...settled, won: session.outcome === 'win' });
        }
        if (action === 'stronghold-intel') {
            if (isDeathsGateStronghold(sector)) return fail('No field cache is available in the Obsidian Stronghold.');
            // A retry after a successful claim should return the same receipt even if
            // the player has since moved. An unclaimed cache cannot bypass a patrol.
            if (visit.intelClaimed) return snapshot(playerName, visit);
            if (visit.patrolId || visit.threat >= 100) return fail('Resolve the patrol first.');
            const presence = onlineStore.get(playerName);
            if (presence?.pendingAttacker || presence?.inBattle || (presence?.travelingUntil ?? 0) > Date.now()) {
                return fail('Finish your current combat or travel before inspecting the cache.');
            }
            if (visit.tile !== STRONGHOLD_INTEL_TILE || !visit.visited.includes(STRONGHOLD_INTEL_TILE)) {
                return fail('Reach the cache in the War Archives first.');
            }
            visit = { ...visit, intelClaimed: true, version: visit.version + 1 };
            await kv.set(key, visit, { ex: TTL });
            return snapshot(playerName, visit);
        }
        if (!['stronghold-enter', 'stronghold-state', 'stronghold-step'].includes(action)) return fail('Unknown stronghold action.', 400);
        if (action === 'stronghold-step' && body.version === visit.version && !visit.patrolId && visit.threat < 100) {
            const presence = onlineStore.get(playerName);
            if (presence?.pendingAttacker || presence?.inBattle || (presence?.travelingUntil ?? 0) > Date.now()) return fail('Finish your current combat or travel before moving.');
            const record = saveFacts;
            if (!record?.character || isIncapacitated(record.character, Date.now())) return fail('Recover before exploring the stronghold.');
            const next = advanceStronghold(visit, Number(body.tile));
            if (!next) return fail('Choose an adjacent open tile.');
            visit = next;
            // Persist the threshold before creating combat. A failed response resumes it.
            if (visit.threat >= 100) visit.patrolId = `shp-${visit.id}-${visit.steps}`;
            await kv.set(key, visit, { ex: TTL });
        }
        if (visit.patrolId) {
            const patrolId = visit.patrolId;
            let admissionSaveVersion: unknown;
            let session = await readSoloPveSession(visit.patrolId);
            if (!session) {
                const authority = await resolveBattleAuthority(playerName, battleEvidenceFrom(await kv.mget(...battleAuthorityKeys(playerName))));
                if (authority.inBattle || onlineStore.get(playerName)?.pendingAttacker) return snapshot(playerName, visit, { combatBlocked: true });
                // Every other fight this player is holding is settled before the
                // patrol is sealed from the save (api/pve/_held-fights.ts).
                const held = await settleHeldFights(playerName, { except: visit.patrolId });
                if (!held.ok) return fail(held.error, held.status);
                const admission = await withWorldBossPvpLock([playerName], () => withCombatAdmissionSave(playerName, async (fresh) => {
                    admissionSaveVersion = fresh._saveVersion;
                    if (onlineStore.get(playerName)?.pendingAttacker || await unrelatedStrongholdBattle(playerName)) return false;
                    const save = await augmentSaveWithForgedDefs(fresh);
                    const character = save?.character as Record<string, unknown> | undefined;
                    if (!save || !character || isIncapacitated(character, Date.now())) return { failure: fail('Recover before facing the patrol.') };
                    const profiles = ['story-ai-ashen-leaf-village-15', 'story-ai-stormveil-village-15', 'story-ai-frostfang-village-25'];
                    const profile = builtinAiProfile(profiles[(Math.floor(visit.steps / 25) - 1) % profiles.length]);
                    if (!profile) return { failure: fail('The patrol could not be prepared.', 503) };
                    // The sector's sky, the same one the vault fight in this
                    // stronghold seals (api/village/anbu-infiltration.ts).
                    const sky = await sealedSectorWeather(sector, Date.now());
                    session = buildSoloPveAiEncounter({ sessionId: patrolId, playerName, save, now: Date.now(),
                        admin: await loadAdminCombatContent(), profile: { ...profile, name: (isDeathsGateStronghold(sector)
                            ? ['Cinder Sentry', 'Ash Stalker', 'Obsidian Warden']
                            : ['Stronghold Sentry', 'Stronghold Skirmisher', 'Stronghold Sealkeeper'])[(Math.floor(visit.steps / 25) - 1) % 3] },
                        scaling: { level: Math.max(1, Math.min(100, Number(character.level) - 10)) },
                        continuousVitals: true, encounter: { kind: 'stronghold-patrol', id: String(sector), bindingId: visit.id, metadata: { sector } },
                        environment: { biome: sectorPlace(sector)?.biome ?? 'central', ...sky },
                    });
                    if (onlineStore.get(playerName)?.pendingAttacker || await unrelatedStrongholdBattle(playerName)) return false;
                    await writeSoloPveSession(session!);
                    return true;
                }));
                if (!admission.ok || !admission.value) return snapshot(playerName, visit, { combatBlocked: true });
                if (typeof admission.value === 'object') return admission.value.failure;
            } else if (session.status === 'active' && session.expiresAt <= Date.now()) {
                const lapsed = await terminalizeLapsedSoloPveSession(session.sessionId);
                if (lapsed.ok && lapsed.session) session = lapsed.session;
            }
            return snapshot(playerName, visit, { patrol: session, ...(admissionSaveVersion ? { _saveVersion: admissionSaveVersion } : {}) });
        }
        return snapshot(playerName, visit);
    }, { failClosed: true, ttlSec: 30 });
}
