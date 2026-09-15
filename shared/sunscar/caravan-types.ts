export type CaravanWeather = 'clear' | 'sandstorm' | 'heat' | 'bandits' | 'festival' | 'night';
export type CaravanNodeKind = 'combat' | 'event' | 'camp' | 'merchant' | 'ruins' | 'hazard' | 'treasure' | 'pet' | 'traveler' | 'elite' | 'boss' | 'destination';
export type CaravanTool = 'water' | 'repair' | 'smoke' | 'map' | 'medicine' | 'feed';
export type CaravanEnemy = 'raider' | 'captain' | 'wyrm' | 'scorpion' | 'rogue' | 'sentinel';
export type CaravanEffect = {
    cargo?: number; supplies?: number; morale?: number; reputation?: number; ryoCost?: number; bonus?: number;
    hpPercent?: number; chakraPercent?: number; staminaPercent?: number;
    addFlags?: string[]; removeFlags?: string[]; discovery?: string; combat?: CaravanEnemy; petTrail?: boolean;
    tools?: Partial<Record<CaravanTool, number>>; scout?: number;
};
export type CaravanChoice = {
    id: string; label: string; hint: string; result: string; effect: CaravanEffect;
    cost?: { supplies?: number; tool?: CaravanTool; ryoFraction?: number };
    requiresFlag?: string; excludesFlag?: string;
    outcomes?: { weight: number; result: string; effect: CaravanEffect }[];
};
export type CaravanEvent = {
    id: string; kind: CaravanNodeKind; title: string; scene: string; choices: CaravanChoice[];
    weight?: number; rare?: boolean; requiresFlag?: string; excludesFlag?: string; weather?: CaravanWeather[];
};
export type CaravanNode = { id: string; layer: number; column: number; x: number; y: number; kind: CaravanNodeKind; next: string[]; eventId: string; region: 'dunes' | 'canyon' | 'ruins' | 'oasis'; revealed: boolean };
export type CaravanContract = {
    id: string; title: string; employer: string; cargo: string; description: string; destination: string;
    difficulty: 1 | 2 | 3; reputationRequired: number; payoutFactor: number; nodes: number; supplies: number;
    objective: { kind: 'cargo' | 'help' | 'discovery' | 'combat'; target: number; label: string };
    chain?: { id: string; stage: number }; guaranteedBoss?: CaravanEnemy;
};
export type CaravanLog = { nodeId: string; title: string; text: string; cargo: number; supplies: number; morale: number };
export type CaravanRun = {
    id: string; day: string; seed: number; version: number; contract: CaravanContract; weather: CaravanWeather;
    map: CaravanNode[]; currentNodeId: string | null; available: string[]; visited: string[];
    status: 'travel' | 'encounter' | 'combat' | 'complete' | 'failed'; cargo: number; supplies: number; morale: number;
    tools: Record<CaravanTool, number>; flags: string[]; discoveries: string[]; reputation: number; bonus: number;
    enemiesDefeated: number; travelersHelped: number; selectedPetId: string | null; baseReward: number;
    log: CaravanLog[]; combat: { sessionId: string; enemy: CaravanEnemy; nodeId: string; settled: boolean } | null;
    petEncounter?: { requestId: string; token?: string; state: 'pending' | 'resolved' };
    result: { ryo: number; reputation: number; cargo: number; objectiveComplete: boolean; reason: string } | null;
    lastAction: { requestId: string; fingerprint: string } | null; createdAt: number; updatedAt: number;
};
export type CaravanProgress = { reputation: number; deliveries: number; lastEntryDay: string | null; current: CaravanRun | null; chains: Record<string, number>; discoveries: string[]; history: { id: string; title: string; day: string; result: NonNullable<CaravanRun['result']> }[] };
export const CARAVAN_TOOLS: Record<CaravanTool, { name: string; description: string }> = {
    water: { name: 'Extra water', description: 'Shelter against heat and dry wells.' }, repair: { name: 'Repair kit', description: 'Fix cargo without spending general supplies.' },
    smoke: { name: 'Smoke bombs', description: 'Avoid selected ambushes at a morale cost.' }, map: { name: 'Scout map', description: 'Reveal one more row of the road from the start.' },
    medicine: { name: 'Medical pack', description: 'Treat wounds or help injured travelers.' }, feed: { name: 'Pet feed', description: 'Calm wildlife and make room for a wild companion.' },
};
export const CARAVAN_WEATHER: Record<CaravanWeather, { name: string; description: string }> = {
    clear: { name: 'Clear skies', description: 'Good visibility. Two rows of the route are visible.' },
    sandstorm: { name: 'Sandstorm', description: 'Only the next row is visible. Weather hazards are more common.' },
    heat: { name: 'Scorching heat', description: 'Every third leg consumes an extra supply. Pack water.' },
    bandits: { name: 'Bandit surge', description: 'More ambushes. Optional victories count toward employer bonuses.' },
    festival: { name: 'Festival rush', description: 'More traders and travelers share the road.' },
    night: { name: 'Cool night', description: 'Ruin discoveries are more frequent. The caravan starts with better morale.' },
};
export const CARAVAN_RANKS = [
    { name: 'Unknown Escort', at: 0 }, { name: 'Trailhand', at: 40 }, { name: 'Caravan Guard', at: 120 },
    { name: 'Desert Guide', at: 300 }, { name: 'Master Escort', at: 650 }, { name: 'Sunscar Pathfinder', at: 1200 },
] as const;
export function caravanRank(reputation: number) { return [...CARAVAN_RANKS].reverse().find(r => reputation >= r.at) ?? CARAVAN_RANKS[0]; }
