/** The established native figure tick moves one attached work tool. The
 * transparent clearance covers its whole stroke, so name packing stays stable
 * while the brush swings. Nothing here schedules or simulates another frame. */
export function paintGroundWorkTool(node:SVGSVGElement|null,active:boolean,x:number,y:number,now:number,reduced:boolean) {
    if(!node)return;
    const visibility=active?'visible':'hidden';
    if(node.style.visibility!==visibility)node.style.visibility=visibility;
    if(!active)return;
    const angle=reduced?-20:-20+14*Math.sin(now/650);
    const group=node.firstElementChild!,clearance=node.lastElementChild!;
    group.setAttribute('transform',`translate(${x+9} ${y-24}) rotate(${angle})`);
    const position=`translate(${x} ${y})`;
    if(clearance.getAttribute('transform')!==position)clearance.setAttribute('transform',position);
}
