import type { CreatorEvent } from '../types/vn';

type CastFields = { leftName?: string; rightName?: string; speaker?: string; leftImage?: string; rightImage?: string };
const identity = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export function vnPageActorName(page: CastFields, side: 'left' | 'right', eventSpeaker = 'Narrator'): string {
    return side === 'left' ? page.leftName?.trim() || 'Player'
        : page.rightName?.trim() || page.speaker?.trim() || eventSpeaker;
}

/** The identity is part of the storage key, so a renamed actor cannot inherit
 * the previous occupant's portrait. This also survives Player/NPC side swaps. */
export function vnActorImageKey(eventId: string, pageIndex: number, actorName: string): string {
    return `vn:${eventId}:page:${pageIndex}:actor:${encodeURIComponent(identity(actorName))}`;
}

export function vnSharedImageActor(source: string): string | undefined {
    if (!source.startsWith('/api/img?')) return undefined;
    const id = new URLSearchParams(source.slice(source.indexOf('?') + 1)).get('id');
    const actor = id && /^vn:.*:page:\d+:actor:(.+)$/.exec(id)?.[1];
    if (!actor) return undefined;
    try { return decodeURIComponent(actor); } catch { return undefined; }
}

export function updateVnPageCast<T extends CastFields>(page: T, updated: Partial<T>, eventSpeaker?: string): T {
    const next = { ...page, ...updated };
    for (const side of ['left', 'right'] as const) {
        const field = side === 'left' ? 'leftImage' : 'rightImage';
        if (!(field in updated) && identity(vnPageActorName(page, side, eventSpeaker)) !== identity(vnPageActorName(next, side, eventSpeaker))) {
            next[field] = '';
        }
    }
    return next;
}

/** One hydration path for initial loads, late image loads and story triggers.
 * References are retained when nothing changes, so live hydration is a no-op.
 */
export function overlayVnImages(
    base: CreatorEvent, eventId: string, images: Record<string, string>,
    { preserveCast = false }: { preserveCast?: boolean } = {},
): CreatorEvent {
    const image = images[`event:${eventId}:bg`] || base.image;
    const avatarImage = preserveCast ? base.avatarImage : images[`event:${eventId}:avatar`] || base.avatarImage;
    let changed = image !== base.image || avatarImage !== base.avatarImage;
    const keys = Object.keys(images);
    const vnPages = base.vnPages?.map((page, index) => {
        const prefix = `vn:${eventId}:page:${index}`;
        const next = { ...page, image: images[prefix] || page.image };
        if (!preserveCast) {
            const bound = keys.some(key => key.startsWith(`${prefix}:actor:`));
            for (const side of ['left', 'right'] as const) {
                const field = side === 'left' ? 'leftImage' : 'rightImage';
                const named = images[vnActorImageKey(eventId, index, vnPageActorName(page, side, base.vnSpeaker))];
                const legacy = images[`${prefix}:${side}`];
                if (named) next[field] = named;
                else if (!bound && legacy) next[field] = legacy;
                else if (bound && (page[field] === legacy || vnSharedImageActor(page[field] ?? '') !== undefined)) delete next[field];
            }
        }
        let choicesChanged = false;
        const choices = page.choices?.map((choice, choiceIndex) => {
            const backgroundImage = images[`${prefix}:choice:${choiceIndex}:bg`];
            if (!backgroundImage || backgroundImage === choice.battle?.backgroundImage) return choice;
            choicesChanged = true;
            return { ...choice, battle: { ...choice.battle, backgroundImage } };
        });
        if (!choicesChanged && next.image === page.image && next.leftImage === page.leftImage && next.rightImage === page.rightImage) return page;
        changed = true;
        return choicesChanged ? { ...next, choices } : next;
    });
    return changed ? { ...base, image, avatarImage, vnPages } : base;
}
