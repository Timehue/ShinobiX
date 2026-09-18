import { useLayoutEffect, useState } from 'react';
import { ACTIVITY_SECTION_EVENT, readActivitySection } from './activity-spine-navigation';

/** Consume only after commit: Strict Mode can run initializers twice. */
export function useActivitySection<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
    const [section] = useState(() => readActivitySection(key, allowed, fallback));
    useLayoutEffect(() => {
        try { sessionStorage.removeItem(key); } catch { /* optional storage */ }
    }, [key]);
    return section;
}

/** A recommendation can target a screen that is already mounted. Keep manual
 * tab choices until a new explicit request arrives, without remounting routing. */
export function useActivitySectionRequests<T extends string>(key: string, allowed: readonly T[], select: (section: T) => void): void {
    const sections = allowed.join('|');
    useLayoutEffect(() => {
        const requested = (event: Event) => {
            const detail = (event as CustomEvent<{ key?: string; section?: string }>).detail;
            if (detail?.key !== key || typeof detail.section !== 'string' || !sections.split('|').includes(detail.section)) return;
            try { sessionStorage.removeItem(key); } catch { /* explicit local request still applies */ }
            select(detail.section as T);
        };
        window.addEventListener(ACTIVITY_SECTION_EVENT, requested);
        return () => window.removeEventListener(ACTIVITY_SECTION_EVENT, requested);
    }, [key, sections, select]);
}
