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
const pilgrimImg = "/portraits/wanderer-pilgrim.webp";
import sageImg from "../assets/wanderers/sage.webp";
import merchantImg from "../assets/wanderers/merchant.webp";
import medicImg from "../assets/wanderers/medic.webp";
import patrolImg from "../assets/wanderers/patrol.webp";
import trackerImg from "../assets/wanderers/tracker.webp";
import courierImg from "../assets/wanderers/courier.webp";
import bountyHunterImg from "../assets/wanderers/bounty-hunter.webp";
import nightbladeImg from "../assets/village-war/merc-shadow.webp";
// The road cast added 2026-10-14 (gpt-image-1 via scripts/gen-asset.mjs at high
// quality, matching the painterly bust style of the portraits above).
import riftspawnImg from "../assets/wanderers/riftspawn.webp";
import anglerImg from "../assets/wanderers/angler.webp";
import rivalMinerImg from "../assets/wanderers/rival-miner.webp";
import kageroImg from "../assets/wanderers/kagero.webp";
import wanderingSageImg from "../assets/wanderers/legacy/wandering-sage.webp";
// The eight Legacy Emissaries (gpt-image-1, docs/legacy-assets.md §1).
import stormCallerRynImg from "../assets/wanderers/legacy/storm-caller-ryn.webp";
import veilMotherSuzuImg from "../assets/wanderers/legacy/veil-mother-suzu.webp";
import ironPilgrimDaigoImg from "../assets/wanderers/legacy/iron-pilgrim-daigo.webp";
import bladeKeeperHanaImg from "../assets/wanderers/legacy/blade-keeper-hana.webp";
import duelBrokerKesshiImg from "../assets/wanderers/legacy/duel-broker-kesshi.webp";
import hollowWardenImg from "../assets/wanderers/legacy/hollow-warden.webp";
import lanternWardenMeiImg from "../assets/wanderers/legacy/lantern-warden-mei.webp";
import maplessOjiiImg from "../assets/wanderers/legacy/mapless-ojii.webp";
import beastImg from "../assets/coliseum/demo-emberfox.webp";
import bossImg from "../assets/wanderers/bandit-warlord.webp";
// Bespoke Quest Book bestiary bosses (gpt-image-1), keyed by bossId.
import raijuStormHoundImg from "../assets/wanderers/bosses/raiju-storm-hound.webp";

/** Portrait for the ambush boss (Bandit Warlord). */
export const WANDERER_BOSS_PORTRAIT = bossImg;

// Each Quest Book bestiary boss has its own painted portrait. Keyed by the bossId
// in api/sector/_questbook.ts. WorldMap falls back to the generic wanderer art if a
// bossId ever lacks a bespoke face.
const QUEST_BOSSES = new Set([
    "ashbound-raider", "bell-wraith", "bandit-captain-goro", "puppeteer-itoguchi", "hunter-shirakawa", "house-kuroban", "ashbound-cinder", "ashbound-slag", "kazan-ashbound"
]);
export function questBossPortrait(bossId: string | null | undefined): string | null {
    if (bossId === "raiju-storm-hound") return raijuStormHoundImg;
    return bossId && QUEST_BOSSES.has(bossId) ? "/portraits/quest-bosses/" + bossId + ".webp" : null;
}

/** The scarred face Quest Book bosses fall back on (portraitKey "nemesis"). */
export const WANDERER_NEMESIS_PORTRAIT = nemesisImg;
/** Kagero, the road rival (shared/road-nemesis.ts), in his cracked mask. */
export const WANDERER_KAGERO_PORTRAIT = kageroImg;

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
    merchant: merchantImg,
    medic: medicImg,
    patrol: patrolImg,
    tracker: trackerImg,
    courier: courierImg,
    bountyHunter: bountyHunterImg,
    // The Legacy offer-giver (gpt-image-1, docs/legacy-assets.md).
    wanderingSage: wanderingSageImg,
    // Night ninjas share the hooded shadow mercenary's face (village war).
    nightblade: nightbladeImg,
    // Bespoke faces for the rift creature, the angler, the rival miner and
    // Kagero in his cracked white mask.
    riftspawn: riftspawnImg,
    angler: anglerImg,
    rivalMiner: rivalMinerImg,
    nemesis: kageroImg,
    // The eight Legacy Emissaries — bespoke faces, one per served category.
    "storm-caller-ryn": stormCallerRynImg,
    "veil-mother-suzu": veilMotherSuzuImg,
    "iron-pilgrim-daigo": ironPilgrimDaigoImg,
    "blade-keeper-hana": bladeKeeperHanaImg,
    "duel-broker-kesshi": duelBrokerKesshiImg,
    "hollow-warden": hollowWardenImg,
    "lantern-warden-mei": lanternWardenMeiImg,
    "mapless-ojii": maplessOjiiImg,
};

export function wandererAvatar(key: WandererArchetypeId): string {
    return ART[key];
}
