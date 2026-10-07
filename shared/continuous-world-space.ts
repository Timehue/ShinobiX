import { SECTOR_POINTS, SECTOR_ROAD_PAIRS, sectorExits, type SectorExit } from './sector-links';

export type WorldPoint = { x: number; y: number };
export type WorldChunk = WorldPoint & { sector: number; size: number };
export type WorldRoad = { a: SectorExit; b: SectorExit; points: WorldPoint[]; length: number };
export type ContinuousWorldSpace = { chunks: WorldChunk[]; roads: WorldRoad[] };
const SIZE = 12;
const SCALE = 4;
const DELTA = { north: [0,-1], east: [1,0], south: [0,1], west: [-1,0] } as const;
export const worldDistance = (a: WorldPoint,b: WorldPoint) => Math.hypot(a.x-b.x,a.y-b.y);

export function paintedTilePoint(chunk: WorldChunk,tile: number): WorldPoint {
    return { x: chunk.x + tile%SIZE + .5, y: chunk.y + Math.floor(tile/SIZE) + .5 };
}
export function lineLength(points: readonly WorldPoint[]) {
    return points.slice(1).reduce((sum,p,i)=>sum+worldDistance(points[i]!,p),0);
}
export function pointAlong(points: readonly WorldPoint[],distance: number): WorldPoint {
    let remaining=Math.max(0,distance);
    for(let i=1;i<points.length;i++){
        const a=points[i-1]!,b=points[i]!,length=worldDistance(a,b);
        if(remaining<=length){const t=length?remaining/length:0;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
        remaining-=length;
    }
    return {...points.at(-1)!};
}
function compact(points: WorldPoint[]) {
    const result:WorldPoint[]=[];
    for(const p of points){
        const a=result.at(-2),b=result.at(-1);
        if(b&&worldDistance(b,p)<1e-9)continue;
        if(a&&b&&((a.x===b.x&&b.x===p.x)||(a.y===b.y&&b.y===p.y)))result.pop();
        result.push(p);
    }
    return result;
}

/** Authoring-time route search. Chunks have fixed coordinates; cycles never rebase them. */
export function buildContinuousWorldSpace(): ContinuousWorldSpace {
    const chunks=SECTOR_POINTS.filter(p=>sectorExits(p.id).length).map(p=>({sector:p.id,x:Math.round(p.x*SCALE)-SIZE/2,y:Math.round(p.y*SCALE)-SIZE/2,size:SIZE}));
    const byId=new Map(chunks.map(chunk=>[chunk.sector,chunk]));
    const width=Math.ceil(Math.max(...chunks.map(c=>c.x+c.size)))+12;
    const height=Math.ceil(Math.max(...chunks.map(c=>c.y+c.size)))+12;
    const blocked=new Uint8Array(width*height),used=new Uint8Array(width*height);
    for(const c of chunks)for(let y=c.y;y<c.y+c.size;y++)for(let x=c.x;x<c.x+c.size;x++)blocked[y*width+x]=1;
    const route=(start:WorldPoint,end:WorldPoint)=>{
        const first=(Math.floor(start.y)*width+Math.floor(start.x))*4,last=Math.floor(end.y)*width+Math.floor(end.x);
        const costs=new Float64Array(width*height*4).fill(Infinity),parents=new Int32Array(width*height*4).fill(-1);
        const heap:Array<{id:number;cost:number;rank:number}>=[];
        const push=(entry:{id:number;cost:number;rank:number})=>{
            heap.push(entry);let i=heap.length-1;
            while(i){const parent=(i-1)>>1;if(heap[parent]!.rank<=entry.rank)break;heap[i]=heap[parent]!;i=parent;}heap[i]=entry;
        };
        const pop=()=>{
            const top=heap[0]!,tail=heap.pop()!;
            if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1]!.rank<heap[child]!.rank)child++;if(heap[child]!.rank>=tail.rank)break;heap[i]=heap[child]!;i=child;}heap[i]=tail;}
            return top;
        };
        const heuristic=(state:number)=>{const id=Math.floor(state/4);return Math.abs(id%width-last%width)+Math.abs(Math.floor(id/width)-Math.floor(last/width));};
        for(let d=0;d<4;d++){costs[first+d]=0;push({id:first+d,cost:0,rank:heuristic(first+d)});}
        let final=-1;
        while(heap.length){
            const node=pop();if(node.cost!==costs[node.id])continue;const cell=Math.floor(node.id/4);if(cell===last){final=node.id;break;}
            const x=cell%width,y=Math.floor(cell/width);
            for(const [direction,[dx,dy]] of Object.values(DELTA).entries()){
                const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=width||ny>=height)continue;
                const nextCell=ny*width+nx,id=nextCell*4+direction;if(blocked[nextCell])continue;
                const cost=node.cost+1+(used[nextCell]?5:0)+(node.id%4===direction?0:3);
                if(cost>=costs[id]!)continue;costs[id]=cost;parents[id]=node.id;push({id,cost,rank:cost+heuristic(id)});
            }
        }
        if(final<0)throw new Error(`No continuous corridor ${first} -> ${last}`);
        const points:WorldPoint[]=[];
        for(let id=final;id!==-1;id=parents[id]!){const cell=Math.floor(id/4);points.push({x:cell%width+.5,y:Math.floor(cell/width)+.5});used[cell]=1;}
        return compact(points.reverse());
    };
    const roads:WorldRoad[]=[];
    for(const [aId,bId] of SECTOR_ROAD_PAIRS){
        const a=sectorExits(aId).find(exit=>exit.destinationSector===bId)!,b=sectorExits(bId).find(exit=>exit.destinationSector===aId)!;
        const start=paintedTilePoint(byId.get(aId)!,a.tile),end=paintedTilePoint(byId.get(bId)!,b.tile);
        const da=DELTA[a.direction],db=DELTA[b.direction];
        const points=compact([start,...route({x:start.x+da[0],y:start.y+da[1]},{x:end.x+db[0],y:end.y+db[1]}),end]);
        roads.push({a,b,points,length:lineLength(points)});
    }
    return {chunks,roads};
}
