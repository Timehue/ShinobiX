/** Keeper, then two visitor stops, authored against the full painted floors.
 * Keep the shrine lamps visible and leave room between portrait/name stacks.
 * Heartwood retains its established lamp-tending interaction positions. */
export const SHRINE_STANDING_SPOTS:Readonly<Record<number,readonly[number,number,number]>>={
    4:[58,67,82],31:[97,121,124],23:[97,122,125],56:[13,38,42],44:[114,137,140],
};
export const shrineStandingSpots=(sector:number):readonly number[]=>SHRINE_STANDING_SPOTS[sector]??[];
/** Name stacks need horizontal space too. Other resting routines wait beyond
 * the ceremony group; walking across its public approach remains allowed. */
export const clearOfShrinePosts=(sector:number,tile:number)=>shrineStandingSpots(sector).every(post=>Math.abs(tile%12-post%12)>=3||Math.abs(Math.floor(tile/12)-Math.floor(post/12))>=2);
