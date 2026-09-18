import type { ServerAiRule } from '../combat-core/ai-authoring.js';

/** Only ordinary C/B/A/S mission slots opt in. Shared NPC profiles stay intact.
 * Every move is explicitly referenced, so a missing catalog entry fails sealing.
 * No embedded jutsu: the normal approved-content resolver owns definitions. */
export type AuthoredMissionKit = {
    jutsuIds: string[];
    rules: ServerAiRule[];
    maxChakra: number;
    maxStamina: number;
    descriptions?: Record<string, string>;
};

const cast = (jutsuId: string, condition: ServerAiRule['condition'] = 'always', value = 0, status?: string): ServerAiRule =>
    ({ condition, value, action: 'use_specific_jutsu', jutsuId, ...(status ? { status } : {}) });
const approach: ServerAiRule = { condition: 'always', value: 0, action: 'move_towards_opponent' };
const basic: ServerAiRule = { condition: 'always', value: 0, action: 'use_basic_attack' };
const hold: ServerAiRule = { condition: 'always', value: 0, action: 'end_turn' };

export const AUTHORED_MISSION_KITS: Readonly<Record<string, AuthoredMissionKit>> = {
    'combat-c-patrol': {
        // The shared duelist's elbow, fire kick and Flicker; retain the mission's
        // existing stats. Off-school attacks gain no compensation or free AP.
        jutsuIds: ['starter-tai-earth-1', 'starter-tai-fire-2', 'starter-universal-flicker'],
        maxChakra: 500, maxStamina: 750,
        descriptions: {
            'starter-tai-earth-1': 'An earthen strike primes %target to take more damage.',
        },
        rules: [
            // Pay 20 AP to commit to melee. On protected opening rounds the
            // remaining 80 buys the setup and a basic strike; a later turn
            // already in range can instead spend 40 + 60 on the heavy payoff.
            cast('starter-universal-flicker', 'distance_higher_than', 1),
            cast('starter-tai-earth-1', 'player_status_absent', 0, 'Increase Damage Taken'),
            cast('starter-tai-fire-2'),
            basic, approach, hold,
        ],
    },
    'combat-b-escort': {
        jutsuIds: ['starter-gen-fire-1', 'starter-gen-lightning-2', 'starter-gen-earth-2'],
        maxChakra: 750, maxStamina: 750,
        descriptions: {
            'starter-gen-fire-1': 'Ghostly lanterns soften incoming blows around the user.',
            'starter-gen-lightning-2': 'A phantom stage weakens %target\'s attacks.',
        },
        rules: [
            cast('starter-gen-fire-1', 'self_status_absent', 0, 'Decrease Damage Taken'),
            cast('starter-gen-lightning-2', 'player_status_absent', 0, 'Decrease Damage Given'),
            cast('starter-gen-earth-2'),
            basic, approach, hold,
        ],
    },
    'combat-a-hunt': {
        jutsuIds: ['starter-gen-water-2', 'starter-gen-earth-2'],
        maxChakra: 750, maxStamina: 500,
        descriptions: {
            'starter-gen-water-2': 'A phantom tide poisons %target; casting while poisoned costs health.',
        },
        rules: [
            // Closing changes the exchange: basic attacks spend the AP first.
            { condition: 'distance_lower_than', value: 2, action: 'use_basic_attack' },
            cast('starter-gen-water-2', 'player_status_absent', 0, 'Poison'),
            // Follow the poison cast with pressure, even after Cleanse.
            cast('starter-gen-earth-2'),
            basic,
            // Hold casting distance after a ranged strike. With a fresh turn
            // and both casts unavailable, advance into ordinary basic range.
            { condition: 'self_resource_lower_than', resource: 'ap', value: 60, action: 'end_turn' },
            approach, hold,
        ],
    },
    'combat-s-crisis': {
        jutsuIds: ['starter-nin-earth-1', 'starter-buki-water-2', 'starter-tai-lightning-2'],
        maxChakra: 500, maxStamina: 1_000,
        descriptions: {
            'starter-nin-earth-1': 'Stone needles raise a shield and expose %target to stronger blows.',
            'starter-tai-lightning-2': 'A lightning knee strikes %target as a reflecting aura forms around the user.',
        },
        rules: [
            // A close-range response only, with the real seven-turn cooldown.
            cast('starter-tai-lightning-2', 'distance_lower_than', 2),
            cast('starter-nin-earth-1', 'player_status_absent', 0, 'Increase Damage Taken'),
            cast('starter-buki-water-2'),
            basic, approach, hold,
        ],
    },
};
