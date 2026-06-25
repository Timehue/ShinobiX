/*
 * Wanderer portrait art, kept out of the pure (node-tested) wanderers.ts so that
 * module never imports a .webp. Maps a wanderer archetype to one of the existing
 * in-game NPC faces. Shared by <SectorWanderer> (the map billboard) and WorldMap
 * (the in-fight AI portrait) so the same face follows a wanderer into battle.
 */
import type { WandererArchetypeId } from "./wanderers";
import banditImg from "../assets/festival/fest-broker.webp";
import gamblerImg from "../assets/festival/fest-kael.webp";
import pilgrimImg from "../assets/festival/fest-miraa.webp";
import beastImg from "../assets/coliseum/demo-emberfox.webp";

const ART: Record<WandererArchetypeId, string> = {
    bandit: banditImg,
    gambler: gamblerImg,
    pilgrim: pilgrimImg,
    beast: beastImg,
    sage: pilgrimImg, // the sage shares the veiled-elder portrait
};

export function wandererAvatar(key: WandererArchetypeId): string {
    return ART[key];
}
