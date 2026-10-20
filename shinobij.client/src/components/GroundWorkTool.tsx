import type {Ref} from 'react';

/** Attached work tool in terrain coordinates. The existing native actor tick
 * paints this single group; no timer, effect, simulation or React frame state. */
export function GroundWorkTool({toolRef,tool}:{toolRef:Ref<SVGSVGElement>;tool:'broom'|'hoe'}) {
    return <svg ref={toolRef} className="sector-ground-work-tool" viewBox="0 0 1200 1200" aria-hidden="true">
        <g><image href={tool==='hoe'?'/sector-life/field-hoe-v1.webp':'/sector-life/shrine-broom-v2.webp'} x="-8" y="0" width="16" height="72"/></g>
        <rect data-work-tool-clearance x="0" y="-30" width="58" height="80" fill="none"/>
    </svg>;
}
