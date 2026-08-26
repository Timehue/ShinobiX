import { GiScrollUnfurled } from "./icons/LightweightGameIcons";
import { sectorContractObjective } from "../../../shared/sector-contracts";
import type { SectorContractStatus } from "../lib/sector-contract";

/**
 * The day's posted work on this sector.
 *
 * Presentation only: the status is fetched by WorldMap (useSectorContract) and
 * the claim is its callback, so this card cannot decide who gets paid — the
 * server recomputes the bounty from the sealed sector and day either way.
 */
export function SectorContractCard({ status, busy, onClaim }: {
    status: SectorContractStatus;
    busy: boolean;
    onClaim: () => void;
}) {
    const contract = status.contract;
    if (!contract) return null;
    const done = Math.min(status.progress, contract.target);
    const percent = Math.max(0, Math.min(100, (done / Math.max(1, contract.target)) * 100));

    return (
        <section className="summary-box sector-panel-card sector-contract-card">
            <div className="sector-panel-card-head">
                <h4><GiScrollUnfurled aria-hidden="true" />Posted Contract</h4>
                <span className={`sector-status-pill ${status.claimed ? "is-owned" : ""}`}>
                    {status.claimed ? "Paid" : status.claimable ? "Ready" : "Open"}
                </span>
            </div>
            {/* The objective is a sentence, not a field label — .sector-owner-line
                <strong> is the panel's label slot and uppercases what it holds. */}
            <p className="sector-contract-objective">{sectorContractObjective(contract)}</p>
            {/* A night contract in daylight is not broken — it is waiting. Say so,
                and only while it still matters (finished work claims at any hour). */}
            {contract.nightOnly && !status.acceptingWork && !status.claimed && !status.claimable && (
                <p className="sector-contract-waiting">Daylight — work here counts again after dark.</p>
            )}
            <p className="sector-owner-line">
                <strong>Progress</strong>
                <span>{done} / {contract.target}</span>
            </p>
            <div className="sector-meter-block">
                <div className="sector-meter sector-meter-control"><span style={{ width: `${percent}%` }} /></div>
            </div>
            {status.claimed ? (
                <p className="sector-empty-note">Settled today. A new board goes up at midnight UTC.</p>
            ) : status.claimable ? (
                <button type="button" className="sector-action-btn is-primary" disabled={busy} onClick={onClaim}>
                    <span>{busy ? "Settling…" : `Claim ${contract.ryo.toLocaleString()} ryo`}</span>
                </button>
            ) : (
                <p className="sector-empty-note">
                    Pays {contract.ryo.toLocaleString()} ryo once the work is done.
                </p>
            )}
        </section>
    );
}
