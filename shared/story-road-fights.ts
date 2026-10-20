/** Published identities for the optional road-story duels. Kits reuse the
 * practice profile previously selected near each event's minimum level. */
export const STORY_ROAD_FIGHTS = [
    { eventId: "story-road-border-smoke", id: "road-ai-brask", name: "Tally-Captain Brask", baseProfileId: "builtin-ai-exam-proctor" },
    { eventId: "story-road-second-teacher", id: "road-ai-magpie", name: "The Magpie", baseProfileId: "builtin-ai-exam-proctor" },
    { eventId: "story-road-second-teacher", id: "road-ai-havek", name: "Instructor Havek", baseProfileId: "builtin-ai-exam-proctor" },
    { eventId: "story-road-shrine-of-two-flags", id: "road-ai-hela-dray", name: "Raid Captain Hela Dray", baseProfileId: "builtin-ai-frost-sealer" },
    { eventId: "story-road-black-bridge", id: "road-ai-black-bridge", name: "Black Bridge Raiders", baseProfileId: "builtin-ai-shadow-weaver" },
    { eventId: "story-road-rival-who-keeps-losing", id: "road-ai-anji-vesk", name: "Anji Vesk", baseProfileId: "builtin-ai-shadow-weaver" },
    { eventId: "story-road-alliance-drill", id: "road-ai-forty-first", name: "The Forty-First", baseProfileId: "builtin-ai-central-champion" },
    { eventId: "story-road-fifth-anchor", id: "road-ai-foreman-dray", name: "Foreman Dray", baseProfileId: "builtin-ai-central-champion" },
    { eventId: "story-road-four-seals-one-gate", id: "road-ai-anchor-warden", name: "Anchor Warden", baseProfileId: "builtin-ai-central-champion" },
] as const;

export function storyRoadFightProfile(eventId: string, bossName: string) {
    return STORY_ROAD_FIGHTS.find(profile => profile.eventId === eventId && profile.name === bossName);
}
