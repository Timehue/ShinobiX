/** Existing native figures publish their already-computed ground point. Weak
 * keys disappear with the figure; consumers never need per-frame layout reads. */
const positions=new WeakMap<HTMLElement,{col:number;row:number}>();
let readers=0;
export function observeFigureGroundPositions(){readers++;let active=true;return()=>{if(active){active=false;readers--;}};}
export const publishFigureGroundPosition=(element:HTMLElement,position:{col:number;row:number})=>{if(readers)positions.set(element,position);};
export const figureGroundPosition=(element:HTMLElement)=>positions.get(element);
