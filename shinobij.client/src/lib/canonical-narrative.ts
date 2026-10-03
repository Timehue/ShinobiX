import type { CreatorEvent } from '../types/vn';
import { AWAKENING_VN_ID, AURA_SPHERE_VN_ID, DUNGEON_VN_ID } from '../constants/game';

/** These events have dedicated delivery and progression paths. A saved copy
 * must never turn into a second, generic creator-event trigger. */
export function isReservedNarrativeId(id: string): boolean {
    return /^(?:story-|rift-giver-|rift-descend-|rift-first-clear-|craft-dungeon-)/.test(id)
        || [AWAKENING_VN_ID, AURA_SPHERE_VN_ID, DUNGEON_VN_ID, 'sys-pet-encounter', 'sys-ancient-chest', 'pet-encounter', 'ancient-chest', 'legacy-sage-offer', 'chronicle-scribe'].includes(id);
}

const identity = (name: string | undefined) => (name ?? '').trim().toLowerCase();

/** What the Admin Panel lists: each built-in as players receive it (current
 * text, saved art merged), then genuinely custom events. A saved copy of a
 * reserved id is never listed as custom, so an old import cannot read as the
 * live story. Nothing is removed from `saved`; stored copies stay intact. */
export function adminEditableNarrativeEvents(builtIns: readonly CreatorEvent[], saved: readonly CreatorEvent[]): CreatorEvent[] {
    return [
        ...builtIns.map(base => canonicalNarrativeEvent(base, saved.find(event => event.id === base.id))),
        ...saved.filter(event => !isReservedNarrativeId(event.id)),
    ];
}

function sameCinematic(a: CreatorEvent['cinematic'], b: CreatorEvent['cinematic']): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const keys = Object.keys(a) as (keyof NonNullable<CreatorEvent['cinematic']>)[];
    return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key]);
}

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
    const image = saved.image || base.image;
    const avatarImage = identity(saved.vnSpeaker) === identity(base.vnSpeaker)
        ? saved.avatarImage || base.avatarImage : base.avatarImage;
    const cinematic = saved.cinematic ?? base.cinematic;
    const sameEventCinematic = sameCinematic(cinematic, base.cinematic);
    let pagesChanged = false;
    const vnPages = base.vnPages?.map((page, index) => {
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
        const image = prior.image || page.image;
        const cinematic = prior.cinematic ?? page.cinematic;
        const samePageCinematic = sameCinematic(cinematic, page.cinematic);
        const leftImage = imageFor(page.leftName ?? 'Player', page.leftImage);
        const rightImage = imageFor(page.rightName ?? page.speaker, page.rightImage);
        let choicesChanged = false;
        const choices = page.choices?.map((choice, choiceIndex) => {
            const old = choice.id ? prior.choices?.find(candidate => candidate.id === choice.id) : prior.choices?.[choiceIndex];
            const background = old?.battle?.backgroundImage;
            if (!choice.battle || !background || background === choice.battle.backgroundImage
                || (!choice.id && (old?.text !== choice.text || old.nextPage !== choice.nextPage))) return choice;
            choicesChanged = true;
            return { ...choice, battle: { ...choice.battle, backgroundImage: background } };
        });
        if (image === page.image && samePageCinematic && leftImage === page.leftImage
            && rightImage === page.rightImage && !choicesChanged) return page;
        pagesChanged = true;
        return {
            ...page, image, cinematic: samePageCinematic ? page.cinematic : cinematic,
            leftImage, rightImage, choices: choicesChanged ? choices : page.choices,
        };
    });
    if (image === base.image && avatarImage === base.avatarImage && sameEventCinematic && !pagesChanged) return base;
    return {
        ...base, image, avatarImage, cinematic: sameEventCinematic ? base.cinematic : cinematic,
        vnPages: pagesChanged ? vnPages : base.vnPages,
    };
}

/** Compare only the visual outcome of canonical merge + image overlay. */
export function sameNarrativeArtwork(base: CreatorEvent, next: CreatorEvent): boolean {
    if (base === next) return true;
    if (base.id !== next.id || base.image !== next.image || base.avatarImage !== next.avatarImage
        || base.cinematic !== next.cinematic || base.vnPages?.length !== next.vnPages?.length) return false;
    return (base.vnPages ?? []).every((page, index) => {
        const other = next.vnPages![index];
        return page.image === other.image && page.leftImage === other.leftImage
            && page.rightImage === other.rightImage && page.cinematic === other.cinematic
            && page.choices?.length === other.choices?.length
            && (page.choices ?? []).every((choice, choiceIndex) =>
                choice.battle?.backgroundImage === other.choices![choiceIndex].battle?.backgroundImage);
    });
}
