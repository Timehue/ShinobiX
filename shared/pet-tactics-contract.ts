import type { ShowdownEvent, ShowdownStateView } from './pet-showdown-contract.js';

export const PET_TACTICS_RULESET = 'pet-tactics-v1' as const;
export const TACTICS_PLAN_MS = 45_000;
export const TACTICS_PLAYBACK_MS = 35_000;
export const TACTICS_MAX_ROUNDS = 30;
export type TacticsSeat = 'a' | 'b';
export type TacticsElement = 'Fire' | 'Water' | 'Wind' | 'Lightning' | 'Earth' | 'None';
export type TacticsAllocation = { vitality: number; power: number; guard: number; agility: number };
export type TacticsItem = 'reserve-cell' | 'ward-charm' | 'focus-lens';
export type TacticsBuild = { speciesId: string; moveIds: string[]; allocation: TacticsAllocation; item: TacticsItem };
export type TacticsMoveKind = 'damage' | 'burn' | 'wound' | 'mark' | 'slow' | 'stun' | 'heal' | 'shield' | 'cleanse' | 'protect' | 'redirect' | 'buff' | 'weather';
export type TacticsMove = {
    id: string; name: string; element: TacticsElement; cls: 'physical' | 'special' | 'status';
    kind: TacticsMoveKind; target: 'foe' | 'ally' | 'self' | 'team';
    power: number; cost: number; priority: number; hold: number; cooldown: number; effect: string;
};
export type TacticsSpecies = {
    id: string; name: string; element: TacticsElement; rarity: string; role: string;
    stats: { hp: number; attack: number; spAttack: number; defense: number; spDefense: number; speed: number };
    trait: 'steady' | 'medic' | 'sentinel' | 'scout'; traitText: string;
    pool: string[]; signature: TacticsMove;
    builds: { name: string; moves: string[]; allocation: TacticsAllocation }[];
};
export type TacticsOrder =
    | { actorId: string; kind: 'move'; moveId: string; targetSlot: number }
    | { actorId: string; kind: 'signature' | 'basic'; targetSlot: number }
    | { actorId: string; kind: 'guard' | 'rest' }
    | { actorId: string; kind: 'switch'; reserveId: string };
export type TacticsMoveOption = TacticsMove & { available: boolean; reason?: string; ranges: { slot: number; min: number; max: number }[] };
export type TacticsPetSheet = {
    id: string; speciesId: string; name: string; element: TacticsElement; role: string; rarity: string;
    hp: number; maxHp: number; stamina: number; meter: number; slot: number | null; ko: boolean;
    stats: TacticsSpecies['stats']; allocation: TacticsAllocation; trait: string; item: TacticsItem;
    conditions: string[]; fieldRounds: number; guardCost: number; guardReduction: number; moves: TacticsMoveOption[]; signature: TacticsMoveOption;
};
export type TacticsRound = { round: number; initialState: ShowdownStateView; state: ShowdownStateView; events: ShowdownEvent[]; notes: string[] };
export type TacticsView = {
    ruleset: typeof PET_TACTICS_RULESET; roomId: string; revision: number; seat: TacticsSeat; opponent: string | null;
    phase: 'waiting' | 'preview' | 'planning' | 'playback' | 'finished'; round: number; serverNow: number;
    deadline: number; ready: { own: boolean; opponent: boolean }; ownOrders: TacticsOrder[] | null;
    ownLeads: number[] | null; own: TacticsPetSheet[]; enemy: TacticsPetSheet[];
    missed: { own: number; opponent: number }; result: 'win' | 'loss' | 'draw' | null; reason: string | null;
    battle: ShowdownStateView; transcript: TacticsRound[];
    ranked?: { matchToken: string; ownRating: number; opponentRating: number; settled: boolean };
};
