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
    const invitationsValid = Array.isArray(envelope.invitations);
    const roomClosed = envelope.party?.status === "closed";
    if (invitationsValid && !roomClosed) return envelope;
    return {
        ...envelope,
        ...(roomClosed ? { party: null } : {}),
        invitations: invitationsValid ? envelope.invitations : [],
    };
}

function towerRoomEnvelopeSnapshot(envelope: TowerPartyEnvelope): string {
    const party = envelope.party;
    const invitations = (Array.isArray(envelope.invitations) ? envelope.invitations : []).map(invitation => [
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
    const normalizedCurrent = normalizeTowerRoomEnvelope(current);
    const normalized = normalizeTowerRoomEnvelope(incoming);
    const party = resultMode === "drop" ? null
        : resultMode === "preserve" ? normalizedCurrent.party
        : !normalized.party || !normalizedCurrent.party || normalized.party.id !== normalizedCurrent.party.id || normalized.party.version >= normalizedCurrent.party.version
            ? normalized.party
            : normalizedCurrent.party;
    const next = { ...normalized, party };
    return towerRoomEnvelopeSnapshot(normalizedCurrent) === towerRoomEnvelopeSnapshot(next) ? normalizedCurrent : next;
}
