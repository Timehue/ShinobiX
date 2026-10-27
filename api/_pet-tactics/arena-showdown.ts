/**
 * Live Pet Arena on the Coliseum (Showdown) engine.
 *
 * Owner ruling, 2026-10-26: Pet Arena, ranked and sparring alike, is a fight
 * between the players' REAL companions, with their levels, rarity, gear,
 * consumables and traits, two on the field and two on the bench. This module
 * adapts the Showdown engine to the Pet Arena room (session.ts), which already
 * owns the two seats, locked simultaneous orders, deadlines and per-seat views.
 *
 * Seat A is the engine's `player` side and seat B its `enemy` side. The
 * engine resolves both sides with the same rules; `pvp` turns a mutual wipe
 * into a draw instead of a seat-A win. Every team is sealed from the owner's
 * save on the server (sealShowdownTeam), so a client never sends a stat.
 * Consumables fire their charges but are not spent: Pet Arena pays nothing,
 * like Coliseum practice, so it writes nothing to either save.
 */
import type { Pet } from '../_pet-sim/pet-types.js';
import { activeCarriedPets } from '../_entitlements.js';
import { rankedPetUnavailable } from '../pet/_ranked-eligibility.js';
import { showdownBusyIssue } from '../pet/_showdown-readiness.js';
import {
    createShowdownSession, resolveShowdownRound, sealShowdownTeam, showdownStateView,
    type ShowdownPet, type ShowdownSession,
} from '../_pet-showdown/engine.js';
import type { ShowdownCommand, ShowdownEvent, ShowdownStateView } from '../../shared/pet-showdown-contract.js';
import type { TacticsSeat } from '../../shared/pet-tactics-contract.js';
import { TacticsError } from './engine.js';

export const ARENA_ENGINE = 'showdown-v1' as const;
export const ARENA_TEAM_SIZE = 4;
const RULESET = 'progression-v3' as const;
const FORMAT = '2v2' as const;

export type ArenaResult = TacticsSeat | 'draw';

/** The seat's pets, read from its own save: four distinct carried companions
 *  that are not breeding, on an expedition or otherwise busy. */
export function chooseArenaPets(character: Record<string, unknown>, value: unknown): Pet[] {
    const ids = Array.isArray(value) ? value.map(v => String(v ?? '').slice(0, 96)) : [];
    if (ids.length !== ARENA_TEAM_SIZE || new Set(ids).size !== ARENA_TEAM_SIZE || ids.some(id => !id)) {
        throw new TacticsError('Choose four different companions: two to lead and two on the bench.');
    }
    const carried = activeCarriedPets<Record<string, unknown>>(character);
    const chosen = ids.map(id => carried.find(pet => String(pet?.id ?? '') === id));
    if (chosen.some(pet => !pet)) throw new TacticsError('Every companion must be one you are carrying.', 409);
    for (const pet of chosen) {
        if (rankedPetUnavailable(character, pet!)) {
            throw new TacticsError('A companion in Sanctuary, breeding or on an expedition cannot fight in the Pet Arena.', 409);
        }
    }
    const busy = showdownBusyIssue(character, chosen as unknown as Pet[]);
    if (busy) throw new TacticsError(busy, 409);
    return chosen as unknown as Pet[];
}

/** Seal one seat's team. Ids are prefixed by seat AFTER sealing (sealing reads
 *  the raw id to find some pets' species), so two players who both carry a
 *  starter with the same id never collide on the field. */
export function sealArenaTeam(pets: Pet[], seat: TacticsSeat): ShowdownPet[] {
    return sealShowdownTeam(pets, FORMAT, RULESET, false).map((pet, index) => ({
        ...pet, id: `${seat}:${pet.id}`, appearance: sealedAppearance(pets[index] as unknown as Record<string, unknown>),
    }));
}

/** The collar and palette the owner chose, read from the save at sealing so a
 *  later change (or anything a client sends) cannot alter the match. */
function sealedAppearance(raw: Record<string, unknown>): { collarId?: string; paletteVariantId?: string } {
    const collar = (raw.loadout as { collar?: unknown } | undefined)?.collar;
    const palette = raw.paletteVariantId;
    return {
        ...(typeof collar === 'string' && collar.length <= 64 ? { collarId: collar } : {}),
        ...(typeof palette === 'string' && palette.length <= 64 ? { paletteVariantId: palette } : {}),
    };
}

export function createArenaBattle(roomId: string, names: { a: string; b: string }, teams: { a: ShowdownPet[]; b: ShowdownPet[] }, seed: number): ShowdownSession {
    const battle = createShowdownSession({
        // Live fight: role partner bonds apply (SHOWDOWN_PARTNER_BONDS).
        partnerRules: true,
        sessionId: roomId, playerName: names.a, format: FORMAT, tier: 'champion', seed,
        playerPets: [], enemyPets: [], enemyTeamName: names.b,
        rewardEligible: false, pvp: true, rulesetVersion: RULESET,
    });
    battle.player = structuredClone(teams.a);
    battle.enemy = structuredClone(teams.b);
    battle.sealedOpponentLevel = Math.max(1, ...teams.b.map(pet => pet.level));
    return battle;
}

const sideOf = (seat: TacticsSeat) => seat === 'a' ? 'player' as const : 'enemy' as const;

/** Leads choose which two of the four start on the field. */
export function setArenaLeads(battle: ShowdownSession, seat: TacticsSeat, leads: number[]): void {
    const team = battle[sideOf(seat)];
    team.forEach((pet, index) => { pet.benched = !leads.includes(index); });
}

/** Commands for the seat's own living pets only. Anything aimed at the other
 *  seat's pets, or malformed, is dropped; the engine guards for a pet with no
 *  command and downgrades an illegal one to Guard (sanitizeCommand). */
export function parseArenaCommands(battle: ShowdownSession, seat: TacticsSeat, value: unknown): ShowdownCommand[] {
    if (!Array.isArray(value) || value.length > ARENA_TEAM_SIZE) throw new TacticsError('Send one order for each companion on the field.');
    const own = new Set(battle[sideOf(seat)].filter(pet => !pet.ko).map(pet => pet.id));
    const seen = new Set<string>();
    const commands: ShowdownCommand[] = [];
    for (const raw of value as Record<string, unknown>[]) {
        const petId = typeof raw?.petId === 'string' ? raw.petId : '';
        if (!own.has(petId) || seen.has(petId)) throw new TacticsError('You can only command your own companions, once each.');
        seen.add(petId);
        const abilityId = typeof raw.abilityId === 'string' ? raw.abilityId.slice(0, 96) : undefined;
        const text = (key: string) => typeof raw[key] === 'string' ? (raw[key] as string).slice(0, 96) : '';
        if (raw.kind === 'guard' || raw.kind === 'rest') commands.push({ kind: raw.kind, petId });
        else if (raw.kind === 'switch') commands.push({ kind: 'switch', petId, benchPetId: text('benchPetId') });
        else if (raw.kind === 'super') commands.push({ kind: 'super', petId, targetId: text('targetId'), ...(abilityId ? { abilityId } : {}) });
        else if (raw.kind === 'move' && Number.isSafeInteger(raw.moveIndex) && Number(raw.moveIndex) >= 0 && Number(raw.moveIndex) < 16) {
            commands.push({ kind: 'move', petId, moveIndex: Number(raw.moveIndex), targetId: text('targetId'), ...(abilityId ? { abilityId } : {}) });
        } else throw new TacticsError('That order is not one the Pet Arena understands.');
    }
    return commands;
}

/** Resolve one round. Returns the events and, once the fight ends, its result. */
export function resolveArenaRound(battle: ShowdownSession, a: ShowdownCommand[], b: ShowdownCommand[]): { events: ShowdownEvent[]; result: ArenaResult | null } {
    battle.commandFeedback = [];
    battle.enemyCommandFeedback = [];
    const events = resolveShowdownRound(battle, a, b);
    return { events, result: arenaResult(battle) };
}

export function arenaResult(battle: ShowdownSession): ArenaResult | null {
    if (!battle.finished) return null;
    if (battle.pvpDraw) return 'draw';
    return battle.outcome === 'win' ? 'a' : 'b';
}

const flipSide = (value: 'player' | 'enemy') => value === 'player' ? 'enemy' as const : 'player' as const;

/** The fight as one seat sees it: its own team as `player`. A draw reads as
 *  'loss' on both seats (the contract has no draw); the room's own `result`
 *  carries the draw and the client titles it. */
export function arenaSeatView(battle: ShowdownSession, seat: TacticsSeat, opponentName: string, draw: boolean, turnDeadline?: number): ShowdownStateView {
    return mirrorArenaView(showdownStateView(battle), seat, opponentName, draw, battle.enemyCommandFeedback ?? [], turnDeadline);
}

/** Re-tell a seat-A view (as `showdownStateView` builds it) from `seat`. */
export function mirrorArenaView(base: ShowdownStateView, seat: TacticsSeat, opponentName: string, draw: boolean, seatBFeedback: string[], turnDeadline?: number): ShowdownStateView {
    const view: ShowdownStateView = seat === 'a' ? { ...base, enemyTeamName: opponentName } : {
        ...base,
        player: base.enemy,
        enemy: base.player,
        enemyTeamName: opponentName,
        outcome: base.outcome === null ? null : base.outcome === 'win' ? 'loss' : 'win',
        ...(base.commandFeedback ? { commandFeedback: [...seatBFeedback] } : {}),
    };
    if (draw && view.outcome !== null) view.outcome = 'loss';
    if (turnDeadline) view.turnDeadline = turnDeadline;
    return view;
}

/** Events re-told from one seat's side of the field. */
export function arenaSeatEvents(events: ShowdownEvent[], seat: TacticsSeat, draw: boolean): ShowdownEvent[] {
    return events.map((entry): ShowdownEvent => {
        if (entry.t === 'end') {
            const outcome = draw ? 'loss' : seat === 'a' ? entry.outcome : entry.outcome === 'win' ? 'loss' : 'win';
            return { ...entry, outcome };
        }
        if (seat === 'a') return entry;
        switch (entry.t) {
            case 'action': case 'skip': case 'confused': return { ...entry, actorSide: flipSide(entry.actorSide) };
            case 'consumable': case 'switch': return { ...entry, side: flipSide(entry.side) };
            case 'dot': return { ...entry, targetSide: flipSide(entry.targetSide) };
            case 'roundStart': case 'roundEnd': return entry;
            default: { const exhaustive: never = entry; return exhaustive; }
        }
    });
}

/** A sealed team shown before the fight starts, for the lead preview and the
 *  waiting room: nobody is fielded yet, so both seats read the same board. */
export function arenaPreviewTeam(team: ShowdownPet[]): ShowdownPet[] {
    return team.map(pet => ({ ...pet, benched: false }));
}
