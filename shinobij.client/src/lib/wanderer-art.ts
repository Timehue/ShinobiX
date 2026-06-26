/*
 * Wanderer portrait art, kept out of the pure (node-tested) wanderers.ts so that
 * module never imports a .webp. Maps a wanderer archetype to one of the existing
 * in-game NPC faces. Shared by <SectorWanderer> (the map billboard) and WorldMap
 * (the in-fight AI portrait) so the same face follows a wanderer into battle.
 */
import type { WandererArchetypeId } from "./wanderers";
import banditImg from "../assets/wanderers/bandit.webp";
import bandit2Img from "../assets/wanderers/bandit-2.webp";
import bandit3Img from "../assets/wanderers/bandit-3.webp";
import nemesisImg from "../assets/wanderers/nemesis.webp";
import gamblerImg from "../assets/wanderers/gambler.webp";
import pilgrimImg from "../assets/wanderers/pilgrim.webp";
import sageImg from "../assets/wanderers/sage.webp";
import beastImg from "../assets/coliseum/demo-emberfox.webp";
import bossImg from "../assets/wanderers/bandit-warlord.webp";
// Bespoke Quest Book bestiary bosses (gpt-image-1), keyed by bossId.
import ashboundRaiderImg from "../assets/wanderers/bosses/ashbound-raider.webp";
import bellWraithImg from "../assets/wanderers/bosses/bell-wraith.webp";
import banditCaptainGoroImg from "../assets/wanderers/bosses/bandit-captain-goro.webp";
import puppeteerItoguchiImg from "../assets/wanderers/bosses/puppeteer-itoguchi.webp";
import raijuStormHoundImg from "../assets/wanderers/bosses/raiju-storm-hound.webp";

/** Portrait for the ambush boss (Bandit Warlord). */
export const WANDERER_BOSS_PORTRAIT = bossImg;

// Each Quest Book bestiary boss has its own painted portrait. Keyed by the bossId
// in api/sector/_questbook.ts. WorldMap falls back to the generic wanderer art if a
// bossId ever lacks a bespoke face.
const QUEST_BOSS_PORTRAITS: Record<string, string> = {
    "ashbound-raider": ashboundRaiderImg,
    "bell-wraith": bellWraithImg,
    "bandit-captain-goro": banditCaptainGoroImg,
    "puppeteer-itoguchi": puppeteerItoguchiImg,
    "raiju-storm-hound": raijuStormHoundImg,
};
export function questBossPortrait(bossId: string | null | undefined): string | null {
    return bossId && Object.prototype.hasOwnProperty.call(QUEST_BOSS_PORTRAITS, bossId)
        ? QUEST_BOSS_PORTRAITS[bossId]
        : null;
}

/** The recurring rival's own scarred face — distinct from a common bandit. */
export const WANDERER_NEMESIS_PORTRAIT = nemesisImg;

// The three ambush robbers wear three different faces so the gang doesn't look
// like one man cloned. Indexed by ambush stage (0,1,2); the boss is separate.
const ROBBER_PORTRAITS = [banditImg, bandit2Img, bandit3Img];
export function wandererRobberPortrait(stage: number): string {
    return ROBBER_PORTRAITS[((stage % 3) + 3) % 3];
}

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
