/**
 * Hold one required pose page until the actor no longer needs its transition.
 *
 * Without a `failed` callback a load that fails is a miss: prefetch asks keep
 * getting false for that page, but only for `retryMs`. They used to get false
 * for good, so one dropped turn page sent that heading to the portrait every
 * time the actor turned toward it, until the actor next stood idle.
 */
export function createPosePrerequisite<T extends {release:()=>void}>(retryMs = 2_000, now: () => number = () => performance.now()) {
    let key='', generation=0, closed=false, loaded=false, missedAt=-1, resource:T|undefined;
    function clear() {
        generation++; key=''; loaded=false; missedAt=-1;
        resource?.release(); resource=undefined;
    }
    return {
        ready(next:string,load:()=>Promise<T>,failed?:()=>void) {
            if(closed) return false;
            // A required ask (one that passes `failed`) retries a miss at once.
            if(key===next && (missedAt<0 || (!failed && now()-missedAt<retryMs))) return loaded;
            clear(); key=next;
            const request=generation;
            void load().then(value=>{
                if(closed || request!==generation) value.release();
                else {resource=value;loaded=true;}
            },()=>{
                if(closed || request!==generation) return;
                if(failed) {clear();failed();}
                else missedAt=now();
            });
            return false;
        },
        clear,
        dispose() {closed=true;clear();},
    };
}
