type Point={col:number;row:number};
/** The task still targets its actual ground cell. Only an overlapping button
 * moves, with a visible tether, leaving both the person and work accessible. */
export function lifeWorkMarker(tile:number,point:Point,actors:readonly Point[]=[]){
    const target={col:tile%12,row:Math.floor(tile/12)},x=target.col-point.col,y=target.row-point.row,scale=Math.max(1,Math.abs(x)/4.5,Math.abs(y)/4.5);
    let anchor={col:point.col+x/scale,row:point.row+y/scale},tether:undefined|{x1:number;y1:number;x2:number;y2:number};
    const distance=(a:Point,b:Point)=>Math.hypot(a.col-b.col,a.row-b.row);
    const hits=(actor:Point,p:Point)=>Math.abs(actor.col-p.col)<.98&&p.row>actor.row-1.75&&p.row<actor.row+.65;
    if(scale===1&&actors.some(actor=>hits(actor,target))){
        const options=[[1.1,0],[-1.1,0],[0,-1.1],[0,1.1],[1.1,-1.1],[-1.1,-1.1],[1.1,1.1],[-1.1,1.1],[2.2,0],[-2.2,0],[0,-2.2],[0,2.2]].map(([dx,dy])=>({col:target.col+dx,row:target.row+dy})).filter(p=>p.col>=0&&p.col<=11&&p.row>=0&&p.row<=11);
        const occupied=[...actors,point],clearance=(p:Point)=>Math.min(...occupied.map(actor=>distance(p,actor)));
        anchor=options.find(p=>occupied.every(actor=>!hits(actor,p)))??options.sort((a,b)=>clearance(b)-clearance(a))[0]??anchor;
        tether={x1:(target.col+.5)/12*100,y1:(target.row+.5)/12*100,x2:(anchor.col+.5)/12*100,y2:(anchor.row+.5)/12*100};
    }
    return{style:{left:`${(anchor.col+.5)/12*100}%`,top:`${(anchor.row+.5)/12*100}%`},offscreen:scale>1,angle:Math.atan2(y,x),tether};
}
