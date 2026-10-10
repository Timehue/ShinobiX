/*
 * The Solo-PvE terminal hook for Sector War garrison assaults.
 *
 * A garrison assault (api/_sector-war-garrison-encounter.ts) is an ordinary
 * Solo-PvE session, fought over /api/solo-pve/action like any other. What sets
 * it apart is that its result scores a sector war and costs the attacker HP
 * and items — and that settlement used to wait for the attacker's own client
 * to call garrison-resolve. A client that never called it (a closed tab, a
 * blocked request, a loss somebody would rather not report) settled nothing:
 * the defence never got its hold points, and the loss never cost its hospital
 * stay or its items.
 *
 * So the request that ENDS the fight (action.ts), or the first read that finds
 * it ended (state.ts), settles it here and now. It is the same exactly-once
 * settle garrison-resolve uses (api/_sector-war-garrison-settle.ts); the
 * client's own report then replays the cached answer.
 *
 * Best-effort, and silent toward the combat request: the fight is already over
 * and stored, and if it cannot be settled this instant, garrison-resolve and
 * the next garrison-start still will. The settle module is loaded lazily so the
 * hot action path pays for it only when a garrison fight actually ends.
 */
import type { SoloPveSession } from './_session.js';
import { GARRISON_ENCOUNTER_KIND } from '../_sector-war-garrison-encounter.js';

export async function settleTerminalGarrisonFight(session: SoloPveSession | null | undefined): Promise<void> {
    if (!session || session.status !== 'done' || session.encounter?.kind !== GARRISON_ENCOUNTER_KIND) return;
    try {
        const { settleTerminalGarrisonSession } = await import('../_sector-war-garrison-settle.js');
        await settleTerminalGarrisonSession(session);
    } catch (error) {
        console.warn('[solo-pve] garrison terminal settlement deferred:', (error as Error)?.message ?? error);
    }
}
