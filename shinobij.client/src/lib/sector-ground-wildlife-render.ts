import {GROUND_WILDLIFE_LIMITS,groundAnimalAlpha,groundAnimalFrame,type GroundAnimal,type GroundSpecies} from './sector-ground-wildlife';

/** One small decoded atlas shared by visits; never decode a full pet portrait or
 * GLB for ambience. Final atlas receipt pins every row and the decoded budget. */
let decoded:HTMLImageElement|undefined,pending:Promise<HTMLImageElement|undefined>|undefined;
const ART_ROWS:Record<GroundSpecies,{row:number;idleExtent:number}>={
    'blue-frog':{row:0,idleExtent:45},
    'stone-turtle':{row:1,idleExtent:62},
    'snow-rabbit':{row:2,idleExtent:53},
    'pine-owl':{row:3,idleExtent:40},
    'meadow-deer':{row:4,idleExtent:60},
    'red-fox':{row:5,idleExtent:62},
};
export {ART_ROWS as GROUND_WILDLIFE_ART_ROWS};
export const GROUND_WILDLIFE_ATLAS_URL='/sector-life/wildlife/ground-fauna-v1.webp?v=78e24cba0213';
export function loadGroundWildlifeAtlas():Promise<HTMLImageElement|undefined>{
    if(decoded)return Promise.resolve(decoded);
    if(pending)return pending;
    pending=new Promise(resolve=>{
        const image=new Image();image.decoding='async';
        image.onerror=()=>resolve(undefined);
        image.onload=()=>{
            if(image.naturalWidth!==GROUND_WILDLIFE_LIMITS.atlasWidth||image.naturalHeight!==GROUND_WILDLIFE_LIMITS.atlasHeight){resolve(undefined);return;}
            void image.decode().then(()=>{
                decoded=image;resolve(image);
            },()=>resolve(undefined));
        };
        image.src=GROUND_WILDLIFE_ATLAS_URL;
    });
    return pending;
}

export function drawGroundWildlife(ctx:CanvasRenderingContext2D,image:HTMLImageElement,animal:GroundAnimal,now:number,width:number,height:number,reducedMotion=false):void{
    const alpha=groundAnimalAlpha(animal,now);if(alpha===0)return;
    const habitat=animal.sighting.habitat,art=ART_ROWS[habitat.species];
    const size=habitat.size/1024*width*64/art.idleExtent;
    const x=animal.x*width,y=animal.y*height;
    const hopping=animal.escaping&&(habitat.species==='blue-frog'||habitat.species==='snow-rabbit');
    const lift=hopping?Math.abs(Math.sin(animal.progress*Math.PI))*size*.12:0;
    ctx.save();ctx.globalAlpha=alpha;
    if(habitat.species!=='pine-owl'){
        ctx.fillStyle='rgba(23,27,16,.16)';ctx.beginPath();ctx.ellipse(x,y-size*.04,size*.22,size*.055,0,0,Math.PI*2);ctx.fill();
    }
    const frame=groundAnimalFrame(animal,reducedMotion);
    ctx.drawImage(image,frame*64,art.row*64,64,64,x-size/2,y-size-lift,size,size);
    ctx.restore();
}
