import { useEffect, useRef, useState } from 'react';
import type { Character } from '../types/character';
import type { Screen } from '../types/core';
import { ERA_CHAPTERS, type EraChapterProgress } from '../../../shared/era-chapters';
import { sealEraChapter } from '../lib/era-journeys';
import './world-era-chapter.css';

type WorldEraChapterProps = {
    eraId: string; playerName: string; progress?: EraChapterProgress; canMutate: boolean;
    setScreen: (screen: Screen) => void; onVersionedCharacter: (character: Character, version?: number) => boolean;
    onProgress: (progress: EraChapterProgress) => void;
};

export function WorldEraChapter(props: WorldEraChapterProps) {
    return <PersonalEraChapter key={JSON.stringify([props.playerName, props.eraId])} {...props} />;
}

function PersonalEraChapter({ eraId, playerName, progress, canMutate, setScreen, onVersionedCharacter, onProgress }: WorldEraChapterProps) {
    const chapter = ERA_CHAPTERS.find(item => item.eraId === eraId);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const generation = useRef(0);
    useEffect(() => { generation.current += 1; return () => { generation.current += 1; }; }, []);
    if (!chapter) return null;
    const route = chapter.routes.find(item => item.id === progress?.routeId);
    async function submit(action: 'start' | 'complete', routeId?: string) {
        if (busy || !canMutate) return;
        const request = ++generation.current;
        setBusy(true); setError('');
        try {
            const result = await sealEraChapter(playerName, eraId, action, routeId);
            if (request !== generation.current) return;
            // Recorded even if a newer save was adopted first and this commit is
            // refused as stale (the coordinator then reads the stored save back).
            onVersionedCharacter(result.character, result.saveVersion);
            onProgress(result.chapter);
        } catch (failure) {
            if (request === generation.current) setError(failure instanceof Error ? failure.message : 'The Hall could not record your chapter.');
        } finally { if (request === generation.current) setBusy(false); }
    }
    return <section className="era-chapter" aria-label={chapter.name}>
        <div className="era-chapter-heading"><span>{progress?.completedAt ? 'YOUR PLACE IN THE RECORD' : progress?.campaign ? 'YOUR ERA CAMPAIGN' : progress?.available || progress?.blockedReason ? 'YOUR CHAPTER' : 'WHEN THIS AGE OPENS'}</span><strong>{chapter.name}</strong></div>
        <p className="era-chapter-voice"><b>{chapter.speaker}:</b> {progress?.completedAt ? route?.conclusion : !progress?.available && !progress?.blockedReason && chapter.sealedIntroduction ? chapter.sealedIntroduction : chapter.introduction}</p>
        <p className="era-chapter-reward">{progress?.completedAt ? 'Earned title' : 'Permanent reward'}: <b>{chapter.rewardTitle}</b> · Cosmetic · Available to later arrivals</p>
        {chapter.admission && <p>Admission: complete the preceding personal campaign, reach level {chapter.admission.level}, and bring your chosen Legacy to Stage {chapter.admission.legacyStage === 4 ? 'IV (Proven)' : 'V (summit)'}. Any rarity qualifies. Spire examinations require four live players in a ready room, with each player's required tier unlocked. They are squad feats.</p>}
        {progress?.legacyCompletedAt && !progress.completedAt && <p>Your earlier chapter title is preserved. This campaign requires its own new victories and examinations.</p>}
        {progress?.campaign && <ol className="era-campaign-stages" aria-label="Campaign stages">{progress.campaign.stages.map((stage, index) => <li key={stage.id}>
            <strong>{stage.done ? '✓ ' : index === progress.campaign!.stageIndex && route ? 'Current: ' : ''}{stage.name}</strong>
            <ul>{stage.objectives.map(objective => <li key={objective.id}>{objective.label}: {objective.required}<small>{objective.hint}</small></li>)}</ul>
        </li>)}</ol>}
        {!progress ? <p role="status">Loading your record…</p> : !progress.available && !progress.completedAt ? <p>{progress.blockedReason ?? 'The community must open this age before you can begin its investigation.'}</p> : progress.completedAt ? <div className="era-chapter-sealed"><span>✓ Account recorded · {new Date(progress.completedAt).toLocaleDateString()}</span><button type="button" onClick={() => setScreen('profile')}>Wear your title →</button></div> : !route ? <>
            <p>{progress.historicalRouteId ? 'Continue with your recorded perspective. Every campaign stage requires new victories and examinations.' : progress.campaign ? 'Choose a narrative perspective. Both require every campaign stage. Only new qualified victories count after acceptance.' : 'Choose one route. Evidence counts from the moment you accept it.'}</p>
            <div className="era-chapter-routes">{chapter.routes.filter(choice => !progress.historicalRouteId || choice.id === progress.historicalRouteId).map(choice => <div key={choice.id}>
                <strong>{choice.name}</strong><p>{choice.briefing}</p>
                {!choice.stages && <ul>{choice.objectives.map(objective => <li key={objective.id}>{objective.label}: {objective.required}{objective.hint && <small style={{ display: 'block' }}>{objective.hint}</small>}</li>)}</ul>}
                <button type="button" disabled={busy || !canMutate} onClick={() => void submit('start', choice.id)}>{busy ? 'Recording…' : 'Take this commission'}</button>
            </div>)}</div>
        </> : <>
            <strong>{route.name}</strong>
            {progress.campaign?.recentConclusion && <p className="era-campaign-scene">{progress.campaign.recentConclusion}</p>}
            <p>{progress.campaign ? progress.ready ? 'Every stage and examination is recorded. Return your account to claim the campaign title.' : progress.campaign.briefing : route.briefing}</p>
            <div className="era-chapter-objectives">{progress.objectives.map(objective => <div key={objective.id}>
                <span>{objective.done ? '✓ ' : ''}{objective.label}{objective.hint && <small style={{ display: 'block' }}>{objective.hint}</small>}</span><b>{objective.current} / {objective.required}</b>
                <button type="button" onClick={() => setScreen(objective.destination)}>Go investigate →</button>
            </div>)}</div>
            <button type="button" className="era-chapter-claim" disabled={!progress.ready || busy || !canMutate || !progress.available} onClick={() => void submit('complete')}>{busy ? 'Sealing your account…' : progress.ready ? 'Return your account and earn the title' : 'Gather the remaining evidence'}</button>
        </>}
        {!canMutate && !progress?.completedAt && <p>Chapter recording is temporarily unavailable.</p>}
        {error && <p role="alert" className="era-chapter-error">{error}</p>}
    </section>;
}
