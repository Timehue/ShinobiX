/** The worker paints transitions at specific contact frames in the source clip. */
export type SectorGait = 'walk' | 'run';
export { sectorGaitTilesPerSecond, playerGaitPace, playerGaitTilesPerSecond } from './sector-gait-rates';
export type MotionClip = {
    period: number; count: number; speed?: number;
    source?: string; entryGait?: string; entry?: number;
    times?: number[]; travel?: number[]; target?: string; exitFrame?: number; correction?: number[];
};
type Bank = Record<string, MotionClip>;
type Contact = { name: string; time: number };
const contacts = new WeakMap<Bank, Map<string, Contact[]>>();

function exits(bank: Bank, source: string, target: string) {
    let byGait = contacts.get(bank);
    if (!byGait) {
        byGait = new Map();
        for (const [name,clip] of Object.entries(bank)) {
            const origin = clip.source ?? clip.entryGait;
            if (!origin || !clip.target || clip.entry === undefined) continue;
            const from = bank[origin];
            const time = from.times?.[clip.entry] ?? from.period * clip.entry / from.count;
            const key = origin + '/' + clip.target;
            const list = byGait.get(key) ?? [];
            list.push({name,time});
            byGait.set(key,list);
        }
        for (const list of byGait.values()) list.sort((a,b) => a.time-b.time);
        contacts.set(bank,byGait);
    }
    return byGait.get(source + '/' + target);
}

function sample(clip: MotionClip, time: number) {
    const times = clip.times, travel = clip.travel;
    if (!times || !travel) return {
        cell:Math.min(clip.count-1,Math.floor(time*clip.count/clip.period+1e-8)),
        distance:time * (clip.speed ?? 0),
    };
    let cell = 0;
    while (cell+1 < times.length && times[cell+1] <= time) cell++;
    const weight = cell+1 < times.length ? (time-times[cell])/(times[cell+1]-times[cell]) : 0;
    return {cell, distance:travel[cell]+weight*((travel[cell+1] ?? travel[cell])-travel[cell])};
}

const EPSILON = 1e-9;
const ease = (u: number) => u*u*(3-2*u);

/** Advance one tick. Ground travel and the painted pose come from the same clip clock.
 * The caller commits this result only after the route and artwork are available. */
export function advanceSectorStride(bank: Bank, state: {page: string; time: number}, desired: SectorGait | null, dt: number) {
    let {page,time} = state;
    let remaining = dt, travel = 0, cx = 0, cy = 0;
    while (remaining > EPSILON) {
        if (page === 'idle') {
            if (!desired) break;
            page = bank['start-'+desired] ? 'start-'+desired : desired;
            time = 0;
        }
        let clip = bank[page];
        const options = exits(bank,page,desired ?? 'idle');
        const stopping = clip.target === 'idle';
        if (!desired && !stopping && !options?.length) { page = 'idle'; time = 0; break; }
        if (desired && desired !== page && !clip.times && !options?.length) {
            time = time / clip.period * bank[desired].period;
            page = desired; clip = bank[page];
        }
        // A displayed pose spans its whole source-frame interval. Releasing a
        // fraction after a contact's timestamp can still use that visible pose;
        // waiting for the next contact would add an unnecessary partial stride.
        const cell = sample(clip,time).cell;
        const releaseTime = !desired ? clip.times?.[cell] ?? clip.period*cell/clip.count : time;
        const contact = options?.find(key => key.time >= releaseTime-EPSILON);
        const boundary = contact?.time ?? clip.period;
        const elapsed = Math.min(remaining,Math.max(0,boundary-time));
        const end = Math.min(clip.period,time+elapsed);
        travel += sample(clip,end).distance-sample(clip,time).distance;
        if (clip.correction) {
            const weight = ease(end/clip.period)-ease(time/clip.period);
            cx += clip.correction[0]*weight; cy += clip.correction[1]*weight;
        }
        time = end; remaining -= elapsed;
        if (time+EPSILON < boundary) break;
        if (contact) { page = contact.name; time = 0; }
        else if (stopping) { page = 'idle'; time = 0; break; }
        else if (clip.target) {
            page = clip.target;
            time = bank[page].period*(clip.exitFrame ?? 0)/bank[page].count;
        } else time = 0;
    }
    return {page,time,cell:sample(bank[page],time).cell,travel,cx,cy};
}

/** The time at which a commanded start joins its start clip.
 * A start clip eases in: the walk needs 0.7 s to reach walking speed and covers
 * under a pixel in its first third of a second. A player who has just chosen a
 * road should see the ground move at once, so the local actor skips that wind-up
 * and enters at the first frame that already travels at `share` of the gait's
 * speed. Later frames, the hand-off into the loop and every authored braking
 * contact after the entry are unchanged. Returns 0 when the clip has no ramp. */
export function sectorStartEntry(start: MotionClip | undefined, gaitSpeed: number | undefined, share = .5) {
    const times = start?.times, travel = start?.travel;
    if (!times || !travel || !gaitSpeed || gaitSpeed <= 0) return 0;
    for (let cell = 0; cell+1 < times.length && cell+1 < travel.length; cell++) {
        const span = times[cell+1]-times[cell];
        if (span > 0 && (travel[cell+1]-travel[cell])/span >= gaitSpeed*share) return times[cell];
    }
    return 0;
}

/** Fit the clip clock to the distance the navigation and network layers admit.
 * The fitted correction parallel to the road moves the cursor. The perpendicular
 * correction belongs to the figure's registration on that road. */
export function fitSectorStride(bank: Bank, state: {page:string;time:number}, desired: SectorGait | null,
    dt: number, allowance: number, dx: number, dy: number) {
    function at(elapsed: number) {
        const pose = advanceSectorStride(bank,state,desired,elapsed);
        const parallel = pose.cx*dx + pose.cy*dy;
        return {...pose, distance: Math.max(0,pose.travel+parallel),
            offsetX:pose.cx-dx*parallel, offsetY:pose.cy-dy*parallel};
    }
    const full = at(dt);
    if (full.distance <= allowance) return full;
    let lo = 0, hi = dt;
    for (let i=0; i<20; i++) {
        const mid = (lo+hi)/2;
        if (at(mid).distance <= allowance) lo=mid;
        else hi=mid;
    }
    return {...at(lo), distance:allowance};
}

export type GroundStride = (direction:{dx:number;dy:number} | null, desire: SectorGait | null,
    seconds:number, allowance:number, afterBrake?:{dx:number;dy:number}) =>
    /** `gait` is the gait of the clip now on screen (a run still braking into a walk reports run). */
    {distance:number;idle:boolean;gait?:SectorGait} | undefined;

/** The gait a clip belongs to: the loop itself, or the loop a start/stop/change clip leaves. */
export function sectorClipGait(bank: Record<string, MotionClip>, page: string): SectorGait | undefined {
    if (page === 'walk' || page === 'run') return page;
    const from = bank[page]?.source ?? bank[page]?.entryGait;
    if (from === 'walk' || from === 'run') return from;
    const start = page.startsWith('start-') ? page.slice(6) : '';
    return start === 'walk' || start === 'run' ? start : undefined;
}
