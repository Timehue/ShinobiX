/** Hold one required pose page until the actor no longer needs its transition. */
export function createPosePrerequisite<T extends {release:()=>void}>() {
    let key='', generation=0, closed=false, loaded=false, missed=false, resource:T|undefined;
    function clear() {
        generation++; key=''; loaded=false; missed=false;
        resource?.release(); resource=undefined;
    }
    return {
        ready(next:string,load:()=>Promise<T>,failed?:()=>void) {
            if(closed) return false;
            if(key===next && (!missed || !failed)) return loaded;
            clear(); key=next;
            const request=generation;
            void load().then(value=>{
                if(closed || request!==generation) value.release();
                else {resource=value;loaded=true;}
            },()=>{
                if(closed || request!==generation) return;
                if(failed) {clear();failed();}
                else missed=true;
            });
            return false;
        },
        clear,
        dispose() {closed=true;clear();},
    };
}
