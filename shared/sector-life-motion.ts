export type LifeMotion = { start: number; frames: readonly (readonly [number, number])[]; repeat?: number;ending?:{at:number;frames:readonly(readonly[number,number])[]} };
export type LifePhase={at:number;activity:string;line:string;returnGreeting?:string;working?:true;surfacePaintings?:readonly string[];workTile?:number;workArea?:{col:number;row:number;columns:number;rows:number};approach?:{activity:string;line:string}};
export type LifeEventPhase={at:number;description:string;waiting?:boolean;action?:string;task?:string;tile?:number;phase?:'active'|'aftermath'|'unattended'};
export function lifeEventPresentationAt<T extends {eventPhases?:readonly LifeEventPhase[]}>(view:T,now:number):T{
 let current=view;
 for(const {at,...phase} of view.eventPhases??[])if(at<=now)current={...current,...phase};
 return current;
}
type LifePresentation={activity:string;line:string;phases?:readonly LifePhase[];cyclePhases?:readonly LifePhase[];motion?:LifeMotion};
export function lifeActivityAt<T extends LifePresentation>(actor:T,now:number) {
    for(let i=(actor.phases?.length??0)-1;i>=0;i--)if(actor.phases![i].at<=now)return actor.phases![i];
    if(actor.cyclePhases&&actor.motion?.repeat&&now>=actor.motion.start){
        const phase=(now-actor.motion.start)%actor.motion.repeat;
        for(let i=actor.cyclePhases.length-1;i>=0;i--)if(actor.cyclePhases[i].at<=phase)return actor.cyclePhases[i];
    }
    return actor;
}
/** A late join or resumed tab can still be walking toward the scheduled work.
 * Pose-dependent work descriptions become true only at the actual work point. */
export function lifeActivityAtPosition<T extends LifePresentation>(actor:T,p:{col:number;row:number},now:number){
    const phase=lifeActivityAt(actor,now),work=phase as LifePhase;
    if(!work.approach)return phase;
    if(work.workTile!==undefined&&Math.hypot(p.col-work.workTile%12,p.row-Math.floor(work.workTile/12))>.18)return work.approach;
    const area=work.workArea;
    if(area&&Math.hypot(p.col-Math.max(area.col,Math.min(area.col+area.columns-1,p.col)),p.row-Math.max(area.row,Math.min(area.row+area.rows-1,p.row)))>.18)return work.approach;
    return phase;
}

/** Follow server-authored ground paths; pauses are repeated tiles in the timeline. */
export function lifeActorPosition(_sector: number, actor: { restTile: number; motion?: LifeMotion }, now: number) {
    const motion=actor.motion;
    let tile=actor.restTile,col=tile%12,row=Math.floor(tile/12),walking=false;
    if(motion?.frames.length) {
        const ending=motion.ending&&now>=motion.ending.at?motion.ending:undefined,frames=ending?.frames??motion.frames,start=ending?.at??motion.start;
        const elapsed=Math.max(0,now-start),time=!ending&&motion.repeat?elapsed%motion.repeat:elapsed;
        const next=frames.findIndex(frame=>frame[0]>time);
        const a=frames[next<0?frames.length-1:Math.max(0,next-1)];
        const b=frames[next<0?frames.length-1:next];
        const fraction=b[0]>a[0]?Math.max(0,(time-a[0])/(b[0]-a[0])):0;
        tile=a[1];col=tile%12+(b[1]%12-tile%12)*fraction;
        row=Math.floor(tile/12)+(Math.floor(b[1]/12)-Math.floor(tile/12))*fraction;
        walking=now>=start&&a[1]!==b[1];
    }
    return {col,row,walking};
}
