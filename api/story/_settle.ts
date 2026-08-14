import { applyDerivedLevel } from '../_xp-engine.js';
import type { PlayerCharacter } from '../save/_mutate-player-save.js';
import {
    grantChronicleProgressionCards,
    storyProgressionCardId,
} from '../card-clash/_progression-cards.js';

type StoryOpponentProof = { opponentId?: string };

export const STORY_LEVELS = [4, 15, 25, 35, 50, 65, 75, 85, 100] as const;
// One-time SPINE grants (docs/leveling-without-xp-map.md §4): character XP is
// retired, so each story milestone now pays stat-pool points (the old XP table
// ÷ 40) outside any daily budget — one-time by construction (storyProgress
// gates re-claims), so a story day always stacks on top of the dailies.
export const STORY_REWARDS = [
    { statPoints: 3, ryo: 75 },
    { statPoints: 13, ryo: 250 },
    { statPoints: 23, ryo: 500 },
    { statPoints: 35, ryo: 800 },
    { statPoints: 55, ryo: 1300 },
    { statPoints: 85, ryo: 2000 },
    { statPoints: 115, ryo: 2800 },
    { statPoints: 155, ryo: 4000 },
    { statPoints: 250, ryo: 7500 },
] as const;

// Grant one-time stat-pool points and recompute the derived level in one step.
function grantPoolPoints(character: PlayerCharacter, points: number): PlayerCharacter {
    const granted = {
        ...character,
        unspentStats: Math.max(0, Math.floor(Number(character.unspentStats) || 0)) + Math.max(0, Math.floor(points)),
    };
    return applyDerivedLevel(granted) as PlayerCharacter;
}

export const LIBERATOR_TITLES: Record<string, string> = {
    'Stormveil Village': 'Stormbreaker',
    'Ashen Leaf Village': 'Root Liberator',
    'Frostfang Village': 'Oathbreaker',
    'Moonshadow Village': 'Moon Unmasked',
};

export function storyOpponentId(village: string, level: number): string {
    return `story-ai-${village.toLowerCase().replace(/\W+/g, '-')}-${level}`;
}

/** The sealed Academy sparring dummy's id. Declared here, the leaf of the story
 *  module graph, because both the settlement below and the opponent builder
 *  (./_academy-spar.ts, which imports this file transitively) need it — putting
 *  it in the builder would close an import cycle. */
export const ACADEMY_SPAR_OPPONENT_ID = 'academy-spar-dummy';

export type StorySettlement =
    | { ok: true; character: PlayerCharacter; progress: number; xp: number; statPoints: number; ryo: number; auraDust: number; finale: boolean; title?: string; chronicleCards?: string[] }
    | { ok: false; status: number; error: string };

export function applyAcademySparSettlement(character: PlayerCharacter, proof: StoryOpponentProof): StorySettlement {
    if (character.academySparClaimed === true) {
        return { ok: false, status: 409, error: 'Academy spar reward was already claimed.' };
    }
    const onboardingStep = String(character.onboardingStep ?? '');
    if (onboardingStep !== 'academySpar' && onboardingStep !== 'spar') {
        return { ok: false, status: 409, error: 'Academy spar is not the current onboarding step.' };
    }
    if (proof.opponentId !== ACADEMY_SPAR_OPPONENT_ID) {
        return { ok: false, status: 409, error: 'Server combat proof does not match the Academy spar.' };
    }
    // The teaching reward: +20 pool points (replacing the old one-time 60 XP)
    // teaches the USER STATS panel the way the XP bar move used to.
    const leveled = grantPoolPoints(character, 20);
    const maxHp = Math.max(1, Number(leveled.maxHp) || 1);
    const next: PlayerCharacter = {
        ...leveled,
        ryo: Math.max(0, Number(leveled.ryo) || 0) + 30,
        hp: Math.max(1, maxHp - 25),
        stamina: Math.max(0, Number(leveled.maxStamina) || 0),
        chakra: Math.max(0, Number(leveled.maxChakra) || 0),
        onboardingStep: 'cafeteria',
        academySparClaimed: true,
    };
    return { ok: true, character: next, progress: 0, xp: 0, statPoints: 20, ryo: 30, auraDust: 0, finale: false };
}

export function applyStoryBossSettlement(
    character: PlayerCharacter,
    proof: StoryOpponentProof,
    survivingHpRaw: unknown,
): StorySettlement {
    const progress = Math.max(0, Math.floor(Number(character.storyProgress) || 0));
    if (progress >= STORY_LEVELS.length) return { ok: false, status: 409, error: 'Village story is already complete.' };
    const levelReq = STORY_LEVELS[progress];
    const playerLevel = Math.max(1, Math.floor(Number(character.level) || 1));
    if (playerLevel < levelReq) return { ok: false, status: 403, error: `Story milestone requires level ${levelReq}.` };
    const village = typeof character.village === 'string' ? character.village : '';
    if (!LIBERATOR_TITLES[village]) return { ok: false, status: 409, error: 'Player village has no story catalog.' };
    if (proof.opponentId !== storyOpponentId(village, levelReq)) {
        return { ok: false, status: 409, error: 'Server combat proof does not match the current story boss.' };
    }
    const reward = STORY_REWARDS[progress];
    const leveled = grantPoolPoints(character, reward.statPoints);
    const maxHp = Math.max(1, Number(leveled.maxHp) || 1);
    const maxStamina = Math.max(0, Number(leveled.maxStamina) || 0);
    const maxChakra = Math.max(0, Number(leveled.maxChakra) || 0);
    const survivingHp = Math.max(0, Math.min(maxHp, Number(survivingHpRaw) || 0));
    const finale = progress === STORY_LEVELS.length - 1;
    const title = finale ? LIBERATOR_TITLES[village] : undefined;
    const inventory = Array.isArray(leveled.inventory)
        ? (leveled.inventory as unknown[]).filter((id): id is string => typeof id === 'string')
        : [];
    const next: PlayerCharacter = {
        ...leveled,
        ryo: Math.max(0, Number(leveled.ryo) || 0) + reward.ryo,
        auraDust: Math.max(0, Number(leveled.auraDust) || 0) + 12,
        hp: Math.min(maxHp, survivingHp + 25),
        stamina: Math.min(maxStamina, Math.max(0, Number(leveled.stamina) || 0) + 20),
        chakra: Math.min(maxChakra, Math.max(0, Number(leveled.chakra) || 0) + 20),
        storyProgress: progress + 1,
        clanBattleContrib: Math.max(0, Math.floor(Number(leveled.clanBattleContrib) || 0)) + 1,
        clanContribMonth: new Date().toISOString().slice(0, 7),
        ...(finale ? {
            storyTitle: title,
            rankTitle: title,
            inventory: inventory.includes('hollow-gate-key') ? inventory : [...inventory, 'hollow-gate-key'],
        } : {}),
    };
    // The Chronicle stays sealed until Scribe Ihara's level-17 ceremony. Once
    // opened, every verified first-clear presses its exact boss record in the
    // same authoritative settlement. Earlier clears are backfilled when the
    // codex is claimed (api/card-clash/_starter-cards.ts).
    const cardId = storyProgressionCardId(proof.opponentId);
    const chronicle = character.starterCardsClaimed === true && cardId
        ? grantChronicleProgressionCards(next, [cardId])
        : { character: next as Record<string, unknown>, granted: [] as string[] };
    return {
        ok: true,
        character: chronicle.character as PlayerCharacter,
        progress: progress + 1,
        xp: 0,
        statPoints: reward.statPoints,
        ryo: reward.ryo,
        auraDust: 12,
        finale,
        chronicleCards: chronicle.granted,
        ...(title ? { title } : {}),
    };
}
