import { builtinAiProfile, type CatalogAiProfile } from '../_ai-profile-catalog.js';

// Outposts use the same tested combat profiles as the corresponding Mission
// Hall ranks. A distinct id keeps their purpose visible in sealed raid tokens;
// neither village guards nor client-selected opponents determine difficulty.
const OUTPOSTS: Record<string, { baseId: string; name: string }> = {
    'mission-outpost-d-supply-trail': { baseId: 'builtin-ai-academy-sparring', name: 'Supply Trail Sentry' },
    'mission-outpost-c-border-scout': { baseId: 'builtin-ai-ember-duelist', name: 'Border Scout Sentry' },
    'mission-outpost-b-enemy-cache': { baseId: 'builtin-ai-frost-sealer', name: 'Enemy Cache Defender' },
    'mission-outpost-a-black-route': { baseId: 'builtin-ai-shadow-weaver', name: 'Black Route Defender' },
    'mission-outpost-s-shadow-front': { baseId: 'builtin-ai-central-champion', name: 'Shadow Front Commander' },
};

export function missionOutpostProfile(id: string): CatalogAiProfile | null {
    const authored = OUTPOSTS[id];
    if (!authored) return null;
    const base = builtinAiProfile(authored.baseId);
    return base ? { ...base, id, name: authored.name } : null;
}
