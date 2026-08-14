import type { Pet } from '../_pet-sim/pet-types.js';
import { SERVER_ARENA_PETS } from './_arena-ai.js';

/*
 * Server-side resolution of the Hollow Warfront vs-AI RED team, for the
 * server-authoritative reward re-sim (api/pet/warfront-start.ts).
 *
 * The client (shinobij.client/src/screens/PetArena.tsx "Start vs AI") builds the
 * red team by cycling `genericPetArenaOpponents` to the player's pet count. Those
 * pets carry the SAME final (trait-applied) stats AND element as SERVER_ARENA_PETS.
 * The Warfront sim reads exactly hp/attack/defense/speed/element + role
 * (derivePetRole(id,name,element,rarity)); we still set the element explicitly
 * below so the Warfront red team is self-documenting and drift-proof.
 *
 * The pool ORDER and ELEMENTS below MUST match pet-arena-opponents.ts. The
 * warfront-parity test (scripts/warfront-parity.test.ts) asserts a byte-identical
 * match against the real client roster, so any drift is caught in CI.
 */
const WF_AI_POOL: ReadonlyArray<{ id: string; element: string }> = [
    { id: 'generic-ai-pet-sparrow', element: 'Wind' },
    { id: 'generic-ai-pet-guardhound', element: 'Earth' },
    { id: 'generic-ai-pet-emberlynx', element: 'Fire' },
];

/** Rebuild the client's cycled red team of `count` pets (1..4), server-side. */
export function buildWarfrontAiTeam(count: number): Pet[] {
    const n = Math.max(1, Math.min(4, Math.floor(Number.isFinite(count) ? count : 4)));
    const team: Pet[] = [];
    for (let i = 0; i < n; i++) {
        const spec = WF_AI_POOL[i % WF_AI_POOL.length];
        const base = SERVER_ARENA_PETS[spec.id];
        if (!base) throw new Error(`warfront-ai: server is missing AI pet ${spec.id}`);
        team.push({ ...base, element: spec.element as Pet['element'] });
    }
    return team;
}
