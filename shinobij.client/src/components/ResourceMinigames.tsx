import { lazy, Suspense } from 'react';
import type { ResourcePublicAttempt } from '../../../shared/resource-gathering';
import { Veinbreaking, RelaxedMining } from './Veinbreaking';
import './resource-minigames.css';

const KunaiFishing = lazy(() => import('./KunaiFishing'));
const KamaReaping = lazy(() => import('./KamaReaping'));
export function ResourceMinigame({ attempt, busy, resolve, fishingGold = false }: { attempt: ResourcePublicAttempt; busy: boolean; resolve: (input: Record<string, unknown>) => void; fishingGold?: boolean }) {
    // Harvesting plays (and animates) inside Kama Reaping in both modes.
    if (attempt.activity === 'harvesting') return <Suspense fallback={<p role="status">Readying your kama…</p>}><KamaReaping attempt={attempt} busy={busy} resolve={resolve} /></Suspense>;
    if (attempt.activity === 'fishing' && attempt.fishingStyle === 'kunai') return <Suspense fallback={<p role="status">Preparing your fishing kunai…</p>}><KunaiFishing attempt={attempt} busy={busy} resolve={resolve} golden={fishingGold} /></Suspense>;
    if (attempt.activity === 'mining') return attempt.mode === 'relaxed' ? <RelaxedMining attempt={attempt} busy={busy} resolve={resolve} /> : <Veinbreaking attempt={attempt} busy={busy} resolve={resolve} />;
    // Every fishing attempt since 2026-10-22 is kunai fishing, and an attempt
    // expires 90 seconds after it starts, so the old cast-and-reel game was
    // retired. Its server scoring remains, so an old attempt still closes cleanly.
    return <p role="status">This attempt uses a retired fishing game. Abandon it to return to the map.</p>;
}
