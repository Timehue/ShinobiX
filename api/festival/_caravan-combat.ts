import { AI_PROFILE_CATALOG } from '../_ai-profile-catalog.js';
import { loadAdminCombatContent } from '../_admin-content.js';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { buildSoloPveAiEncounter } from '../solo-pve/_ai-encounter.js';
import { isSoloPveSessionLapsed } from '../solo-pve/_session.js';
import { readSoloPveSession, writeSoloPveSession } from '../solo-pve/_store.js';
import { settlePveFightOutcome } from '../pve/_fight-outcome-settlement.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import { battleLockedFor, isIncapacitated } from '../_elapsed-state.js';
import { reconcileLapsedBattle } from '../_battle-lapse.js';
import { FestivalError } from './_rally.js';
import { requireCaravan, settleCaravanCombat } from './_caravan.js';
import type { CaravanEnemy } from '../../shared/sunscar/caravan-types.js';
import { appendBattleHistory, buildActionsFromTowerLog, makeBattleEntry } from '../../shared/battle-history.js';

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
export async function startCaravanCombat(player: string, runId: string) {
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
