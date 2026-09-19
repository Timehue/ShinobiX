import type { CaravanNode, CaravanNodeKind } from '../../../../shared/sunscar/caravan-types';
export const CARAVAN_NODE_LABELS: Record<CaravanNodeKind, string> = { combat: 'Ambush', event: 'Field report', camp: 'Hidden camp', merchant: 'Supplier', ruins: 'Sealed ruins', hazard: 'Hazard', treasure: 'Supply cache', pet: 'Wild trail', traveler: 'Road contact', elite: 'Rogue shinobi', boss: 'Route guardian', destination: 'Rendezvous' };
export const CARAVAN_MISSION_RANKS = ['C-rank escort', 'B-rank escort', 'A-rank escort'] as const;
export const CARAVAN_REGIONS: Record<CaravanNode['region'], string> = { dunes: 'Sunscar borderlands', canyon: 'Scorpion Pass', ruins: 'The sealed shrine', oasis: 'Reedwatch outpost' };
