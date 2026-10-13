import {setSectorReopen} from './sector-return';
export {clanWarLaunchOrigin} from './clan-war-launch-origin';
/** Browser navigation only: battle and reward authority never depends on it. */
export function clanWarReturnTarget():'clan'|'worldMap' {
    try{return JSON.parse(sessionStorage.getItem('clanWarChallenge.v1')??'{}').returnScreen==='worldMap'?'worldMap':'clan';}catch{return 'clan';}
}
export function prepareClanWarReturn():'clan'|'worldMap' {
    try{
        const value=JSON.parse(sessionStorage.getItem('clanWarChallenge.v1')??'{}') as {returnScreen?:string;shrineSector?:number;shrineWindowIndex?:number;warId?:string};
        if(value.returnScreen==='worldMap') {
            if(Number.isSafeInteger(value.shrineSector))setSectorReopen(value.shrineSector!);
            if(value.warId&&Number.isSafeInteger(value.shrineWindowIndex))sessionStorage.setItem('clan.shrineReopen',JSON.stringify({warId:value.warId,index:value.shrineWindowIndex}));
            return 'worldMap';
        }
        sessionStorage.setItem('clan.initialView','wars');
    }catch{/* Returning to the Clan Hall remains available. */}
    return 'clan';
}
