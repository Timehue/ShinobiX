/*
 * Wanderer portrait art, kept out of the pure (node-tested) wanderers.ts so that
 * module never imports a .webp. Maps a wanderer archetype to one of the existing
 * in-game NPC faces. Shared by <SectorWanderer> (the map billboard) and WorldMap
 * (the in-fight AI portrait) so the same face follows a wanderer into battle.
 */
import type { WandererArchetypeId } from "./wanderers";
import banditImg from "../assets/wanderers/bandit.webp";
import gamblerImg from "../assets/wanderers/gambler.webp";
import pilgrimImg from "../assets/wanderers/pilgrim.webp";
import sageImg from "../assets/wanderers/sage.webp";
import beastImg from "../assets/coliseum/demo-emberfox.webp";
import bossImg from "../assets/wanderers/bandit-warlord.webp";

/** Portrait for the ambush boss (Bandit Warlord). */
export const WANDERER_BOSS_PORTRAIT = bossImg;

// Bespoke per-archetype portraits (gpt-image-1), so wanderers have their own
// faces instead of reusing the festival vendor art.
const ART: Record<WandererArchetypeId, string> = {
    bandit: banditImg,
    gambler: gamblerImg,
    pilgrim: pilgrimImg,
    beast: beastImg,
    sage: sageImg,
};

export function wandererAvatar(key: WandererArchetypeId): string {
    return ART[key];
}
