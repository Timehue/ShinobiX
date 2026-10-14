import {clanWarViewerCache as viewerCache} from './clan-war-cache-state';
import {retryDynamicImport} from './lazyWithRetry';
import type {CwWar} from './clan-war-api';
export type {CwWar,CwChallenge,CwChallengeMode,CwChallengeResult} from './clan-war-api';

export const sharedClanWarCache:Record<string,CwWar>=viewerCache.cache;

/** Coalesce pollers per viewer in the on-use list implementation. */
export async function cwListWars():Promise<CwWar[]> {
    const viewer=viewerCache.scope();
    try {
        const list=await retryDynamicImport(()=>import('./clan-war-list'));
        return viewerCache.current(viewer)?list.listClanWars(viewer):[];
    }catch{return [];}
}
