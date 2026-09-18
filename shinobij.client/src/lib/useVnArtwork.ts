import { useEffect, useState } from 'react';
import type { CreatorEvent } from '../types/vn';
import { isRetiredVnArt, omitRetiredVnArt, retiredVnArtSources } from './vn-retired-artwork';

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
    // prevents a flash of the wrong face on slow connections. New bytes (or a
    // failed check) restore the explicit override as soon as verification ends.
    const retired = verified?.key === key ? verified.sources : new Set<string>(JSON.parse(sourcesKey));
    return omitRetiredVnArt(event, retired);
}
