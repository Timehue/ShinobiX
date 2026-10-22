/** Coordinates reviewed against the actual Moonwell lamp paintings. The first
 * two lamps burn in both supported and radiant states. No generic roof lights. */
export const MOONWELL_MOTH_LAMPS=[{x:208/1024,y:770/1024},{x:314/1024,y:770/1024}] as const;
export const LOCAL_FAUNA_LIMITS=Object.freeze({gulls:2,lampMoths:2,mothRadius:23/1024,gullNotice:2.4/12});
export const HARBOR_GULL_ROUTE=[96,97,109,121,120,108] as const;
export function moonwellLampsLit(sector:number|undefined,night:boolean,displayedSource:string|undefined){
    return sector===23&&night&&/\/moonwell-(supported|radiant)-shrine-v1\.webp(?:\?.*)?$/.test(displayedSource??'');
}
/** Pure bounded orbits, in floor fractions, rather than a random swarm drifting
 * across the scene. Reduced motion draws these same locations without a loop. */
export function lampMothPoint(index:number,phase:number){
    const lamp=MOONWELL_MOTH_LAMPS[index%MOONWELL_MOTH_LAMPS.length],r=LOCAL_FAUNA_LIMITS.mothRadius;
    return {x:lamp.x+Math.cos(phase*.9+index*2)*r,y:lamp.y+Math.sin(phase*1.3+index)*r*.65};
}
/** A gull circles connected authored harbor-water tiles. Its shadow stays over
 * water even when it veers from the nearby player. No new ground collision. */
export function harborGullPoint(index:number,phase:number,bias:{x:number;y:number}){
    const t=((phase/3+index*3)%HARBOR_GULL_ROUTE.length+HARBOR_GULL_ROUTE.length)%HARBOR_GULL_ROUTE.length;
    const i=Math.floor(t),a=HARBOR_GULL_ROUTE[i],b=HARBOR_GULL_ROUTE[(i+1)%HARBOR_GULL_ROUTE.length],f=t-i;
    return {x:(a%12+(b%12-a%12)*f+.5)/12+Math.max(-.009,Math.min(.009,bias.x)),
        y:(Math.floor(a/12)+(Math.floor(b/12)-Math.floor(a/12))*f+.5)/12+Math.max(-.009,Math.min(.009,bias.y))};
}
