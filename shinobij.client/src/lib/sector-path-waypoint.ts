import { nearestInMask, sectorWalkMask, pathInMask,walkableInMask, type WalkMask } from "../../../shared/sector-walk-mask";
import { sectorObstaclesOn } from "./sector-obstacles";
import type { loadContinuousWorld } from "./continuous-world-client";
type Position = { col: number; row: number };
type Region = { points: Position[]; links: number[][] };
type World = Awaited<ReturnType<typeof loadContinuousWorld>>;

let world: World | undefined, loading = false;
const regions = new Map<number, Region | null>();
const emptyClearance:readonly number[]=[];
/** One sector's walkable ground in the connected world (its painting, its road
 *  halves and its open land), in that sector's tile coordinates. Null until the
 *  world graph has loaded; the caller keeps to the painted board meanwhile. */
function sectorRegion(sector: number): Region | null {
    if (!world) {
        if (!loading) {
            loading = true;
            void import("./continuous-world-client").then(client => client.loadContinuousWorld())
                .then(value => { world = value; }, () => { loading = false; });
        }
        return null;
    }
    if (!regions.has(sector)) {
        const chunk = world.space.chunks.find(c => c.sector === sector);
        const own = chunk ? world.navigation.nodes.filter(n => n.sector === sector) : [];
        const index = new Map(own.map((n, i) => [n.id, i]));
        regions.set(sector, own.length ? {
            points: own.map(n => ({ col: n.x - chunk!.x - .5, row: n.y - chunk!.y - .5 })),
            links: own.map(n => n.neighbors.flatMap(id => index.has(id) ? [index.get(id)!] : [])),
        } : null);
    }
    return regions.get(sector)!;
}
const nearestPoint = (region: Region, p: Position) => region.points.reduce((best, q, i) =>
    (q.col - p.col) ** 2 + (q.row - p.row) ** 2 < (region.points[best]!.col - p.col) ** 2 + (region.points[best]!.row - p.row) ** 2 ? i : best, 0);
function regionPath(region: Region, from: number, to: number): number[] {
    const parent = new Map<number, number>([[from, from]]), queue = [from];
    for (let i = 0; i < queue.length && !parent.has(to); i++) for (const next of region.links[queue[i]!]!) {
        if (!parent.has(next)) { parent.set(next, queue[i]!); queue.push(next); }
    }
    if (!parent.has(to)) return [from];
    const path = [to];
    while (path[0] !== from) path.unshift(parent.get(path[0]!)!);
    return path;
}

/** Keep a partial cardinal leg intact when a moving destination changes.
 *  `world` lets an actor in the connected world use its sector's open land too. */
export function createSectorNavigator(world = false, clearance?:()=>readonly number[]|undefined) {
    let route: number[] = [], destination = "", board = "";
    let maskKey='',customMask:WalkMask|undefined;
    let initialLeg:boolean|undefined;
    return (sector: number, position: Position, target: Position): Position => {
        const blocked=clearance?.()??emptyClearance,keyed=`${sector}:${blocked.join(',')}`;
        if(blocked.length&&maskKey!==keyed){customMask=sectorWalkMask(sector)?.map((row,y)=>[...row].map((cell,x)=>blocked.includes(y*12+x)?'#':cell).join(''));maskKey=keyed;}
        const mask=blocked.length?customMask:sectorWalkMask(sector,sectorObstaclesOn());
        const region = world&&!blocked.length ? sectorRegion(sector) : null;
        if (!region && !mask) { route = []; destination = ""; return target; }
        // A newly mounted routine can already be between two cells. Continue
        // that clear cardinal leg instead of rounding it back to its origin.
        initialLeg??=!Number.isInteger(position.col)||!Number.isInteger(position.row);
        if(initialLeg){
            const cardinal=Math.abs(position.col-target.col)<.000001||Math.abs(position.row-target.row)<.000001;
            const clear=[position,target].every(p=>[Math.floor(p.col),Math.ceil(p.col)].every(x=>[Math.floor(p.row),Math.ceil(p.row)].every(y=>x>=0&&x<12&&y>=0&&y<12&&walkableInMask(mask,y*12+x))));
            if(cardinal&&clear&&Math.hypot(position.col-target.col,position.row-target.row)<.5)return target;
            initialLeg=false;
        }
        const point = (step: number): Position => region ? region.points[step]! : { col: step % 12, row: Math.floor(step / 12) };
        const nearest = (p: Position) => region ? nearestPoint(region, p)
            : nearestInMask(mask, Math.round(p.row) * 12 + Math.round(p.col));
        const key = `${region ? "w" : "m"}${keyed}`, to = nearest(target);
        const away = (step: number) => Math.hypot(point(step).col - position.col, point(step).row - position.row);
        if (destination !== `${key}:${to}` || !route.length) {
            // Mid-step, plan onward from the tile being entered. Planning from the
            // nearest tile could turn a chaser back each time its target moved.
            const from = board === key && route.length && away(route[0]!) > .02 ? route[0]! : nearest(position);
            route = region ? regionPath(region, from, to) : pathInMask(mask, from, to) ?? [from];
            destination = `${key}:${to}`; board = key;
        }
        while (route.length > 1 && away(route[0]!) < .02) route.shift();
        return point(route[0]!);
    };
}
