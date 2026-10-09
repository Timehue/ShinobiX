import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { isSoloPveSessionLapsed } from '../solo-pve/_session.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { applyPveOutcomeBodyOnce, markPveOutcomeSettled, readPveOutcomeMarker, settlePveFightOutcome } from '../pve/_fight-outcome-settlement.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { kv } from '../_storage.js';
import { battleLockedFor, isIncapacitated } from '../_elapsed-state.js';
import { reconcileLapsedBattle } from '../_battle-lapse.js';
import { FestivalError } from './_rally.js';
import { requireCaravan, settleCaravanCombat } from './_caravan.js';
import type { CaravanEnemy } from '../../shared/sunscar/caravan-types.js';
import { appendBattleHistory, buildActionsFromTowerLog, makeBattleEntry } from '../../shared/battle-history.js';
import { claimTowerBattleLeases, releaseTowerBattleLeases, towerBattleLeaseMembers } from '../towers/_battle-lease.js';
import { initializeTowerActionVersion } from '../towers/_action-idempotency.js';
import { buildTowerEncounter, type SquadMemberInput } from '../towers/_encounter.js';
import { startRound, runAiUntilHuman } from '../towers/_engine.js';
import { sealTowerFighter, sealTowerItemCharges } from '../towers/_seal.js';
import { makeRng } from '../towers/_sim.js';
import { stampTurnClock } from '../towers/_tower-mp.js';
import { readSession, settleConsumedItemsForMember, writeSession } from '../towers/_tower-store.js';
import type { TowerFloor } from '../towers/_floor-catalog.js';
import type { TowerSession } from '../towers/_tower-session.js';
import { builtinAiProfile } from '../_ai-profile-catalog.js';
import { relevelAiProfile, type RelevelableProfile } from '../_ai-level-curves.js';
import { resolveAiProfileJutsu } from '../_ai-opponent-loadout.js';
import type { EnemyTemplate } from '../towers/_enemy-templates.js';
import { needsTowerLapseReconciliation } from '../towers/_tower-store.js';
import { sealCompanionFromSave } from '../combat-core/companion.js';
import type { AdminCombatContent } from '../_admin-content.js';
import { applyCompanionUsageCost } from '../solo-pve/_settlement.js';

/** Profiles use existing catalog kits, AI rules and level curves. Encounters
 * get their Sunscar identity here without changing the main combat engine. */
export const CARAVAN_ENEMIES: Record<CaravanEnemy, { name: string; profile: string; levelOffset: number; intro: string; outro: string }> = {
    raider: { name: 'Dune Road Raider', profile: 'builtin-ai-ember-duelist', levelOffset: -2, intro: 'Leave one crate. Keep the rest.', outro: 'The raider drops his weapon and retreats into the cut.' },
    captain: { name: 'Dune Raider Captain', profile: 'builtin-ai-rogue-ninja', levelOffset: 2, intro: 'No one passes this ridge without my leave.', outro: 'The captain’s signal flag comes down. The pass is open.' },
    wyrm: { name: 'Sand Wyrm', profile: 'hunt-ai-moon-serpent', levelOffset: 2, intro: 'The road rises in a long, armored coil.', outro: 'The wyrm sinks beneath the dunes, leaving the road still.' },
    scorpion: { name: 'Scorpion Queen', profile: 'hunt-ai-ironback-bear', levelOffset: 1, intro: 'A hooked tail rises above the ruined arch.', outro: 'The queen withdraws into the rock. Her brood follows.' },
    rogue: { name: 'Rogue Shinobi Escort', profile: 'builtin-ai-rogue-ninja', levelOffset: 1, intro: 'I am only here for the manifest.', outro: 'The hired shinobi leaves the road without looking back.' },
    sentinel: { name: 'Buried Shrine Sentinel', profile: 'builtin-ai-frost-sealer', levelOffset: 1, intro: 'An old seal catches the light beneath its armor.', outro: 'The sentinel returns to its alcove. The inscription dims.' },
};

const AMBUSH_ROSTER = [
    { name: 'Dune Knife', profile: 'builtin-ai-ember-duelist', role: 'skirmisher', targetMode: 'lowest-hp', hp: .66, stats: .74 },
    { name: 'Sunscar Marksman', profile: 'builtin-ai-rogue-ninja', role: 'artillery', targetMode: 'squishiest', hp: .60, stats: .72 },
    { name: 'Ridge Shield', profile: 'builtin-ai-mist-sentinel', role: 'vanguard', targetMode: 'lowest-hp', hp: .78, stats: .72 },
    { name: 'Seal-Breaker', profile: 'builtin-ai-shadow-weaver', role: 'controller', targetMode: 'support', hp: .58, stats: .74 },
    { name: 'Dune Enforcer', profile: 'builtin-ai-rogue-ninja', role: 'bruiser', targetMode: 'lowest-hp', hp: .72, stats: .76 },
] as const;

function stableHash(value: string): number {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    return hash >>> 0;
}

export function ambushFloor(run: ReturnType<typeof requireCaravan>['run'], admin: AdminCombatContent | null, levelRaw: unknown): { floor: TowerFloor; templates: Record<string, EnemyTemplate> } {
    const enemyCount = 3 + (stableHash(`${run.day}:${run.seed}:${run.combat!.nodeId}`) % 3);
    const pressure = Math.max(0, Math.min(2, run.contract.difficulty - 1));
    const enemyLevel = Math.max(1, Math.min(100, Math.floor(Number(levelRaw) || 1) + pressure));
    const templates: Record<string, EnemyTemplate> = {};
    const enemies = Array.from({ length: enemyCount }, (_, index) => {
        const archetype = AMBUSH_ROSTER[index % AMBUSH_ROSTER.length]!;
        const base = builtinAiProfile(archetype.profile);
        if (!base) throw new FestivalError('The ambush roster could not be prepared.', 503);
        const loadout = resolveAiProfileJutsu(base.jutsuIds, admin);
        const profile = relevelAiProfile(structuredClone(base) as unknown as RelevelableProfile, enemyLevel, 4, 0, loadout);
        const multiplier = archetype.stats * (1 + pressure * .08);
        templates[`sunscar-ambush-${index}`] = {
            name: archetype.name,
            specialty: ['Taijutsu', 'Bukijutsu', 'Genjutsu', 'Ninjutsu'].includes(String(profile.specialty)) ? String(profile.specialty) as EnemyTemplate['specialty'] : 'Ninjutsu',
            level: enemyLevel,
            hp: Math.max(250, Math.floor(Number(profile.hp) * archetype.hp * (1 + pressure * .12))),
            maxChakra: Math.max(60, Math.floor(Number(profile.chakra) * .7)),
            maxStamina: Math.max(60, Math.floor(Number(profile.stamina) * .7)),
            stats: Object.fromEntries(Object.entries(profile.stats).map(([key, value]) => [key, Math.max(1, Math.floor(Number(value) * multiplier))])),
            visual: archetype.profile,
            role: archetype.role,
            targetMode: archetype.targetMode,
            jutsu: resolveAiProfileJutsu(profile.jutsuIds, admin),
        };
        return { aiId: `sunscar-ambush-${index}`, count: 1 };
    });
    const floor: TowerFloor = {
        id: 9101,
        name: 'Sunscar Caravan Ambush',
        biome: 'central',
        objective: 'defeat-all',
        roundBudget: 12,
        map: { width: 18, height: 12 },
        fieldRule: { kind: 'none' },
        enemies,
        terrainPillars: 6,
        balanceFor: 1,
        firstClearReward: {},
        chapter: 0,
        chapterTitle: 'Sunscar Dispatch',
        chapterSubtitle: `${enemyCount} attackers · ${run.contract.title}`,
        chapterSummary: 'A concealed road cell closes in on the convoy. Break through before the attackers scatter the wagons.',
        briefing: {
            situation: `${enemyCount} Sunscar raiders have sealed the road. You are the only shinobi between them and the caravan.`,
            tactics: ['Enemy roles differ: close the gap carefully, then prioritize a target to prevent their group pressure from stacking.', 'Pillars break long sightlines. Use cover and your equipped kit to control the fight pace.'],
            warnings: [`Solo battle against ${enemyCount} enemies`, 'No new assets or combat rules; standard Tower actions and AI'],
        },
    };
    return { floor, templates };
}

function isTowerCaravanRun(runId: string): boolean { return runId.startsWith('caravan-tower:'); }

async function startTowerCaravanCombat(player: string, runId: string): Promise<TowerSession> {
    let claimed = false;
    let published = false;
    try {
    const session = await mutatePlayerSave(player, async ({ character, record }) => {
        const { run } = requireCaravan(character, runId);
        if (run.status !== 'combat' || !run.combat || run.combat.settled || !isTowerCaravanRun(run.combat.sessionId)) {
            throw new FestivalError('There is no pending ambush.', 409);
        }
        const existing = await readSession(run.combat.sessionId);
        if (existing?.caravanAmbush?.runId === run.id && existing.caravanAmbush.playerSlug === player) {
            return { ok: true, character, value: existing, write: false };
        }
        if (isIncapacitated(character) || Number(character.hp) <= 0) throw new FestivalError('Recover at the hospital before resuming this encounter.', 409);
        const lease = await claimTowerBattleLeases({ runId: run.combat.sessionId, members: [player] });
        if (!lease.ok) throw new FestivalError('Finish your active battle before starting this ambush.', 409);
        claimed = true;
        const admin = await loadAdminCombatContent();
        const save = await augmentSaveWithForgedDefs(record);
        if (!save) throw new FestivalError('Your combat loadout could not be sealed.', 503);
        const loadout = sealTowerFighter(character, save, { activePetId: run.selectedPetId }, admin);
        const squad: SquadMemberInput[] = [{
            id: 'sq-0', name: String(character.name ?? player), ownerSlug: player, ai: false,
            character: loadout, itemCharges: sealTowerItemCharges(character),
        }];
        const { floor, templates } = ambushFloor(run, admin, character.level);
        const seed = stableHash(`${run.day}:${run.seed}:${run.combat.nodeId}:tower`) || 1;
        const now = Date.now();
        const tower = buildTowerEncounter({ floor, squad, runId: run.combat.sessionId, seed, partySize: 1, now,
            towerId: 'sunscar-caravan-ambush', embedFloor: true, enemyTemplates: templates });
        const actor = tower.actors.find(candidate => candidate.id === 'sq-0')!;
        actor.hp = Math.max(1, Math.min(actor.maxHp, Number(character.hp) || actor.maxHp));
        actor.chakra = Math.max(0, Math.min(actor.maxChakra, Number(character.chakra) || 0));
        actor.stamina = Math.max(0, Math.min(actor.maxStamina, Number(character.stamina) || 0));
        tower.pendingCompanion = sealCompanionFromSave({ ...character, activePetId: run.selectedPetId }, now) ?? undefined;
        tower.caravanAmbush = { runId: run.id, playerSlug: player, nodeId: run.combat.nodeId };
        tower.floorProvenance = { kind: 'embedded', mintedBy: 'authoritative-pve', contentVersion: 'sunscar-caravan-ambush.1', floorId: floor.id };
        initializeTowerActionVersion(tower);
        startRound(tower);
        runAiUntilHuman(tower, floor, makeRng(seed));
        // Tower turn start regenerates the active actor. This is a continuous
        // Caravan run, so preserve the player's actual entry resources after
        // the opening enemy turn instead of granting a free refill on launch.
        actor.chakra = Math.max(0, Math.min(actor.maxChakra, Number(character.chakra) || 0));
        actor.stamina = Math.max(0, Math.min(actor.maxStamina, Number(character.stamina) || 0));
        stampTurnClock(tower, now);
        await writeSession(tower);
        published = true;
        return { ok: true, character, value: tower, write: false };
    });
    if (!session.ok) throw new FestivalError(session.error, session.status);
    return session.value;
    } catch (error) {
        if (claimed && !published) {
            const save = await mutatePlayerSave(player, ({ character }) => {
                const { run } = requireCaravan(character, runId);
                return { ok: true, character, value: run.combat?.sessionId ?? '', write: false };
            }).catch(() => null);
            if (save?.ok && save.value) await releaseTowerBattleLeases(save.value, [player]).catch(() => undefined);
        }
        throw error;
    }
}

async function finishTowerCaravanCombat(player: string, runId: string) {
    const snapshot = await mutatePlayerSave(player, ({ character }) => {
        const { run } = requireCaravan(character);
        if (!run.combat) throw new FestivalError('There is no expedition battle to resolve.', 409);
        return { ok: true, character, value: { ...run.combat }, write: false };
    });
    if (!snapshot.ok) throw new FestivalError(snapshot.error, snapshot.status);
    const combat = snapshot.value;
    let session = await readSession(combat.sessionId);
    if (!session || session.caravanAmbush?.runId !== runId || session.caravanAmbush.playerSlug !== player) {
        throw new FestivalError('The ambush record could not be verified.', 409);
    }
    if (session.status === 'active' && needsTowerLapseReconciliation(session)) {
        await reconcileLapsedBattle({ kind: 'tower', sessionId: session.runId }, player);
        session = await readSession(session.runId) ?? session;
    }
    if (session.status !== 'done') throw new FestivalError('Finish the ambush before continuing the expedition.', 409);
    await settleConsumedItemsForMember({ session, slug: player });
    const actor = session.actors.find(candidate => candidate.side === 'squad' && candidate.ownerSlug === player && candidate.ai === false);
    if (!actor) throw new FestivalError('The sealed shinobi could not be found.', 409);
    const winner = session.winner === 'squad';
    // The ambush's HP lands ONCE across this settle and the generic pve-outcome
    // path, which reads this Tower run too (/api/pve/fight-outcome). Both used
    // to write it, so a late second write set HP back up to the ambush's end value.
    const markedSettled = await readPveOutcomeMarker(session, player);
    let bodyWritten = false;
    const out = await mutatePlayerSave(player, ({ character }) => {
        bodyWritten = false;
        const { run } = requireCaravan(character);
        if (!run.combat || run.combat.sessionId !== session!.runId) throw new FestivalError('This battle belongs to another expedition.', 409);
        if (run.combat.settled) return { ok: true, character, value: { outcome: winner ? 'win' : 'loss' }, write: false };
        const now = Date.now();
        const physical = applyPveOutcomeBodyOnce({
            character, session: session!, playerName: player, now,
            outcome: winner ? 'win' : session!.winner === 'draw' ? 'draw' : 'loss',
            continuousVitals: true, markedSettled,
        });
        bodyWritten = physical.bodyWritten;
        const withPetCosts = applyCompanionUsageCost(physical.character, session!.companionUsage);
        const next = settleCaravanCombat(withPetCosts, session!.runId, winner, now);
        const id = `arena-${session!.runId}`;
        const history = Array.isArray(next.battleHistory) ? next.battleHistory as Parameters<typeof appendBattleHistory>[0] : undefined;
        if (!history?.some(entry => entry.id === id)) {
            const entry = makeBattleEntry({ id, ts: session!.lastActionAt, mode: 'Caravan ambush', opponent: `${session!.actors.filter(a => a.side === 'enemy').length} raiders`, self: actor.name,
                outcome: winner ? 'win' : session!.winner === 'draw' ? 'draw' : 'loss', rounds: session!.round,
                actions: buildActionsFromTowerLog(
                    winner ? session!.log : [...session!.log, 'The escort has ended.'],
                    [actor.name], session!.actors.filter(a => a.side === 'enemy').map(a => a.name),
                ) });
            next.battleHistory = appendBattleHistory(history, entry);
        }
        return { ok: true, character: next, value: { outcome: winner ? 'win' : 'loss' }, write: true };
    });
    if (!out.ok) throw new FestivalError(out.error, out.status);
    if (bodyWritten) await markPveOutcomeSettled(session, player, Date.now());
    if (session.rewardSettlementState !== 'settled') {
        session.rewardSettlementState = 'settled';
        await writeSession(session);
    }
    await releaseTowerBattleLeases(session.runId, towerBattleLeaseMembers(session));
    return out;
}

export async function startCaravanCombat(player: string, runId: string) {
    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${player}`);
    const current = save?.character ? (save.character.sunscarCaravan as { current?: { id?: string; combat?: { sessionId?: string } } } | undefined)?.current : undefined;
    if (current?.id === runId && current.combat?.sessionId?.startsWith('caravan-tower:')) return startTowerCaravanCombat(player, runId);
    let sessionId = '';
    const checked = await mutatePlayerSave(player, async ({ character, record }) => {
        const { run } = requireCaravan(character, runId);
        if (run.status !== 'combat' || !run.combat || run.combat.settled) throw new FestivalError('There is no pending expedition battle.', 409);
        sessionId = run.combat.sessionId;
        const existing = await readSoloPveSession(sessionId);
        if (existing) return { ok: true, character, value: existing, write: false };
        if (isIncapacitated(character) || Number(character.hp) <= 0) throw new FestivalError('Recover at the hospital before resuming this encounter.', 409);
        if (await battleLockedFor(player)) throw new FestivalError('Finish your active battle before starting this encounter.', 409);
        const enemy = CARAVAN_ENEMIES[run.combat.enemy];
        const catalog = AI_PROFILE_CATALOG[enemy.profile];
        if (!catalog) throw new FestivalError('The encounter could not be prepared.', 503);
        const save = await augmentSaveWithForgedDefs({ ...record, character: { ...character, activePetId: run.selectedPetId } });
        const profile = { ...catalog, id: `sunscar-${run.combat.enemy}`, name: enemy.name, visual: enemy.profile, isBossAi: run.combat.enemy !== 'raider' };
        const session = buildSoloPveAiEncounter({ sessionId, playerName: player, save: save!, profile, now: Date.now(), admin: await loadAdminCombatContent(), continuousVitals: true,
            scaling: { level: Math.max(1, Math.min(100, (Number(character.level) || 1) + enemy.levelOffset + run.contract.difficulty - 1)) },
            // Cactus Flats uses the existing central combat biome (sector-geo).
            encounter: { kind: 'caravan', id: run.combat.nodeId, bindingId: run.id, sourceId: enemy.profile, metadata: { returnScreen: 'sunscarFestival' } }, environment: { biome: 'central', blockedTiles: [] },
        });
        await writeSoloPveSession(session);
        return { ok: true, character, value: session, write: false };
    });
    if (!checked.ok) throw new FestivalError(checked.error, checked.status);
    if (isSoloPveSessionLapsed(checked.value)) {
        await reconcileLapsedBattle({ kind: 'solo-pve', sessionId }, player);
        return await readSoloPveSession(sessionId) ?? checked.value;
    }
    return checked.value;
}
export async function finishCaravanCombat(player: string, runId: string) {
    const snapshot = await mutatePlayerSave(player, ({ character }) => {
        const { run } = requireCaravan(character, runId);
        if (!run.combat) throw new FestivalError('There is no expedition battle to resolve.', 409);
        return { ok: true, character, value: { ...run.combat }, write: false };
    });
    if (!snapshot.ok) throw new FestivalError(snapshot.error, snapshot.status);
    if (isTowerCaravanRun(snapshot.value.sessionId)) return finishTowerCaravanCombat(player, runId);
    let session = await readSoloPveSession(snapshot.value.sessionId);
    if (!session || session.ownerSlug !== player || session.encounter.kind !== 'caravan' || session.encounter.bindingId !== runId) throw new FestivalError('The expedition’s combat record could not be verified.', 409);
    if (isSoloPveSessionLapsed(session)) {
        await reconcileLapsedBattle({ kind: 'solo-pve', sessionId: session.sessionId }, player);
        session = await readSoloPveSession(session.sessionId) ?? session;
    }
    if (session.status !== 'done') throw new FestivalError('Finish the battle before continuing the expedition.', 409);
    const physical = await settlePveFightOutcome(session, player);
    if (!physical.ok) throw new FestivalError(physical.error, physical.status);
    // Physical costs have their own existing receipt; a crash between these
    // writes safely retries both without healing, duplicating items, or rewards.
    return await mutatePlayerSave(player, ({ character }) => {
        const next = settleCaravanCombat(character, session!.sessionId, session!.outcome === 'win', Date.now());
        // Use the shared HUD's existing history format, committed alongside the
        // expedition outcome. A later authoritative save or a closed result tab
        // must not erase the client HUD's freshly recorded reflection entry.
        const id = `arena-${session!.sessionId}`;
        const history = Array.isArray(next.battleHistory) ? next.battleHistory as Parameters<typeof appendBattleHistory>[0] : undefined;
        if (!history?.some(entry => entry.id === id)) {
            const entry = makeBattleEntry({
                id, ts: session!.terminalEvidence?.finishedAt ?? session!.lastActionAt,
                mode: 'Caravan escort', opponent: session!.enemy.name, self: session!.player.name,
                outcome: session!.winner === 'player' ? 'win' : session!.winner === 'draw' ? 'draw' : 'loss',
                rounds: session!.round,
                actions: buildActionsFromTowerLog(session!.log, [session!.player.name, session!.companion?.name ?? ''], [session!.enemy.name]),
            });
            return { ok: true, character: { ...next, battleHistory: appendBattleHistory(history, entry) }, value: { outcome: session!.outcome }, write: true };
        }
        return { ok: true, character: next, value: { outcome: session!.outcome }, write: next !== character };
    });
}
