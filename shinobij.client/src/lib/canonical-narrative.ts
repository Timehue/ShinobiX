import type { CreatorEvent } from '../types/vn';
import { AWAKENING_VN_ID, AURA_SPHERE_VN_ID, DUNGEON_VN_ID } from '../constants/game';

/** These events have dedicated delivery and progression paths. A saved copy
 * must never turn into a second, generic creator-event trigger. */
export function isReservedNarrativeId(id: string): boolean {
    return /^(?:story-|rift-giver-|rift-descend-|rift-first-clear-|craft-dungeon-)/.test(id)
        || [AWAKENING_VN_ID, AURA_SPHERE_VN_ID, DUNGEON_VN_ID, 'sys-pet-encounter', 'sys-ancient-chest', 'pet-encounter', 'ancient-chest', 'legacy-sage-offer', 'chronicle-scribe'].includes(id);
}

const identity = (name: string | undefined) => (name ?? '').trim().toLowerCase();

/** Repository-authored events own their words, speakers, branches and gates.
 * Older admin saves may supply artwork, but cannot replace the story graph.
 * Match a page before reusing art: an index alone is unsafe after a rewrite.
 * Custom creator events do not pass through this function. */
export function canonicalNarrativeEvent(
    base: CreatorEvent,
    saved?: CreatorEvent,
    legacyIds: readonly string[] = [],
): CreatorEvent {
    if (!saved || (saved.id !== base.id && !legacyIds.includes(saved.id))) return base;
    return {
        ...base,
        image: saved.image || base.image,
        avatarImage: identity(saved.vnSpeaker) === identity(base.vnSpeaker) ? saved.avatarImage || base.avatarImage : base.avatarImage,
        cinematic: saved.cinematic ?? base.cinematic,
        vnPages: base.vnPages?.map((page, index) => {
            const prior = page.id
                ? saved.vnPages?.find(candidate => candidate.id === page.id)
                : saved.vnPages?.[index];
            if (!prior || (!page.id && prior.title !== page.title)) return page;
            const imageFor = (name: string | undefined, fallback: string | undefined) => {
                const actor = identity(name);
                if (!actor) return fallback;
                if (actor === identity(prior.leftName)) return prior.leftImage || fallback;
                if (actor === identity(prior.rightName ?? prior.speaker)) return prior.rightImage || fallback;
                return fallback;
            };
            return {
                ...page,
                image: prior.image || page.image,
                cinematic: prior.cinematic ?? page.cinematic,
                leftImage: imageFor(page.leftName ?? 'Player', page.leftImage),
                rightImage: imageFor(page.rightName ?? page.speaker, page.rightImage),
                choices: page.choices?.map((choice, choiceIndex) => {
                    const old = choice.id ? prior.choices?.find(candidate => candidate.id === choice.id) : prior.choices?.[choiceIndex];
                    const background = old?.battle?.backgroundImage;
                    if (!choice.battle || !background || (!choice.id && (old?.text !== choice.text || old.nextPage !== choice.nextPage))) return choice;
                    return { ...choice, battle: { ...choice.battle, backgroundImage: background } };
                }),
            };
        }),
    };
}
