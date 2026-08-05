import type { ClanBossPartyEnvelope, ClanBossPartyView } from "../../../shared/clan-boss-operation";

export type ClanBossPartyAction = (action: string, extras?: { target?: string; visibility?: "public" | "private"; ping?: string }) => void;

function PartySummary({ party, actionLabel, onAction }: { party: ClanBossPartyView; actionLabel: string; onAction: () => void }) {
    return (
        <div className="operation-finder-row">
            <div>
                <strong>{party.members.length}/4 shinobi</strong>
                <span>{party.members.map((member) => member.displayName).join(", ")}</span>
            </div>
            <button type="button" onClick={onAction}>{actionLabel}</button>
        </div>
    );
}

export function ClanBossPartyLobby({
    envelope,
    playerSlug,
    clanmates,
    busy,
    onAction,
    onStart,
}: {
    envelope: ClanBossPartyEnvelope;
    playerSlug: string;
    clanmates: string[];
    busy: boolean;
    onAction: ClanBossPartyAction;
    onStart: () => void;
}) {
    const party = envelope.party;
    if (!party) {
        return (
            <section className="operation-lobby" aria-labelledby="operation-lobby-title">
                <div className="operation-lobby-heading">
                    <div><h4 id="operation-lobby-title">Operation Party</h4><p>Real clanmates must explicitly join and ready. No offline player will be replaced or presented as AI.</p></div>
                    <span className="operation-population">{envelope.population.publicParties} open {envelope.population.publicParties === 1 ? "party" : "parties"} · {envelope.population.openSeats} seats</span>
                </div>
                {envelope.invitations.length > 0 ? (
                    <div className="operation-finder-list">
                        <h5>Invitations</h5>
                        {envelope.invitations.map((invite) => (
                            <div className="operation-invite-row" key={invite.id}>
                                <PartySummary party={invite} actionLabel="Accept" onAction={() => onAction("join", { target: invite.id })} />
                                <button type="button" className="operation-link-button" onClick={() => onAction("decline", { target: invite.id })}>Decline</button>
                            </div>
                        ))}
                    </div>
                ) : null}
                {envelope.publicParties.length > 0 ? (
                    <div className="operation-finder-list">
                        <h5>Clan Finder</h5>
                        {envelope.publicParties.map((candidate) => <PartySummary key={candidate.id} party={candidate} actionLabel="Join" onAction={() => onAction("join", { target: candidate.id })} />)}
                    </div>
                ) : <p className="operation-empty">No public clan party is waiting right now. This is the real current population.</p>}
                <div className="operation-create-actions">
                    <button type="button" disabled={busy} onClick={() => onAction("create", { visibility: "public" })}>Create Public Party</button>
                    <button type="button" disabled={busy} onClick={() => onAction("create", { visibility: "private" })}>Create Private / Solo Party</button>
                </div>
            </section>
        );
    }

    const self = party.members.find((member) => member.slug === playerSlug);
    const isLeader = party.leaderSlug === playerSlug;
    const isPreStart = party.status === "forming" || party.status === "queued";
    const availableInvites = clanmates.filter((name) => {
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return !party.members.some((member) => member.slug === slug) && !party.invitedSlugs.includes(slug);
    }).slice(0, 12);

    return (
        <section className="operation-lobby" aria-labelledby="operation-lobby-title">
            <div className="operation-lobby-heading">
                <div>
                    <h4 id="operation-lobby-title">Operation Party · {party.members.length}/4</h4>
                    <p>{party.visibility === "public" ? "Public to your clan" : "Private invitation party"} · status: <strong>{party.status}</strong> · version {party.version}</p>
                </div>
                {party.status === "queued" ? <span className="operation-queue-badge">Finder active</span> : null}
            </div>

            <div className="operation-roster" role="list" aria-label="Operation party roster">
                {party.members.map((member) => (
                    <div className="operation-member" role="listitem" key={member.slug}>
                        <div className="operation-member-identity">
                            <span className={`operation-presence is-${member.connection}`} aria-label={member.connection}>{member.connection === "online" ? "●" : "○"}</span>
                            <div><strong>{member.displayName}</strong><small>{member.slug === party.leaderSlug ? "Leader" : "Member"}{member.snapshot?.profession ? ` · ${member.snapshot.profession}` : ""}{member.snapshot?.level ? ` · Lv ${member.snapshot.level}` : ""}</small></div>
                        </div>
                        <span className={`operation-ready is-${member.ready ? "ready" : "not-ready"}`}>{member.ready ? "Ready" : "Not ready"}</span>
                        {isLeader && member.slug !== playerSlug && isPreStart ? (
                            <div className="operation-member-actions">
                                <button type="button" onClick={() => onAction("transfer", { target: member.slug })}>Make leader</button>
                                <button type="button" onClick={() => onAction("kick", { target: member.slug })}>Remove</button>
                            </div>
                        ) : null}
                    </div>
                ))}
            </div>

            {party.invitedSlugs.length > 0 ? <p className="operation-invited">Awaiting response: {party.invitedSlugs.join(", ")}</p> : null}

            {isLeader && party.members.length < 4 && party.status === "forming" && availableInvites.length > 0 ? (
                <div className="operation-invite-grid" aria-label="Invite clanmates">
                    {availableInvites.map((name) => <button type="button" key={name} onClick={() => onAction("invite", { target: name })}>Invite {name}</button>)}
                </div>
            ) : null}

            {isPreStart ? (
                <div className="operation-primary-actions">
                    {party.status === "forming" ? <button type="button" aria-pressed={self?.ready ?? false} disabled={busy} onClick={() => onAction(self?.ready ? "unready" : "ready")}>{self?.ready ? "Mark Not Ready" : "Seal Loadout & Ready"}</button> : null}
                    {isLeader && party.status === "forming" && party.allReady && party.members.length === 1 && party.visibility === "public" && !party.soloFallbackAccepted ? <button type="button" disabled={busy} onClick={() => onAction("queue")}>Enter Clan Finder</button> : null}
                    {isLeader && party.status === "queued" ? <button type="button" disabled={busy} onClick={() => onAction("cancel-queue")}>Cancel Finder</button> : null}
                    {isLeader && party.fallbackAvailable ? <button type="button" disabled={busy} onClick={() => onAction("solo-fallback")}>Continue Solo</button> : null}
                    {isLeader && party.status === "forming" && party.canStart ? <button type="button" className="operation-start" disabled={busy} onClick={onStart}>Start Operation</button> : null}
                    <button type="button" disabled={busy} onClick={() => onAction("leave")}>{isLeader && party.members.length === 1 ? "Disband" : "Leave Party"}</button>
                </div>
            ) : null}

            {party.status === "queued" && party.members.length === 1 && !party.fallbackAvailable ? <p className="operation-wait-note">Waiting for a real clanmate. Solo fallback unlocks after a bounded two-minute wait; no population is fabricated.</p> : null}
            {party.status === "starting" ? <p className="operation-state-message" role="status">Sealing the authoritative encounter…</p> : null}
            {party.status === "active" ? <p className="operation-state-message" role="status">Operation active. Rejoin through the combat banner if your browser refreshed.</p> : null}
            {party.status === "completed" ? <p className="operation-state-message is-complete" role="status">Operation complete. Contribution and sector results are sealed.</p> : null}
            {party.status === "completed" && isLeader ? <button type="button" className="operation-new-party" onClick={() => onAction("disband")}>Close Summary & Form Again</button> : null}
        </section>
    );
}
