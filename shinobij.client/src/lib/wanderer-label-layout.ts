type Rect={x:number;y:number;width:number;height:number};
type Shift={x:number;y:number};
const gap=4;
const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;

/** Keep a valid placement through motion; prefer a small horizontal nudge to
 * moving a name several rows away from its owner. Never change the hit target. */
export function placeWandererLabel(rect:Rect,bounds:Rect,occupied:readonly Rect[],previous:Shift,owner?:Rect):Shift {
    const clamp=(x:number,y:number)=>({x:Math.max(bounds.x,Math.min(bounds.x+bounds.width-rect.width,rect.x+x))-rect.x,
        y:Math.max(bounds.y,Math.min(bounds.y+bounds.height-rect.height,rect.y+y))-rect.y});
    const ownerGap=(shift:Shift)=>owner?Math.hypot(Math.max(owner.x-rect.x-shift.x-rect.width,rect.x+shift.x-owner.x-owner.width,0),Math.max(owner.y-rect.y-shift.y-rect.height,rect.y+shift.y-owner.y-owner.height,0)):0;
    const clear=(shift:Shift)=>{const box={...rect,x:rect.x+shift.x,y:rect.y+shift.y};return !occupied.some(other=>intersects(box,other))&&(!owner||ownerGap(shift)<=Math.max(28,owner.height*1.2));};
    // Most names already fit. A close resolved name can also stay put while
    // the original lane is occupied; avoid rebuilding a search every frame.
    const preferred=clamp(0,0);if(clear(preferred))return preferred;
    const prior=clamp(previous.x,previous.y);if(owner&&(previous.x||previous.y)&&clear(prior))return prior;
    const lateral=occupied.flatMap(other=>[{x:other.x-gap-rect.width-rect.x,y:0},{x:other.x+other.width+gap-rect.x,y:0}]);
    const cost=(shift:Shift)=>Math.abs(shift.x)+Math.abs(shift.y)*1.2-(shift===previous?8:0);
    const candidates=[{x:0,y:0},...[previous,...lateral,...Array.from({length:17},(_,i)=>(i%2?1:-1)*Math.ceil(i/2)*(rect.height+gap))
        .flatMap(y=>[0,-8,8,-16,16,-24,24].map(x=>({x,y})))].sort((a,b)=>cost(a)-cost(b))];
    let best=clamp(0,0),score=Infinity,first:Shift|undefined;
    for(const candidate of candidates){const shift=clamp(candidate.x,candidate.y),box={...rect,x:rect.x+shift.x,y:rect.y+shift.y};
        const overlaps=occupied.filter(other=>intersects(box,other)).length;
        if(!overlaps){first=shift;break;}
        if(overlaps<score){score=overlaps;best=shift;}
    }
    const primary=first??best;
    if(!owner)return primary;
    if(ownerGap(primary)<=Math.max(28,owner.height*1.2))return primary;
    // Only a detached name needs this bounded fallback. Search both obstacle
    // edges: quantized rows can miss the close gap just below a speech bubble.
    // Filter by the owner's reach before scoring, so a cheaper distant gap
    // cannot displace an available close one. Keep the old best effort only
    // when the crowd leaves no clear nearby position.
    let chosen=primary,bestCost=Infinity;
    const reach=Math.max(28,owner.height*1.2);
    const xs=[...new Set(candidates.map(shift=>shift.x))]
        .filter(x=>ownerGap({x:clamp(x,0).x,y:owner.y-rect.y})<=reach);
    const ys=[...new Set([...candidates.map(shift=>shift.y),
        ...occupied.flatMap(other=>[other.y-gap-rect.height-rect.y,other.y+other.height+gap-rect.y])])]
        .filter(y=>ownerGap({x:owner.x-rect.x,y:clamp(0,y).y})<=reach);
    for(const candidate of xs.flatMap(x=>ys.map(y=>({x,y})))){
        const shift=clamp(candidate.x,candidate.y),box={...rect,x:rect.x+shift.x,y:rect.y+shift.y};
        if(ownerGap(shift)>reach||occupied.some(other=>intersects(box,other)))continue;
        const value=cost(shift)+ownerGap(shift)*2;
        if(value<bestCost){bestCost=value;chosen=shift;}
    }
    return chosen;
}

const pending=new WeakSet<Element>(),next=new WeakMap<Element,number>(),shifts=new WeakMap<HTMLElement,Shift>();
/** One batched read/write pass per visible map, at most 30 times per second.
 * Queue after figure movement so reduced-motion steps also settle together. */
export function layoutWandererLabels(figure:HTMLElement) {
    const root=figure.closest('.pixel-map');if(!root||document.hidden||pending.has(root)||(next.get(root)??0)>performance.now())return;
    pending.add(root);requestAnimationFrame(()=>{
        pending.delete(root);if(!root.isConnected||document.hidden)return;next.set(root,performance.now()+32);
        const scene=root.closest('.continuous-world-map')??root,bounds=scene.getBoundingClientRect();
        const labels=[...root.querySelectorAll<HTMLElement>('.sector-wanderer-label,.sector-wanderer-bubble')].filter(label=>label.offsetParent&&label.parentElement!.style.visibility!=='hidden');
        const entries=labels.map(label=>{const prior=shifts.get(label)??{x:0,y:0},rect=label.getBoundingClientRect(),body=label.parentElement!.querySelector('.sector-avatar-body')!.getBoundingClientRect();return {label,prior,body,rect:{x:rect.x-prior.x,y:rect.y-prior.y,width:rect.width,height:rect.height}};});
        const visible=entries.filter(({body})=>body.right>bounds.left&&body.left<bounds.right&&body.bottom>bounds.top&&body.top<bounds.bottom);
        // Keep the four-pixel gap between names, without adding another halo
        // around the portrait's already bordered silhouette.
        const occupied:Rect[]=visible.map(({body})=>({x:body.x+gap,y:body.y+gap,width:Math.max(0,body.width-gap*2),height:Math.max(0,body.height-gap*2)}));
        // The self marker is a sibling of the moving chunk. Include it, peers
        // and fixed building titles in the same batched geometry read; names
        // must not cover players or turn a building title into an NPC's name.
        for(const node of scene.querySelectorAll<HTMLElement|SVGElement>('.sector-ground-landmark-label,.sector-village-entrance-name,.sector-village-entrance-action,.resource-world-node,.sector-life-point,.sector-avatar-figure:not(.sector-wanderer-figure) .sector-avatar-body,.continuous-world-peer .sector-avatar-body,[data-painted-name-clearance],[data-work-tool-clearance]')){
            if(node.closest('[hidden]')||(node instanceof SVGElement?getComputedStyle(node).visibility==='hidden':!node.offsetParent))continue;
            const box=node.getBoundingClientRect();
            if(!box.width||!box.height||box.right<=bounds.left||box.left>=bounds.right||box.bottom<=bounds.top||box.top>=bounds.bottom)continue;
            const inset=node.classList.contains('sector-avatar-body')?gap:0;
            occupied.push({x:box.x+inset,y:box.y+inset,width:Math.max(0,box.width-inset*2),height:Math.max(0,box.height-inset*2)});
        }
        // Read all geometry before writing any style to avoid layout per label.
        for(const entry of entries)if(!visible.includes(entry)){entry.label.style.translate='';entry.label.style.removeProperty('--bubble-pointer-left');delete entry.label.dataset.bubbleBelow;shifts.delete(entry.label);}
        for(const entry of visible){const speech=entry.label.classList.contains('sector-wanderer-bubble');
            // A greeting belongs above or below its speaker, with enough room
            // for its tail. It must not sit across the player's portrait.
            const obstacles=speech?[...occupied.map(box=>({x:box.x-2,y:box.y-2,width:box.width+4,height:box.height+4})),{x:bounds.x,y:entry.body.y+gap,width:bounds.width,height:Math.max(0,entry.body.height-gap*2)}]:occupied;
            const shift=placeWandererLabel(entry.rect,bounds,obstacles,entry.prior,speech?undefined:entry.body);
            occupied.push({...entry.rect,x:entry.rect.x+shift.x,y:entry.rect.y+shift.y});
            if(shift.x!==entry.prior.x||shift.y!==entry.prior.y)entry.label.style.translate=`${shift.x}px ${shift.y}px`;
            if(speech){
                const pointer=Math.max(8,Math.min(entry.rect.width-8,entry.body.x+entry.body.width/2-entry.rect.x-shift.x));
                entry.label.style.setProperty('--bubble-pointer-left',`${pointer}px`);
                entry.label.dataset.bubbleBelow=String(entry.rect.y+shift.y>=entry.body.bottom);
            }
            shifts.set(entry.label,shift);
        }
    });
}
