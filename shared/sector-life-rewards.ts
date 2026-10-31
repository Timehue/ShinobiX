import type { LifeEventView } from './sector-life.js';
import type { LifeEventKind } from './sector-life-content.js';
import { DOCK_SHIPMENT_SCENARIO } from './sector-dock-shipment.js';

type Work = Pick<LifeEventView, 'kind' | 'step' | 'scenario' | 'sector'>;
/** Shared rounds pay the player doing each piece of work, not just the final visitor. */
export const LIFE_WORK_RYO: Record<LifeEventKind, readonly [number, number, number]> = {
    supplies: [50, 50, 75],
    lanterns: [50, 50, 50],
    signal: [50, 50, 100],
    tea: [25, 25, 50],
    shrine: [0, 50, 50],
    courier: [0, 250, 0],
    // The sealed tracker trail already leads to a normal wild pet encounter.
    tracks: [0, 0, 0],
};
export function lifeWorkRyo(event: Work): readonly [number, number, number] {
    return event.scenario === DOCK_SHIPMENT_SCENARIO ? [50, 150, 50] : LIFE_WORK_RYO[event.kind];
}
export function lifeStepRyo(event: Work): number {
    return lifeWorkRyo(event)[event.step] ?? 0;
}
export function lifeRewardHint(event: Work): string {
    if (event.kind === 'tracks') return 'Reward: follow the trail to a wild pet encounter. Befriending is not guaranteed.';
    const ryo = lifeStepRyo(event);
    if (!ryo) return event.kind === 'courier'
        ? event.step === 0 ? 'Help the courier stand to earn 250 Ryō.' : 'Rescue reward: 250 Ryō for the helper who gets the courier back on their feet.'
        : 'Tend the shrine lamps to earn 50 Ryō each.';
    const total = lifeWorkRyo(event).reduce((sum, amount) => sum + amount, 0);
    return ryo === total ? `Reward: ${ryo} Ryō.` : `This task pays ${ryo} Ryō. The full round pays ${total} Ryō across its helpers.`;
}
/** Only the people involved in the current errand offer its work dialog. */
export function lifeActorOffersWork(id: string | undefined, event: Work): boolean {
    return id === `resident:${event.sector}`
        || event.kind === 'courier' && id === `courier:${event.sector}`
        || event.kind === 'shrine' && id === `keeper:${event.sector}`
        || event.scenario === DOCK_SHIPMENT_SCENARIO && (id === 'shipment:merchant' || id === 'shipment:guard');
}
