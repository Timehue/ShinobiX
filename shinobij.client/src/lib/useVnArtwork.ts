import { useEffect, useState } from 'react';
import type { CreatorEvent } from '../types/vn';
import { isRetiredVnArt, omitRetiredVnArt, retiredVnArtHash, retiredVnArtSources } from './vn-retired-artwork';

/** A single shared slot read outside the page overlay (a Relic Dungeon entrance).
 * Hidden while it is checked; kept only when its bytes are not retired art. */
export function useVerifiedSharedArt(eventId: string, source: string | undefined): string | undefined {
    const candidate = source && retiredVnArtHash(eventId, source) ? source : undefined;
    const [kept, setKept] = useState<string>();
    useEffect(() => {
        if (!candidate) return;
        let active = true;
        void isRetiredVnArt(eventId, candidate).then(retired => { if (active) setKept(retired ? undefined : candidate); });
        return () => { active = false; };
    }, [eventId, candidate]);
    if (!candidate) return source;
    return kept === candidate ? candidate : undefined;
}

/** Retire only verified legacy shared exports; future uploads still win. */
export function useVnArtwork(event: CreatorEvent): CreatorEvent {
    const sourcesKey = JSON.stringify(retiredVnArtSources(event));
    const eventId = event.id;
    const key = `${eventId}:${sourcesKey}`;
    const [verified, setVerified] = useState<{ key: string; sources: Set<string> }>();
    useEffect(() => {
        const sources = JSON.parse(sourcesKey) as string[];
        if (!sources.length) return;
        let active = true;
        void Promise.all(sources.map(async source => await isRetiredVnArt(eventId, source) ? source : ''))
            .then(retired => {
                if (active) setVerified({ key, sources: new Set(retired.filter(Boolean)) });
            });
        return () => { active = false; };
    }, [eventId, key, sourcesKey]);
    // Start with the current cast while checking an old positional slot. This
    // prevents a flash of the wrong face on slow connections. Only proven new
    // bytes restore the explicit override; a failed check keeps the current cast.
    const retired = verified?.key === key ? verified.sources : new Set<string>(JSON.parse(sourcesKey));
    return omitRetiredVnArt(event, retired);
}
