import type { Pet } from '../_pet-sim/pet-types.js';
import { SERVER_ARENA_PETS } from './_arena-ai.js';

/*
 * Server-side resolution of the Hollow Warfront vs-AI RED team, for the
 * server-authoritative reward re-sim (api/pet/warfront-start.ts).
 *
 * This team is sealed into the reward token and returned to the client, which
 * fights the sealed pets (PetArena.tsx queueSealedWarfront) and only layers the
 * client roster's portraits on top, so this pool is the single authority for the
 * vs-AI red team. The element is still set explicitly below so the team is
 * self-documenting; scripts/arena-ai-parity.test.ts keeps SERVER_ARENA_PETS'
 * stats and elements aligned with the client roster those portraits come from.
 * (The lane-war warfront-parity test that used to pin this order against the
 * client's cycled roster was retired with the lane engine on 2026-10-02.)
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
