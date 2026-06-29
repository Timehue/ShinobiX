/*
 * Visual-novel content types, drained verbatim from App.tsx so the App monolith
 * no longer owns them — and so the App.size ratchet stops fighting every VN
 * change. Re-exported from ../App for the existing `import { ... } from "../App"`
 * sites, so nothing else has to change.
 *
 *   • CreatorEvent — the universal VN / world-event container (multi-page
 *     vnPages, branching choices with trait gates + optional battles, rewards).
 *   • StoryStep    — one milestone in a village's main story arc.
 */
import type { Biome } from "./core";
import type { CurrencyRewards } from "./character";

export type CreatorEvent = {
    id: string;
    name: string;
    biome: Biome;
    targetSector?: number;
    tileX?: number;  // tile position within sector (0-143)
    tileY?: number;  // tile position within sector (0-143)
    icon: string;
    eventKind?: "reward" | "visualNovel";
    trigger?: "manual" | "firstBattleArena" | "firstLeaveVillage";
    vnTitle?: string;
    vnScene?: string;
    vnSpeaker?: string;
    image?: string;
    avatarImage?: string;
    aiProfileId?: string;
    village?: string;
    kageFinale?: boolean;
    liberatorTitle?: string;
    vnPages?: {
        title: string;
        scene: string;
        speaker: string;
        dialogue: string[];
        // Typed-dialogue storage: structured per-line speaker/text (+ optional
        // per-line portrait). When present the renderer reads these instead of
        // parsing the legacy `dialogue` strings; `dialogue` is kept as a mirror
        // for the line count and for older code paths, so existing VNs (which
        // have no `lines`) are unaffected.
        lines?: { speaker: string; text: string; image?: string }[];
        image?: string;
        leftName?: string;
        leftImage?: string;
        rightName?: string;
        rightImage?: string;
        choices?: {
            text: string;
            nextPage: number;
            conclusion?: string;
            trait?: string;            // trait GRANTED to the player when this choice is picked (stored in character.storyTraits)
            requireTrait?: string;     // only show this choice if the player already has this trait
            forbidTrait?: string;      // hide this choice if the player already has this trait
            battle?: {
                encounterType?: "ai" | "pet" | "tiles";
                difficulty?: "easy" | "normal" | "hard" | "impossible";
                bossName?: string;
                bossIcon?: string;
                bossHp?: number;
                bossDamage?: number;
                aiProfileId?: string;
                petId?: string;
                tileDifficulty?: "easy" | "normal" | "hard";
                backgroundImage?: string;
                xpReward?: number;
                ryoReward?: number;
            };
        }[];
    }[];
    levelReq: number;
    xpReward: number;
    ryoReward: number;
    staminaReward: number;
    currencyRewards?: CurrencyRewards;
    dialogue: string[];
};

export type StoryStep = {
    levelReq: number;
    title: string;
    cinematicTitle: string;
    scene: string;
    dialogue: string[];
    bossName: string;
    bossIcon: string;
    bossHp: number;
    bossDamage: number;
    rewardXp: number;
    rewardRyo: number;
    biome?: Biome;
    aiProfileId?: string;
    kageFinale?: boolean;
    liberatorTitle?: string;
    pages?: NonNullable<CreatorEvent["vnPages"]>;
};
