import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorldEraChapter } from '../../src/components/WorldEraChapter';
import { ERA_CHAPTERS, eraChapterProgress } from '../../../shared/era-chapters';
import type { EraChapterProgress, EraJourney } from '../../../shared/era-chapters';
import '../../src/styles/tokens.css';
const chapter = ERA_CHAPTERS[Number(new URLSearchParams(location.search).get('era') ?? 0)];
function Fixture() {
    const [progress, setProgress] = useState<EraChapterProgress>(() => eraChapterProgress(chapter,
        new URLSearchParams(location.search).has('historical') ? { routeId: chapter.routes[1]!.id, startedAt: 1000, baselines: { historical: 0 }, completedAt: 1100 } : undefined, {}, true));
    const [destination, setDestination] = useState('Hall');
    return <main style={{ maxWidth: 900, margin: 'auto', padding: 16, background: '#0f172a', color: '#cbd5e1', fontFamily: 'system-ui', minHeight: '100vh', boxSizing: 'border-box' }}>
        <h1>World Eras</h1><p>Your next chapter begins with something you do.</p>
        <WorldEraChapter eraId={chapter.eraId} playerName="eraqa" progress={progress} canMutate={true} setScreen={setDestination} onVersionedCharacter={() => true} onProgress={setProgress} />
        <p aria-label="Destination">{destination}</p>
        {progress.routeId && !progress.completedAt && <button type="button" onClick={() => {
            const stages = chapter.routes[0]!.stages!;
            const index = Math.min(stages.length, (progress.campaign?.stageIndex ?? 0) + 1);
            const journey: EraJourney = { version: 2, routeId: progress.routeId!, startedAt: 1000, baselines: {}, stageIndex: index, stageStartedAt: Date.now(), stageCounts: {}, completedStages: stages.slice(0, index).map(stage => ({ id: stage.id, at: Date.now() })), proofReceipts: [] };
            setProgress(eraChapterProgress(chapter, journey, {}, true));
        }}>QA: complete current stage</button>}
        {chapter === ERA_CHAPTERS[0] && <>
            <WorldEraChapter eraId="hollow-gate-opens" playerName="eraqa" progress={{ ...eraChapterProgress(ERA_CHAPTERS[1], undefined, {}, false), blockedReason: 'Complete the Era I campaign first.' }} canMutate={true} setScreen={setDestination} onVersionedCharacter={() => true} onProgress={() => {}} />
            <WorldEraChapter eraId="mythic-legacies" playerName="eraqa" progress={eraChapterProgress(ERA_CHAPTERS[4], undefined, {}, false)} canMutate={true} setScreen={setDestination} onVersionedCharacter={() => true} onProgress={() => {}} />
        </>}
    </main>;
}
async function mount() {
    const root = createRoot(document.getElementById('root')!);
    if (!new URLSearchParams(location.search).has('hall')) { root.render(<Fixture />); return; }
    const [{ HallOfLegends }, { liveCapabilitiesStore }] = await Promise.all([
        import('../../src/screens/HallOfLegends'), import('../../src/lib/live-capabilities'),
    ]);
    await liveCapabilitiesStore.refresh();
    sessionStorage.setItem('hall.initialTab', 'eras');
    root.render(<main style={{ maxWidth: 900, margin: 'auto', padding: 16, color: '#cbd5e1', background: '#0f172a' }}>
        <HallOfLegends character={{ name: 'eraqa', level: 70, pets: [], jutsu: [], stats: {}, village: 'Stormveil Village' } as never}
            playerRoster={[]} setScreen={() => {}} updateCharacter={() => {}} onVersionedCharacter={() => true} />
    </main>);
}
void mount();
