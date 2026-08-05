import type { ClanBossPartyView, ClanBossPingKind } from "../../../shared/clan-boss-operation";
import type { ClanBossPartyAction } from "./ClanBossPartyLobby";

const PINGS: Array<{ kind: ClanBossPingKind; label: string }> = [
    { kind: "focus-boss", label: "Focus Boss" },
    { kind: "clear-adds", label: "Clear Adds" },
    { kind: "need-heal", label: "Need Healing" },
    { kind: "hold", label: "Hold" },
    { kind: "ready", label: "Ready" },
];

export function ClanBossOperationComms({ party, onAction }: { party: ClanBossPartyView | null; onAction: ClanBossPartyAction }) {
    if (!party) return null;
    const latest = party.pings[0];
    return (
        <aside className="operation-comms" aria-label="Operation tactical communication">
            <div className="operation-comms-status">
                <strong>Squad {party.members.length}/4</strong>
                <span>{party.members.map((member) => `${member.displayName}: ${member.connection}`).join(" · ")}</span>
            </div>
            <div className="operation-pings" aria-label="Tactical pings">
                {PINGS.map((ping) => <button type="button" key={ping.kind} onClick={() => onAction("ping", { ping: ping.kind })}>{ping.label}</button>)}
            </div>
            <div className="operation-latest-ping" aria-live="polite">{latest ? `${latest.by}: ${PINGS.find((ping) => ping.kind === latest.kind)?.label ?? latest.kind}` : "No tactical pings yet."}</div>
        </aside>
    );
}
