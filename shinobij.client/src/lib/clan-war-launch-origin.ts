import type {CwWar} from './clan-war-api';

export function clanWarLaunchOrigin(war:CwWar|undefined,challengeId:string|undefined) {
    const campaign=war?.campaignView,match=challengeId?campaign?.matches.find(entry=>entry.id===challengeId):undefined;
    const shrine=match?.scope==='shrine'?campaign?.shrines.find(window=>window.index===match.windowIndex):undefined;
    return {returnScreen:shrine?'worldMap' as const:'clan' as const,shrineSector:shrine?.sector,shrineWindowIndex:shrine?.index,campaignVersion:campaign?.version};
}
