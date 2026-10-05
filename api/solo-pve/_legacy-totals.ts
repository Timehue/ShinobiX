import { SOLO_PVE_EVENT_HISTORY, type SoloPveCombatEvent, type SoloPveSession } from './_session.js';

export type SoloPveLegacyTotals = {
    healingDone: number;
    shieldsApplied: number;
    damageBlocked: number;
    damageDealt: number;
};

/** Applied facts only; shield expiry and companion attacks do not earn credit. */
export function soloPveLegacyTotals(
    session: Pick<SoloPveSession, 'player' | 'enemy'>,
    events: SoloPveCombatEvent[],
): SoloPveLegacyTotals {
    const totals: SoloPveLegacyTotals = { healingDone: 0, shieldsApplied: 0, damageBlocked: 0, damageDealt: 0 };
    for (const event of events) {
        const combat = event.combat;
        if (!combat?.applied) continue;
        const absorbed = (role: 'player' | 'enemy', fallback: number) => {
            if (!Array.isArray(event.log)) return fallback;
            const name = session[role].name;
            return event.log.reduce((total, line) => {
                const match = /^(\d+) absorbed by (.+)'s shield\.$/.exec(line);
                return total + (match?.[2] === name ? Number(match[1]) : 0);
            }, 0);
        };
        for (const fact of combat.healing) if (fact.role === 'player') totals.healingDone += fact.applied;
        for (const fact of combat.shielding) if (fact.role === 'player' && fact.applied > 0) totals.shieldsApplied++;
        for (const fact of combat.damage) {
            if (fact.target === 'player') totals.damageBlocked += absorbed('player', fact.toShield);
            if (fact.source === 'player' && fact.target === 'enemy') totals.damageDealt += fact.toHp + absorbed('enemy', fact.toShield);
        }
    }
    return totals;
}

/** Upgrade old active sessions from retained facts before trimming any more. */
export function appendSoloPveCombatEvent(session: SoloPveSession, event: SoloPveCombatEvent): void {
    const previous = session.legacyTotals ?? soloPveLegacyTotals(session, session.events ?? []);
    const added = soloPveLegacyTotals(session, [event]);
    session.legacyTotals = {
        healingDone: previous.healingDone + added.healingDone,
        shieldsApplied: previous.shieldsApplied + added.shieldsApplied,
        damageBlocked: previous.damageBlocked + added.damageBlocked,
        damageDealt: previous.damageDealt + added.damageDealt,
    };
    session.eventSeq = event.seq;
    session.events = [...session.events, event].slice(-SOLO_PVE_EVENT_HISTORY);
}
