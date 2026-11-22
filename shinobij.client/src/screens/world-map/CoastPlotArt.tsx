import { HallPainting } from "./HallLivery";
import type { CoastLand } from "./coast-service";
import { plotPlate, type plotPaint } from "./coast-plot";

export function CoastPlotArt({ paint, area }: { paint: ReturnType<typeof plotPaint>; area?: CoastLand }) {
    const phase = area?.contest?.phase;
    const marker = phase === "posted" ? "notice-post" : phase === "open" ? "war-standards" : null;
    return <span className="coast-plot-art" aria-hidden="true">
        {area?.holder?.hallStyle ? <span className="coast-hall-marker"><HallPainting style={area.holder.hallStyle} label={false} /></span> : paint.main && <img className="coast-plot-main" src={paint.main} alt="" />}
        <span className="coast-plot-works">{paint.works.map(work => <img key={work.id} src={plotPlate(work.id)} alt="" />)}</span>
        {paint.dormant && <img className="coast-plot-gate" src={plotPlate("dormant-gate")} alt="" />}
        {marker && <img className="coast-plot-contest" src={plotPlate(marker)} alt="" />}
    </span>;
}
