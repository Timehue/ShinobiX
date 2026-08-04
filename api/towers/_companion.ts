import type { TowerActor } from './_tower-session.js';
import {
    COMPANION_ACTOR_ID,
    COMPANION_FIELD_ROUNDS,
    type CompanionSeal,
} from '../combat-core/companion.js';

export * from '../combat-core/companion.js';

/** Tower adapter for the runtime-neutral companion seal and behavior helpers. */
export function companionActor(
    seal: CompanionSeal,
    pos: number,
    rounds = COMPANION_FIELD_ROUNDS,
): TowerActor {
    return {
        id: COMPANION_ACTOR_ID,
        side: 'squad',
        name: seal.name,
        ownerSlug: null,
        ai: true,
        hp: seal.hp,
        maxHp: seal.hp,
        chakra: 999,
        maxChakra: 999,
        stamina: 999,
        maxStamina: 999,
        shield: 0,
        statuses: [],
        cooldowns: {},
        pos,
        character: {
            companion: true,
            companionDamage: seal.damage,
            companionRoundsLeft: Math.max(1, Math.floor(rounds)),
            companionHappiness: seal.happiness,
            companionLoyal: seal.loyal,
            companionMoves: seal.moves,
            companionPveGear: seal.pveGearId,
            visual: seal.petId,
            specialty: 'Taijutsu',
            level: 1,
            stats: {},
        },
    };
}

export function isCompanionActor(actor: Pick<TowerActor, 'character'>): boolean {
    return (actor.character as Record<string, unknown> | undefined)?.companion === true;
}
