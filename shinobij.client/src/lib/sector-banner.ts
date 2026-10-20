import { sectorFloorLayout } from './sector-floor-layout';
import { sectorBannerColor } from './sector-banner-state';
export { sectorBannerRevision,setSectorBannerOwners } from './sector-banner-state';
/** Authored cloth bounds in a 1024px floor, relative to its existing gatehouse.
 * No additional pole/flag geometry. Castle 99 has its own imperial heraldry. */
export function sectorBannerRegions(sector:number) {
    const layout=sectorFloorLayout(sector),site=layout?.sites.stronghold;
    if(!site||sector===99)return [];
    const boxes=layout.region==='ashenleaf'?[[6,98,33,38],[140,98,33,38]]
        :layout.artKey===22||layout.artKey===27?[[9,123,29,39],[134,123,29,39]]
        :layout.artKey===24?[[14,124,25,39],[133,124,25,39]]
        :layout.artKey===26?[[12,44,18,45],[147,44,18,45]]
        :layout.artKey===32?[[18,136,19,25],[137,136,19,25]]
        :[[10,49,23,44],[142,49,23,44]];
    return boxes.map(([x,y,w,h])=>[Math.round(site.footprint[0]*1024/12)+x,Math.round(site.footprint[1]*1024/12)+y,w,h]);
}
/** Re-dye existing blue/plum cloth once when a cached painting is made.
 * Keep its luminance (folds, dirt, shadows) and low-chroma embroidered crest.
 * Reads are tiny authored cloth rectangles, never the whole floor or each frame. */
export function tintSectorBanners(context:CanvasRenderingContext2D,sector:number,size:number) {
    const color=sectorBannerColor(sector),rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
    const crestLimit=sectorFloorLayout(sector)?.region==='ashenleaf'?255:95;
    const luminance=(r:number,g:number,b:number)=>r*.2126+g*.7152+b*.0722,target=luminance(...rgb as [number,number,number]);
    for(const box of sectorBannerRegions(sector)) {
        const [x,y,w,h]=box.map(n=>Math.round(n*size/1024)),pixels=context.getImageData(x,y,w,h);
        for(let i=0;i<pixels.data.length;i+=4) {
            const [r,g,b]=pixels.data.subarray(i,i+3),chroma=Math.max(r,g,b)-Math.min(r,g,b);
            const light=luminance(r,g,b);
            if(light>crestLimit||chroma<=8||b<g*1.02||r<g*1.04&&b<r*1.15)continue;
            const amount=Math.min(1,(chroma-8)/8);
            for(let c=0;c<3;c++)pixels.data[i+c]=pixels.data[i+c]*(1-amount)+light*(.35+.65*rgb[c]/target)*amount;
        }
        context.putImageData(pixels,x,y);
    }
}
