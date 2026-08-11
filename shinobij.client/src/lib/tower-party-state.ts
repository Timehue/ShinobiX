import type { TowerPartyEnvelope } from "./towers-api";

export type TowerRoomResultMode = "adopt" | "drop" | "preserve";

export function isTowerRoomResponseCurrent(startedEpoch: number, currentEpoch: number): boolean {
    return startedEpoch === currentEpoch;
}

/** A room mutation owns membership ordering until its authoritative response is adopted. */
export function canStartTowerRoomPoll(alive: boolean, pollInFlight: boolean, mutationInFlight: boolean): boolean {
    return alive && !pollInFlight && !mutationInFlight;
}

function normalizeTowerRoomEnvelope(envelope: TowerPartyEnvelope): TowerPartyEnvelope {
    return envelope.party?.status === "closed" ? { ...envelope, party: null } : envelope;
}

function towerRoomEnvelopeSnapshot(envelope: TowerPartyEnvelope): string {
    const party = envelope.party;
    const invitations = envelope.invitations.map(invitation => [
        invitation.partyId,
        invitation.hostDisplayName ?? invitation.hostSlug,
        invitation.hostSlug,
        invitation.memberCount,
        invitation.expiresAt,
    ].join(":"));
    return [party?.id ?? "", party?.version ?? -1, party?.status ?? "", invitations.join("|")].join(";");
}

/** Keep roster/readiness monotonic when a slower mutation response arrives after a newer poll. */
export function reconcileTowerRoomEnvelope(
    current: TowerPartyEnvelope,
    incoming: TowerPartyEnvelope,
    resultMode: TowerRoomResultMode = "adopt",
): TowerPartyEnvelope {
    const normalized = normalizeTowerRoomEnvelope(incoming);
    const party = resultMode === "drop" ? null
        : resultMode === "preserve" ? current.party
        : !normalized.party || !current.party || normalized.party.id !== current.party.id || normalized.party.version >= current.party.version
            ? normalized.party
            : current.party;
    const next = { ...normalized, party };
    return towerRoomEnvelopeSnapshot(current) === towerRoomEnvelopeSnapshot(next) ? current : next;
}
