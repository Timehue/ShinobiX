import type { Character } from '../types/character';
import type { Pet } from '../types/pet';
import type { WorldNode } from '../../../shared/continuous-world-navigation';
import type { WorldPosition } from '../../../shared/world-position';
import { worldDistance, type WorldPoint } from '../../../shared/continuous-world-space';
import { peerWorldPath, advancePeerPath } from './world-peer-motion';

export const WORLD_COMPANION_LIMITS=Object.freeze({active:1,points:64,marks:12,speed:8,leash:1.25,pause:2,nearbyNodes:96,waitingRetryMs:250});
const copyPoint=(p:WorldPoint):WorldPoint=>({x:p.x,y:p.y});
type Owner=Pick<Character,'pets'|'activePetId'|'petBreeding'>;
/** Current owned selection only. A walking pet is cosmetic, so combat's level
 * 50 summon seal remains a separate rule. An uncollected expedition is away. */
export function worldCompanionPet(owner:Owner|undefined,now:number):Pet|undefined{
    const pet=owner?.pets?.find(p=>p.id===owner.activePetId);
    if(!pet||pet.expedition)return;
    const breeding=owner?.petBreeding;
    if(breeding?.state==='breeding'&&now<breeding.readyAt&&breeding.parentIds.includes(pet.id))return;
    return pet;
}
export type CompanionMark={tile:number;direction?:number;worked?:boolean;until:number;seed:number};
export type WorldCompanionFrame={now:number;seconds:number;cursor:WorldPosition;player:WorldPoint;sector:number;
    nodes:ReadonlyMap<string,WorldNode>;chunk:{x:number;y:number};tilePx:number;paused:boolean;occupied?:readonly WorldPoint[]};
export type WorldCompanionChannel={current:((frame:WorldCompanionFrame)=>void)|null};

/** One owner's bounded breadcrumb trail through the existing connected graph.
 * No timers, requests, game-state writes, arbitrary terrain sampling or RAF. */
export class WorldCompanionMotion{
    private points:WorldPoint[]=[];
    private last?:WorldPosition;
    private owner?:WorldPoint;
    private sector=-1;
    private seen=new Set<string>();
    private pause=0;
    private clue?:{key:string;point:WorldPoint};
    private fadedUntil=0;
    private facing=1;
    private marks?:readonly CompanionMark[];
    private clues:{key:string;point:WorldPoint}[]=[];
    private clueExpiry=Infinity;
    private parkedAt?:WorldPoint;
    private nextPark=0;
    get queued(){return this.points.length;}
    get remembered(){return this.seen.size;}
    get position(){return this.points[0];}
    private reset(frame:WorldCompanionFrame){
        const node=frame.nodes.get(frame.cursor.from)!;
        // Stand on a connected neighbor, never spawn on furniture or in water.
        const behind=node.neighbors.map(id=>frame.nodes.get(id)!).find(p=>p.id!==frame.cursor.to&&p.sector===node.sector);
        this.points=[...(behind?[{x:behind.x,y:behind.y}]:[]),{x:node.x,y:node.y}];
        // Keep a separate moving endpoint even at progress zero. Replacing the
        // corner itself on the next frame would cut diagonally across terrain.
        this.points.push(copyPoint(frame.player));
        this.last={...frame.cursor};this.owner=copyPoint(frame.player);this.pause=0;this.clue=undefined;this.parkedAt=undefined;this.fadedUntil=frame.now+300;
    }
    private localNodes(frame:WorldCompanionFrame){
        const queue=[...new Set([frame.cursor.from,frame.cursor.to])],seen=new Set(queue),found:WorldNode[]=[];
        for(let i=0;i<queue.length&&found.length<WORLD_COMPANION_LIMITS.nearbyNodes;i++){
            const node=frame.nodes.get(queue[i])!;found.push(node);
            if(worldDistance(node,frame.player)>4)continue;
            for(const id of node.neighbors)if(!seen.has(id)&&seen.size<WORLD_COMPANION_LIMITS.nearbyNodes){seen.add(id);queue.push(id);}
        }
        return found;
    }
    private cursorAt(frame:WorldCompanionFrame,local:readonly WorldNode[]):WorldPosition|undefined{
        const p=this.points[0]!;
        for(const node of local){
            if(worldDistance(node,p)<.00001)return {layoutVersion:frame.cursor.layoutVersion,from:node.id,to:node.id,progress:0};
            for(const id of node.neighbors){const b=frame.nodes.get(id)!,dx=b.x-node.x,dy=b.y-node.y,len=dx*dx+dy*dy;if(!len)continue;
                const t=((p.x-node.x)*dx+(p.y-node.y)*dy)/len;
                if(t>=0&&t<=1&&Math.hypot(node.x+dx*t-p.x,node.y+dy*t-p.y)<.00001)return {layoutVersion:frame.cursor.layoutVersion,from:node.id,to:b.id,progress:t};
            }
        }
    }
    private park(frame:WorldCompanionFrame){
        const local=this.localNodes(frame),cursor=this.cursorAt(frame,local);if(!cursor)return;
        const ids=new Set(local.map(node=>node.id));
        const localGraph=new Map(local.map(node=>[node.id,{...node,neighbors:node.neighbors.filter(id=>ids.has(id))}]));
        const free=local.filter(node=>worldDistance(node,frame.player)>=.85&&worldDistance(node,frame.player)<=2.5
            &&!(frame.occupied??[]).some(p=>worldDistance(p,node)<.85))
            .sort((a,b)=>Math.abs(worldDistance(a,frame.player)-1.25)+worldDistance(a,this.points[0]!)*.1-Math.abs(worldDistance(b,frame.player)-1.25)-worldDistance(b,this.points[0]!)*.1);
        for(const node of free.slice(0,4)){
            const path=peerWorldPath(localGraph,cursor,{...frame.cursor,from:node.id,to:node.id,progress:0});
            if(!path||path.length>12)continue;
            this.points=path.map(copyPoint);this.parkedAt=copyPoint(frame.player);this.pause=0;
            if(this.clue)this.seen.delete(this.clue.key);this.clue=undefined;return;
        }
    }
    step(frame:WorldCompanionFrame,marks:readonly CompanionMark[],wallNow:number){
        if(frame.paused)return {...this.snapshot(false,false,frame.now),visible:false};
        if(!frame.nodes.has(frame.cursor.from)||!frame.nodes.has(frame.cursor.to))return this.snapshot(false,false,frame.now);
        if(this.sector!==frame.sector){this.sector=frame.sector;this.seen.clear();this.pause=0;this.clue=undefined;this.marks=undefined;}
        if(!this.last||this.last.layoutVersion!==frame.cursor.layoutVersion||this.owner&&worldDistance(this.owner,frame.player)>4)this.reset(frame);
        else if(this.parkedAt&&worldDistance(this.parkedAt,frame.player)>.6){
            const cursor=this.cursorAt(frame,this.localNodes(frame)),path=cursor&&peerWorldPath(frame.nodes,cursor,frame.cursor);
            if(path&&path.length<=WORLD_COMPANION_LIMITS.points){this.points=path.map(copyPoint);this.parkedAt=undefined;this.last={...frame.cursor};this.owner=copyPoint(frame.player);}
            else this.reset(frame);
        }
        else if(!this.parkedAt&&this.owner&&worldDistance(this.owner,frame.player)>.0001){
            if(this.last.from===frame.cursor.from&&this.last.to===frame.cursor.to){
                if(this.points.length>1)this.points[this.points.length-1]=copyPoint(frame.player);else this.points.push(copyPoint(frame.player));
            }else{
                const path=peerWorldPath(frame.nodes,this.last,frame.cursor);
                if(!path||path.length+this.points.length>WORLD_COMPANION_LIMITS.points)this.reset(frame);
                else {
                    for(const point of path.slice(1,-1))if(worldDistance(this.points.at(-1)!,point)>.0001)this.points.push({x:point.x,y:point.y});
                    this.points.push(copyPoint(frame.player));
                }
            }
            this.last={...frame.cursor};this.owner=copyPoint(frame.player);
        }
        if(!this.points.length)return this.snapshot(false,false,frame.now);
        if(frame.now>=this.nextPark&&worldDistance(this.points[0]!,frame.player)<3&&(frame.occupied??[]).some(p=>worldDistance(p,this.points[0]!)<.8)){
            this.nextPark=frame.now+WORLD_COMPANION_LIMITS.waitingRetryMs;this.park(frame);
        }
        const dt=Math.max(0,Math.min(.05,frame.seconds));
        if(this.marks!==marks||wallNow>=this.clueExpiry){
            this.marks=marks;this.clueExpiry=Infinity;
            this.clues=marks.slice(0,WORLD_COMPANION_LIMITS.marks).filter(mark=>Number.isInteger(mark.tile)&&mark.tile>=0&&mark.tile<144
            &&Number.isFinite(mark.direction)&&!mark.worked&&mark.until>wallNow).map(mark=>{
                this.clueExpiry=Math.min(this.clueExpiry,mark.until);return {
                key:`${mark.tile}:${mark.seed}`,point:{x:frame.chunk.x+mark.tile%12+.5,y:frame.chunk.y+Math.floor(mark.tile/12)+.5},
            };});
            for(const key of this.seen)if(!this.clues.some(clue=>clue.key===key))this.seen.delete(key);
        }
        const clues=this.clues;
        const length=this.points.slice(1).reduce((sum,p,i)=>sum+worldDistance(this.points[i]!,p),0);
        if(this.pause>0&&(!this.clue||!clues.some(clue=>clue.key===this.clue!.key)||length>3.5))this.pause=0;
        if(this.pause<=0&&length<=3.5&&(!this.parkedAt||length<.01)){
            const clue=clues.find(mark=>!this.seen.has(mark.key)&&worldDistance(this.points[0]!,mark.point)<=1.5&&worldDistance(frame.player,mark.point)<=2.5);
            if(clue){this.seen.add(clue.key);this.clue=clue;this.pause=WORLD_COMPANION_LIMITS.pause;}
        }
        if(this.pause>0){
            this.pause=Math.max(0,this.pause-dt);
            if(this.clue&&Math.abs(this.clue.point.x-this.points[0]!.x)>.02)this.facing=this.clue.point.x<this.points[0]!.x?-1:1;
            return this.snapshot(this.pause>0,false,frame.now);
        }
        const before=this.points[0]!,budget=Math.min(Math.max(0,length-(this.parkedAt?0:WORLD_COMPANION_LIMITS.leash)),dt*WORLD_COMPANION_LIMITS.speed);
        const point=advancePeerPath(this.points,budget)!;
        if(Math.abs(point.x-before.x)>.001)this.facing=point.x<before.x?-1:1;
        return this.snapshot(false,worldDistance(before,point)>.001,frame.now);
    }
    private snapshot(noticing:boolean,moving:boolean,now:number){return {point:this.points[0],noticing,moving,facing:this.facing,visible:!!this.points.length&&now>=this.fadedUntil};}
}
