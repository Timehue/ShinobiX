/**
 * Which solo-PvE bosses transform, as data.
 *
 * A plan is chosen by the encounter KIND and the AI profile id together, never
 * by id alone: raid village guards reuse the story finale's opponent ids and
 * must not inherit the story-only transformation. To make another boss
 * transform, add an entry here (or give its profile a `bossTransformation`).
 */
import type { BossTransformationPlan } from '../../shared/boss-transformations.js';
import { STORY_KAGE_ENCOUNTERS } from '../../shared/story-kage.js';
import { STORY_KAGE_TRANSFORMATIONS } from '../story/_kage-transformations.js';

const storyFinaleId = (village: string) => `story-ai-${village.toLowerCase().replace(/\W+/g, '-')}-100`;

const REGISTRY: Readonly<Record<string, Readonly<Record<string, BossTransformationPlan>>>> = {
    'story-boss': Object.fromEntries(Object.keys(STORY_KAGE_ENCOUNTERS).map(village => [
        storyFinaleId(village),
        STORY_KAGE_TRANSFORMATIONS[village as keyof typeof STORY_KAGE_TRANSFORMATIONS],
    ])),
};

export function soloPveBossTransformationFor(encounterKind: string, profileId: string): BossTransformationPlan | undefined {
    const byId = Object.prototype.hasOwnProperty.call(REGISTRY, encounterKind) ? REGISTRY[encounterKind] : undefined;
    return byId && Object.prototype.hasOwnProperty.call(byId, profileId) ? byId[profileId] : undefined;
}
