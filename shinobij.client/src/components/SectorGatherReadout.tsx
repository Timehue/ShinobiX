import type { SectorGatherLine } from "../lib/sector-pool";

/**
 * The shared daily gathering pool readout under the sector heading.
 *
 * Presentation only — every string, including the depleted advice, is written
 * by `sectorGatherLineFor` in lib/sector-pool so the copy is unit-testable and
 * the pre-poll placeholder can never be mistaken for a real "0 / 1,500".
 *
 * It deliberately does NOT wear `.sector-panel-sub`: stacked under the sector
 * sub-line, two dim captions read as one caption that wrapped.
 */
export function SectorGatherReadout({ gather }: { gather: SectorGatherLine }) {
    return (
        <div className="sector-gather-block">
            <small className={`sector-gather-line${gather.depleted ? " is-depleted" : ""}${gather.pending ? " is-pending" : ""}`}>{gather.text}</small>
            {gather.note && <small className="sector-gather-note">{gather.note}</small>}
        </div>
    );
}
