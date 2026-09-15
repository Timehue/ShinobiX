export const RALLY_VERSION = 1;
export const RALLY_HZ = 60;
export const RALLY_MAX_TICKS = 60 * 180;
export const RALLY_POINTS = [10, 7, 5, 3] as const;
export type RallyElement = 'Fire' | 'Lightning' | 'Wind' | 'Earth' | 'Water';
export type RallyArchetype = 'sprinter' | 'acrobat' | 'bruiser' | 'endurance' | 'trickster';
export type RallyProfile = { speed: number; acceleration: number; agility: number; endurance: number; stability: number; archetype: RallyArchetype };
export type RallyPet = { id: string; templateId: string; name: string; element: RallyElement; profile: RallyProfile; rarity?: string; evolutionStage?: number; paletteVariantId?: string };
export type RallyAction = { tick: number; kind: 'left' | 'right' | 'jump' | 'burst-on' | 'burst-off' | 'technique' };
export type RallyHazardKind = 'barrier' | 'rock' | 'cart' | 'gate' | 'ramp' | 'shortcut';
export type RallyObstacle = { id: string; at: number; lane: -1 | 0 | 1; kind: RallyHazardKind; height: number; length: number; gain?: number; minSpeed?: number; breakable?: boolean };
export type RallySection = { from: number; to: number; name: string; terrain: 'sand' | 'stone' | 'deep-sand' | 'alley'; width: number; curve: number; elevation: number };
export type RallyTrack = {
    id: string; name: string; subtitle: string; description: string; traits: string[]; length: number;
    palette: { sky: string; sand: string; rock: string; accent: string; fog: string };
    sections: RallySection[]; obstacles: RallyObstacle[]; scenery: 'festival' | 'canyon' | 'dunes' | 'market';
    checkpoints: number[]; music: 'festival';
};
export type RallyRival = {
    id: string; name: string; petId: string; petName: string; color: string; intro: string; outro: string;
    style: string; skill: number; aggression: number; shortcuts: number; reaction: number;
};
export type RallyMotion = 'ready' | 'start' | 'run' | 'sprint' | 'jump' | 'airborne' | 'land' | 'stagger' | 'technique' | 'victory' | 'defeat';
export type RallyRacer = {
    id: string; pet: RallyPet; rivalId: string | null; distance: number; lane: number; targetLane: number;
    speed: number; stamina: number; jump: number; verticalSpeed: number; jumpCooldown: number; landing: number;
    burst: boolean; techniqueUsed: boolean; techniqueTicks: number; armor: boolean; stagger: number;
    finishTick: number | null; hits: number; shortcuts: number; shortcutTicks: number; processed: string[]; motion: RallyMotion;
    aiNextTick: number; aiDecision: number;
};
export type RallyState = { version: number; seed: number; trackId: string; tick: number; racers: RallyRacer[]; finished: boolean };
export type RallyStanding = { id: string; points: number; totalTicks: number };
export type RallyRaceResult = { trackId: string; placements: { id: string; tick: number; points: number; hits: number; shortcuts: number }[] };
