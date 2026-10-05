import type { Character } from '../types/character';
import { ERA_CHAPTERS, type EraChapterProgress } from '../../../shared/era-chapters';

export async function fetchEraChapters(playerName: string, fetcher: typeof fetch = fetch): Promise<EraChapterProgress[]> {
    const response = await fetcher(`/api/eras/journey?playerName=${encodeURIComponent(playerName)}`, { credentials: 'same-origin', cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.chapters)) throw new Error(data.error || 'Your chapter records could not be loaded.');
    return data.chapters;
}

export async function sealEraChapter(playerName: string, eraId: string, action: 'start' | 'complete', routeId?: string, fetcher: typeof fetch = fetch) {
    const response = await fetcher('/api/eras/journey', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerName, eraId, action, ...(routeId ? { routeId } : {}) }) });
    const data = await response.json();
    if (!response.ok || data.ok !== true) throw new Error(data.error || 'Your chapter could not be recorded.');
    const version = Number(data._saveVersion);
    const chapter = ERA_CHAPTERS.find(item => item.eraId === eraId);
    const route = chapter?.routes.find(item => item.id === data.chapter?.routeId);
    const record = data.character?.eraJourneys?.[eraId];
    if (!chapter || !route || data.chapter.eraId !== eraId || data.character?.name !== playerName
        || !Number.isSafeInteger(version) || version < 0 || record?.routeId !== route.id
        || (route.stages && (record.version !== 2 || !Number.isInteger(record.stageIndex) || record.stageIndex < 0 || record.stageIndex > route.stages.length
            || data.chapter.campaign?.stageIndex !== record.stageIndex
            || data.chapter.startedAt !== record.startedAt || data.chapter.completedAt !== (record.completedAt ?? null)
            || (action === 'complete' && record.stageIndex !== route.stages.length)))
        || (action === 'start' && routeId !== route.id)
        || (action === 'complete' && (!record?.completedAt || !data.character.serverTitles?.includes(chapter.rewardTitle)))) {
        throw new Error('The Hall response could not be verified. Refresh your record and try again.');
    }
    return { chapter: data.chapter as EraChapterProgress, character: data.character as Character, saveVersion: version };
}
