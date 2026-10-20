/** Small painted wildlife, authored against the actual floor rather than nav obstacles.
 * Positions are fractions of a sector; `size` is a 1024-pixel floor equivalent.
 * This module has no timers, network, React state, economy or pathfinding. */
export type GroundSpecies = 'blue-frog' | 'stone-turtle' | 'snow-rabbit' | 'pine-owl' | 'meadow-deer' | 'red-fox';
export interface GroundHabitat {
    species: GroundSpecies;
    pet: string;
    sector: number;
    x: number; y: number;
    coverX: number; coverY: number;
    size: number;
    /** Floor pixels per second along the short, visually reviewed escape leg. */
    speed: number;
    night: boolean;
    period: number;
    exposed: number;
}

export const GROUND_WILDLIFE_LIMITS = Object.freeze({
    active: 1,
    atlasWidth: 512,
    atlasHeight: 384,
    decodedBytes: 512 * 384 * 4,
    maxDecodedBytes: 1024 * 1024,
    maxCompressedBytes: 96 * 1024,
    frameSize: 64,
    framesPerAction: 4,
});

/** Only six individually inspected sites are admitted. Nothing scatters props or
 * animals across arbitrary collision cells, roads, buildings or dry fishing spots. */
export const GROUND_HABITATS: readonly GroundHabitat[] = [
    {species:'blue-frog',pet:'standard-8',sector:6,x:350/1024,y:257/1024,coverX:309/1024,coverY:237/1024,size:28,speed:90,night:false,period:240_000,exposed:105_000},
    {species:'stone-turtle',pet:'standard-5',sector:18,x:302/1024,y:728/1024,coverX:251/1024,coverY:699/1024,size:46,speed:18,night:false,period:240_000,exposed:105_000},
    {species:'snow-rabbit',pet:'standard-1',sector:27,x:560/1024,y:816/1024,coverX:595/1024,coverY:751/1024,size:35,speed:170,night:false,period:240_000,exposed:105_000},
    {species:'pine-owl',pet:'standard-10',sector:15,x:450/1024,y:243/1024,coverX:478/1024,coverY:278/1024,size:34,speed:120,night:true,period:240_000,exposed:105_000},
    {species:'meadow-deer',pet:'standard-16',sector:40,x:724/1024,y:218/1024,coverX:520/1024,coverY:304/1024,size:68,speed:130,night:false,period:240_000,exposed:105_000},
    {species:'red-fox',pet:'standard-0',sector:9,x:711/1024,y:879/1024,coverX:666/1024,coverY:843/1024,size:51,speed:145,night:false,period:360_000,exposed:45_000},
];

export interface GroundSighting { habitat: GroundHabitat; cycle: number; start: number; end: number }
export function groundSightingAt(sector:number,now:number,night:boolean):GroundSighting|undefined {
    const habitat=GROUND_HABITATS.find(h=>h.sector===sector&&h.night===night);
    if(!habitat||!Number.isFinite(now))return;
    const offset=habitat.sector*7919%habitat.period,cycle=Math.floor((now-offset)/habitat.period);
    const start=cycle*habitat.period+offset;
    return now<start+habitat.exposed?{habitat,cycle,start,end:start+habitat.exposed}:undefined;
}

export interface GroundAnimal {
    sighting: GroundSighting;
    x:number; y:number;
    age:number;
    escaping:boolean;
    progress:number;
    hidden:boolean;
}
export function createGroundAnimal(sighting:GroundSighting):GroundAnimal {
    return {sighting,x:sighting.habitat.x,y:sighting.habitat.y,age:0,escaping:false,progress:0,hidden:false};
}

/** Call once from the established wildlife frame. Hidden/combat/reduced-motion
 * callers simply do not advance it. Long pauses never fast-forward the animal. */
export function advanceGroundAnimal(animal:GroundAnimal,seconds:number,player?:{x:number;y:number}):void {
    if(animal.hidden)return;
    const dt=Math.max(0,Math.min(.05,Number.isFinite(seconds)?seconds:0));
    if(player&&!animal.escaping&&Math.hypot(player.x-animal.x,player.y-animal.y)<1.6/12){animal.escaping=true;animal.age=0;}
    animal.age+=dt;
    if(!animal.escaping)return;
    const habitat=animal.sighting.habitat,distance=Math.hypot(habitat.coverX-habitat.x,habitat.coverY-habitat.y);
    animal.progress=Math.min(1,animal.progress+dt*habitat.speed/1024/Math.max(distance,.001));
    animal.x=habitat.x+(habitat.coverX-habitat.x)*animal.progress;
    animal.y=habitat.y+(habitat.coverY-habitat.y)*animal.progress;
    animal.hidden=animal.progress===1;
}

export function groundAnimalFrame(animal:GroundAnimal,reducedMotion=false):number {
    if(reducedMotion)return 0;
    return animal.escaping?4+Math.floor(animal.age*8)%4:IDLE_FRAMES[Math.floor(animal.age*3)%8];
}
const IDLE_FRAMES=[0,0,0,1,2,1,0,0];

export function groundAnimalAlpha(animal:GroundAnimal,now:number):number {
    if(animal.hidden||now>=animal.sighting.end)return 0;
    const arrival=Math.min(1,Math.max(0,(now-animal.sighting.start)/1000));
    const departure=Math.min(1,Math.max(0,(animal.sighting.end-now)/1000));
    return arrival*departure*(animal.progress>.7?(1-animal.progress)/.3:1);
}

/** One live animal, plus at most six tiny visit records. Returning during the
 * same sighting does not resurrect an animal that already fled or reset its
 * pose. No simulation runs for another sector. */
export class GroundWildlifeSession {
    private visits=new Map<number,GroundAnimal>();
    private current?:GroundAnimal;
    at(sector:number,now:number,night:boolean):GroundAnimal|undefined {
        const sighting=groundSightingAt(sector,now,night);
        if(!sighting){this.current=undefined;return;}
        let animal=this.visits.get(sector);
        if(!animal||animal.sighting.cycle!==sighting.cycle){
            animal=createGroundAnimal(sighting);
            this.visits.set(sector,animal);
        }
        this.current=animal;
        return animal;
    }
    get active():GroundAnimal|undefined {return this.current;}
    get retainedSites():number {return this.visits.size;}
}
