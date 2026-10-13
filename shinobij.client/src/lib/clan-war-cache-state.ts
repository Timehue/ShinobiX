import {getSocketAuth} from '../authFetch';
import {createClanWarViewerCache} from './clan-war-viewer-cache';
import type {CwWar} from './clan-war-api';

export const clanWarViewerCache = createClanWarViewerCache<CwWar>(() => getSocketAuth().name);
