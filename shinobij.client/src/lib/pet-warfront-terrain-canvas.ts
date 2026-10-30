import { warfrontTerrainPoint, type WARFRONT_TERRAIN } from "./pet-warfront-contract";
import { GARDEN_MASKS, WARFRONT_GARDEN_ART, gardenImageFrame } from "./pet-warfront-garden";
import mist from "../assets/fx/mist/018.png";

export const WARFRONT_TERRAIN_ART = { ...WARFRONT_GARDEN_ART, mist };
/** Repaint only the solid silhouette at its ground-depth turn. Canvas gets the
 * same occlusion as the GPU without differently lit prop sprites. */
export function drawWarfrontTerrain(context: CanvasRenderingContext2D, cell: typeof WARFRONT_TERRAIN[number], image: HTMLImageElement,
    project: (x: number, z: number) => readonly [number, number], width: number, height: number) {
    context.save();
    if (cell.kind === "mist") {
        const [worldX,worldZ]=warfrontTerrainPoint(cell.col,cell.row);
        const [x,y]=project(worldX,worldZ),[right,bottom]=project(worldX+1.3,worldZ+1.2);
        context.globalAlpha=.12;
        context.drawImage(image,2*x-right,2*y-bottom,(right-x)*2,(bottom-y)*2);
    } else {
        const frame=gardenImageFrame(width,height);
        context.beginPath();
        for(const polygon of GARDEN_MASKS[frame.portrait ? "portrait" : "landscape"][`${cell.col}:${cell.row}`] ?? []) {
            polygon.forEach(([x,y],index)=>{
                const px=frame.x+x/frame.sourceWidth*frame.width,py=frame.y+y/frame.sourceHeight*frame.height;
                if(index===0) context.moveTo(px,py); else context.lineTo(px,py);
            });
            context.closePath();
        }
        context.clip();
        context.drawImage(image,frame.x,frame.y,frame.width,frame.height);
    }
    context.restore();
}
