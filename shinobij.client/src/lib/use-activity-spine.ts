import { useEffect, useRef, useState } from 'react';
import type { ActivitySpine } from '../../../shared/activity-spine';
import { SAVE_VERSION_EVENT, type SaveVersionEventDetail } from '../authFetch';
import { captureProductEvent } from './analytics';
import { activitySpineRequestPath } from './activity-spine-request';

type Result = { key: string; spine: ActivitySpine | null; status: 'loading' | 'ready' | 'offline' | 'error' };

export function useActivitySpine(player: string, focus: string | undefined, source: string, capabilities: string, retry: number) {
    const [revision, setRevision] = useState(0);
    const [result, setResult] = useState<Result | null>(null);
    const lastSavedSource = useRef('');
    const sourceRef = useRef(source);
    useEffect(() => { sourceRef.current = source; }, [source]);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let lastVersion = 0;
        const changed = (event: Event) => {
            const detail = (event as CustomEvent<SaveVersionEventDetail>).detail;
            if (!detail || detail.accountName?.trim().toLowerCase() !== player.trim().toLowerCase() || detail.version <= lastVersion) return;
            lastVersion = detail.version;
            // Periodic unchanged autosaves are not recommendation changes. An
            // acknowledged changed source corrects a pre-autosave read once.
            if (detail.source === 'full-save' && lastSavedSource.current === sourceRef.current) return;
            lastSavedSource.current = sourceRef.current;
            clearTimeout(timer);
            timer = setTimeout(() => setRevision(v => v + 1), 250);
        };
        window.addEventListener(SAVE_VERSION_EVENT, changed);
        return () => { clearTimeout(timer); window.removeEventListener(SAVE_VERSION_EVENT, changed); };
    }, [player]);

    const key = JSON.stringify([player, focus, source, capabilities, retry, revision]);
    useEffect(() => {
        const controller = new AbortController();
        // Coalesce a save receipt, character adoption and capability update.
        const timer = setTimeout(() => {
            fetch(activitySpineRequestPath(player, focus), { signal: controller.signal, cache: 'no-store' })
                .then(async response => {
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return await response.json() as { spine?: ActivitySpine };
                })
                .then(data => {
                    if (controller.signal.aborted) return;
                    if (!data.spine) throw new Error('Missing activity spine');
                    setResult({ key, spine: data.spine, status: 'ready' });
                    captureProductEvent('activity_recommendation_viewed', { screenId: 'daily-briefing', horizon: 'all', focus: data.spine.resolvedFocus });
                })
                .catch((error: unknown) => {
                    if (controller.signal.aborted) return;
                    setResult({ key, spine: null, status: navigator.onLine ? 'error' : 'offline' });
                    if (import.meta.env.DEV) console.warn('[activity-spine]', error);
                });
        }, 150);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [player, focus, key]);

    // A different account/source never gets a single render of old readiness,
    // even before effect cleanup or when a fetch ignores AbortSignal.
    return result?.key === key ? result : { key, spine: null, status: 'loading' as const };
}
