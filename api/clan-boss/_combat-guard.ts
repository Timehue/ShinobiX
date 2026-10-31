import type { TowerSession, TowerActor } from '../towers/_tower-session.js';
import type { TowerAction } from '../towers/_engine.js';
export { clanBossGuardMultiplier } from '../../shared/clan-boss-guard.js';

export function syncClanBossGuard(session: TowerSession): void {
    const state = session.towerId === 'clan-boss' ? session.clanBossGuard : undefined;
    if (!state || state.round === session.round) return;
    state.round = session.round;
    state.contributors = [];
    session.log.push(session.round <= state.openThroughRound
        ? `Raid Guard open through round ${state.openThroughRound}: direct hits reduced 25%.`
        : 'Raid Guard: direct hits reduced 75%. Two distinct human fighters making useful actions, Clear, pylon disruption, human fighter displacement or avoiding its signature opens it.');
}
export function openClanBossGuard(session: TowerSession, reason: string, throughRound = session.round + 1): void {
    const state = session.towerId === 'clan-boss' ? session.clanBossGuard : undefined;
    if (!state || session.round <= state.openThroughRound) return;
    state.openThroughRound = throughRound;
    state.contributors = [];
    state.openings[reason] = (state.openings[reason] ?? 0) + 1;
    session.log.push(`Raid Guard opened by ${reason} through round ${throughRound}. Direct hits reduced 25%; the guard reforms afterward.`);
}
export function clanBossGuardSnapshot(session: TowerSession) {
    if (session.towerId !== 'clan-boss' || !session.clanBossGuard) return undefined;
    return {
        actors: session.actors.map(a => ({ id: a.id, side: a.side, hp: a.hp, shield: a.shield, pos: a.pos,
            positive: a.statuses.filter(s => s.kind === 'positive').length,
            negative: a.statuses.filter(s => s.kind === 'negative').length })),
        pylons: session.towerTactics?.disruptedPylons.length ?? 0,
    };
}
export function noteClanBossGuardAction(session: TowerSession, action: TowerAction, before: ReturnType<typeof clanBossGuardSnapshot>): void {
    const state = session.towerId === 'clan-boss' ? session.clanBossGuard : undefined;
    if (!state || !before) return;
    const actor = session.actors.find(a => a.id === action.actorId);
    if (!isHuman(actor) || ['wait', 'move', 'dash', 'summon'].includes(action.type)) return;
    if ((session.towerTactics?.disruptedPylons.length ?? 0) > before.pylons) {
        openClanBossGuard(session, 'pylon disruption'); return;
    }
    const boss = session.actors.find(a => a.id === state.bossId);
    if (boss && before.actors.find(a => a.id === boss.id)?.pos !== boss.pos) {
        openClanBossGuard(session, 'displacement'); return;
    }
    const useful = session.actors.some(a => {
        const b = before.actors.find(old => old.id === a.id);
        if (!b) return false;
        const pos = a.statuses.filter(s => s.kind === 'positive').length;
        const neg = a.statuses.filter(s => s.kind === 'negative').length;
        return a.side === 'enemy' ? a.hp < b.hp || a.shield < b.shield || neg > b.negative || pos < b.positive
            : a.hp > b.hp || a.shield > b.shield || neg < b.negative || pos > b.positive;
    });
    if (useful && session.round > state.openThroughRound) {
        if (!state.contributors.includes(actor!.ownerSlug)) state.contributors.push(actor!.ownerSlug);
        if (state.contributors.length >= 2) openClanBossGuard(session, 'team pressure');
    }
}
export function isHuman(actor: TowerActor | undefined): actor is TowerActor & { ownerSlug: string } {
    return !!actor && actor.side === 'squad' && !!actor.ownerSlug && !actor.ai && !actor.character.companion;
}
export function clanBossPhasePercent(session: TowerSession, boss: TowerActor): number {
    const hp = session.towerId === 'clan-boss' ? session.clanBossGuard?.sharedHp : undefined;
    return hp ? Math.max(0, Math.min(100, 100 * (hp.remainingAtStart - Math.max(0, hp.assaultHp - boss.hp)) / hp.poolMax))
        : 100 * boss.hp / boss.maxHp;
}
