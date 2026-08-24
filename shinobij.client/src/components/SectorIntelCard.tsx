import { GiSpyglass } from "react-icons/gi";
import type { SectorIntelPlateView } from "../lib/village-intel";
import { INTEL_PAYOFF_HEADING } from "../lib/village-stores-signposts";

/**
 * Village Intel on the selected sector — presentation-only leaf rendered by
 * WorldSectorCommandPanel. The view is projected in lib/village-intel from the
 * per-viewer block that module polls off GET /api/village/intel (its own
 * authenticated endpoint — see api/village/intel.ts for why it is NOT on the
 * shared world-state poll); this component only lays it out.
 *
 * Every string here arrives already written by the projection, including the
 * tier pill's colour class — the tier is the whole point of the card, so it
 * must not render one flat colour for all four tiers.
 */
export function SectorIntelCard({ intel }: { intel: SectorIntelPlateView }) {
    return (
        <section className="summary-box sector-panel-card sector-intel-card" aria-busy={intel.loading || undefined}>
            <div className="sector-panel-card-head">
                <h4><GiSpyglass aria-hidden="true" />Intel</h4>
                <span className={`sector-status-pill ${intel.tierPillClass}`}>{intel.tierLabel}</span>
            </div>
            {intel.loading ? (
                <p className="sector-empty-note">Gathering intel…</p>
            ) : (
                <>
                    {intel.reveal ? (
                        <>
                            <p className="sector-owner-line">
                                <strong>Garrison</strong>
                                <span className={intel.reveal.garrisonAlert ? "sector-intel-alert" : undefined}>{intel.reveal.garrisonLabel}</span>
                            </p>
                            <p className="sector-owner-line"><strong>Pool</strong><span>{intel.reveal.poolLine}</span></p>
                            {intel.reveal.structuresLabel
                                ? <p className="sector-guard-list"><strong>Structures</strong><span>{intel.reveal.structuresLabel}</span></p>
                                : <p className="sector-empty-note">No owner village — no structures to reveal.</p>}
                            {intel.expiryLabel && <p className="sector-intel-expiry">{intel.expiryLabel}</p>}
                            {intel.payoffLines.length > 0 && (
                                <div className="sector-intel-payoff">
                                    <h5>{INTEL_PAYOFF_HEADING}</h5>
                                    {intel.payoffLines.map((line) => <p key={line}>{line}</p>)}
                                </div>
                            )}
                        </>
                    ) : (
                        <p className="sector-empty-note">
                            {intel.unscoutedNotes.map((note) => <span key={note} className="sector-intel-note-line">{note}</span>)}
                        </p>
                    )}
                </>
            )}
            {intel.scoutedByLines.map((line) => <p key={line} className="sector-rebuild-note">{line}</p>)}
        </section>
    );
}
