import { CARAVAN_EVENTS } from './caravan-events.js';
import { sunscarRandom } from './random.js';
import type { CaravanContract, CaravanEvent, CaravanNode, CaravanNodeKind, CaravanWeather } from './caravan-types.js';

export function weightedCaravanEvent(events: readonly CaravanEvent[], rand: () => number): CaravanEvent {
    if (!events.length) throw new Error('Encounter pool is empty.');
    const total = events.reduce((sum, e) => sum + (e.weight ?? 1), 0);
    let roll = rand() * total;
    for (const event of events) { roll -= event.weight ?? 1; if (roll < 0) return event; }
    return events[events.length - 1];
}
const bossEvents = { captain: 'captain-line', wyrm: 'wyrm-crossing', scorpion: 'scorpion-den', rogue: 'rogue-escort', sentinel: 'ruin-guardian', raider: 'raider-toll' } as const;
export function generateCaravanMap(seed: number, contract: CaravanContract, weather: CaravanWeather): CaravanNode[] {
    const rand = sunscarRandom(seed);
    const map: CaravanNode[] = [];
    const kinds: CaravanNodeKind[] = ['event', 'traveler', 'hazard', 'camp', 'merchant', 'ruins', 'treasure', 'pet', 'combat', 'elite'];
    const weighted = [...kinds, ...(weather === 'sandstorm' || weather === 'heat' ? ['hazard', 'hazard'] : weather === 'bandits' ? ['combat', 'combat'] : weather === 'festival' ? ['merchant', 'traveler'] : weather === 'night' ? ['ruins', 'ruins'] : ['event'])] as CaravanNodeKind[];
    const used = new Set<string>();
    for (let layer = 0; layer < contract.nodes; layer++) {
        const destination = layer === contract.nodes - 1;
        const count = destination ? 1 : layer === 0 ? 2 : rand() < .25 ? 4 : 3;
        for (let column = 0; column < count; column++) {
            let kind: CaravanNodeKind = destination ? 'destination' : weighted[Math.floor(rand() * weighted.length)];
            if (layer === 2 || layer === 6) kind = column === 0 ? 'combat' : column === count - 1 ? 'hazard' : 'elite';
            if (layer === 3 && column === 1) kind = 'camp';
            if (layer < 2 && (kind === 'elite' || kind === 'combat')) kind = 'event';
            if (layer === contract.nodes - 2 && contract.guaranteedBoss) kind = 'boss';
            if (layer === contract.nodes - 2 && contract.difficulty === 3 && !contract.guaranteedBoss) kind = 'boss';
            let eventId = '';
            if (!destination) {
                let pool = CARAVAN_EVENTS.filter(e => e.kind === kind && !e.requiresFlag && (!e.weather || e.weather.includes(weather)) && !used.has(e.id));
                if (!pool.length) pool = CARAVAN_EVENTS.filter(e => e.kind === kind && !e.requiresFlag);
                eventId = weightedCaravanEvent(pool, rand).id;
                if (kind === 'boss' && contract.guaranteedBoss) eventId = bossEvents[contract.guaranteedBoss];
                if (layer === 1 && column === 0 && contract.chain?.id === 'missing-shipment' && contract.chain.stage === 1) { eventId = 'watchtower-ledger'; kind = 'ruins'; }
                used.add(eventId);
            }
            map.push({ id: `${layer}-${column}`, layer, column, x: (column + 1) / (count + 1) * 100, y: layer * 135 + 75,
                kind, eventId, next: [], revealed: layer <= (weather === 'sandstorm' ? 0 : 1), region: layer < 3 ? 'dunes' : layer < 6 ? 'canyon' : layer < 8 ? 'ruins' : 'oasis' });
        }
    }
    for (const node of map) {
        const next = map.filter(n => n.layer === node.layer + 1);
        if (!next.length) continue;
        const nearest = [...next].sort((a, b) => Math.abs(a.x - node.x) - Math.abs(b.x - node.x));
        node.next = nearest.slice(0, 2).map(n => n.id);
        if (nearest[2] && rand() < .3) node.next.push(nearest[2].id);
    }
    // Each next-row node gets an incoming road, so an attractive camp/ruin is
    // never merely decorative. Edges always advance a layer: no cycles or traps.
    for (const node of map.filter(n => n.layer > 0)) {
        if (!map.some(n => n.next.includes(node.id))) {
            const prev = map.filter(n => n.layer === node.layer - 1).sort((a, b) => Math.abs(a.x - node.x) - Math.abs(b.x - node.x))[0];
            prev.next.push(node.id);
        }
    }
    return map;
}
