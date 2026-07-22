// Bundled Hunter Guild art — generated via scripts/gen-asset.mjs (OpenAI gpt-image-1),
// committed under src/assets/hunter/. Explicit imports (matching war-ui-images.ts) so
// Vite content-hashes each asset and serves it as a static file, not JSON-in-state.
import { canonicalBeastPortraitId } from "../lib/ai-fight-art";

// ── Beast portraits (key = hunt AI profile id) ──────────────────────────────
import boar from "../assets/hunter/beasts/hunt-ai-wild-boar.webp";
import hawk from "../assets/hunter/beasts/hunt-ai-forest-hawk.webp";
import frostWolf from "../assets/hunter/beasts/hunt-ai-frost-wolf.webp";
import ashLizard from "../assets/hunter/beasts/hunt-ai-ash-lizard.webp";
import shadowPanther from "../assets/hunter/beasts/hunt-ai-shadow-panther.webp";
import ironbackBear from "../assets/hunter/beasts/hunt-ai-ironback-bear.webp";
import emberDrake from "../assets/hunter/beasts/hunt-ai-ember-drake.webp";
import moonSerpent from "../assets/hunter/beasts/hunt-ai-moon-serpent.webp";
import ancientBeast from "../assets/hunter/beasts/hunt-ai-ancient-chakra-beast.webp";
import worldstormDragon from "../assets/hunter/beasts/hunt-ai-worldstorm-dragon.webp";

// ── Apex Contract beasts (Hunter Rank 5 weekly capstone) ────────────────────
import apexEmberDrake from "../assets/hunter/beasts/apex-ai-ember-drake.webp";
import apexMoonSerpent from "../assets/hunter/beasts/apex-ai-moon-serpent.webp";
import apexAncientBeast from "../assets/hunter/beasts/apex-ai-ancient-chakra-beast.webp";
import apexWorldstorm from "../assets/hunter/beasts/apex-ai-worldstorm-dragon.webp";

// ── Material icons (key = item id) ──────────────────────────────────────────
import mTornHide from "../assets/hunter/materials/hunt-torn-hide.webp";
import mWildFeather from "../assets/hunter/materials/hunt-wild-feather.webp";
import mSmallFang from "../assets/hunter/materials/hunt-small-fang.webp";
import mCrackedHorn from "../assets/hunter/materials/hunt-cracked-horn.webp";
import mBeastMeat from "../assets/hunter/materials/hunt-beast-meat.webp";
import mFrostPelt from "../assets/hunter/materials/hunt-frost-pelt.webp";
import mShadowClaw from "../assets/hunter/materials/hunt-shadow-claw.webp";
import mWolfFang from "../assets/hunter/materials/hunt-wolf-fang.webp";
import mAshScale from "../assets/hunter/materials/hunt-ash-scale.webp";
import mEmberScale from "../assets/hunter/materials/hunt-ember-scale.webp";
import mShadowPelt from "../assets/hunter/materials/hunt-shadow-pelt.webp";
import mAncientCore from "../assets/hunter/materials/hunt-ancient-beast-core.webp";
import mTitanBone from "../assets/hunter/materials/hunt-titan-bone.webp";
import mLegendary from "../assets/hunter/materials/hunt-legendary-material.webp";

// ── Rank badges (index = Hunter Rank 0..5) ──────────────────────────────────
import rank0 from "../assets/hunter/ranks/hunter-rank-0.webp";
import rank1 from "../assets/hunter/ranks/hunter-rank-1.webp";
import rank2 from "../assets/hunter/ranks/hunter-rank-2.webp";
import rank3 from "../assets/hunter/ranks/hunter-rank-3.webp";
import rank4 from "../assets/hunter/ranks/hunter-rank-4.webp";
import rank5 from "../assets/hunter/ranks/hunter-rank-5.webp";

// ── Guild-hall backdrop ─────────────────────────────────────────────────────
import guildBoard from "../assets/hunter/hunter-guild-board.webp";
export const HUNTER_GUILD_BACKDROP = guildBoard;

// ── Apex Contract banner ────────────────────────────────────────────────────
// Deliberately text-free so it works as a backdrop behind the live contract
// copy (beast name, week, purse) rather than baking any of it into the art.
import apexBanner from "../assets/hunter/apex-banner.webp";
export const APEX_CONTRACT_BANNER = apexBanner;

const BEAST_PORTRAITS: Record<string, string> = {
    "hunt-ai-wild-boar": boar,
    "hunt-ai-forest-hawk": hawk,
    "hunt-ai-frost-wolf": frostWolf,
    "hunt-ai-ash-lizard": ashLizard,
    "hunt-ai-shadow-panther": shadowPanther,
    "hunt-ai-ironback-bear": ironbackBear,
    "hunt-ai-ember-drake": emberDrake,
    "hunt-ai-moon-serpent": moonSerpent,
    "hunt-ai-ancient-chakra-beast": ancientBeast,
    "hunt-ai-worldstorm-dragon": worldstormDragon,
    // Apex beasts have their OWN art — a normal hunt and its Apex must not wear
    // the same face. beastPortrait() still falls back to the base beast below,
    // as a net for any future apex id added before its portrait exists.
    "apex-ai-ember-drake": apexEmberDrake,
    "apex-ai-moon-serpent": apexMoonSerpent,
    "apex-ai-ancient-chakra-beast": apexAncientBeast,
    "apex-ai-worldstorm-dragon": apexWorldstorm,
};

const HUNT_MATERIAL_ICONS: Record<string, string> = {
    "hunt-torn-hide": mTornHide,
    "hunt-wild-feather": mWildFeather,
    "hunt-small-fang": mSmallFang,
    "hunt-cracked-horn": mCrackedHorn,
    "hunt-beast-meat": mBeastMeat,
    "hunt-frost-pelt": mFrostPelt,
    "hunt-shadow-claw": mShadowClaw,
    "hunt-wolf-fang": mWolfFang,
    "hunt-ash-scale": mAshScale,
    "hunt-ember-scale": mEmberScale,
    "hunt-shadow-pelt": mShadowPelt,
    "hunt-ancient-beast-core": mAncientCore,
    "hunt-titan-bone": mTitanBone,
    "hunt-legendary-material": mLegendary,
};

const HUNTER_RANK_BADGES: readonly string[] = [rank0, rank1, rank2, rank3, rank4, rank5];

/**
 * Portrait for a hunt beast by its AI profile id (undefined → caller falls back
 * to emoji).
 *
 * Apex Contract beasts carry a DISTINCT id (`apex-ai-<beast>`) so an Apex kill
 * can never stamp a normal hunt's receipt — which also means they miss this
 * lookup and would fight as an emoji, the exact bug the bundled portraits exist
 * to prevent. Fall back to the base beast's art so an Apex is never artless,
 * even if it never gets portraits of its own.
 */
export function beastPortrait(aiProfileId?: string): string | undefined {
    if (!aiProfileId) return undefined;
    const canonicalId = canonicalBeastPortraitId(aiProfileId);
    const direct = BEAST_PORTRAITS[canonicalId];
    if (direct) return direct;
    if (canonicalId.startsWith("apex-ai-")) {
        return BEAST_PORTRAITS[`hunt-ai-${canonicalId.slice("apex-ai-".length)}`];
    }
    return undefined;
}
/** Icon for a hunt drop material by item id. */
export function huntMaterialIcon(itemId?: string): string | undefined {
    return itemId ? HUNT_MATERIAL_ICONS[itemId] : undefined;
}
/** Heraldic badge for a Hunter Rank (0..5). */
export function hunterRankBadge(rank: number): string {
    return HUNTER_RANK_BADGES[Math.max(0, Math.min(HUNTER_RANK_BADGES.length - 1, Math.floor(rank)))];
}
