/*
 * "You were invited to a Battle Towers party" — the only signal an invited
 * player gets outside the ready room.
 *
 * The problem this exists for: a targeted invitation is delivered by polling
 * GET /api/towers/party, and the ONLY thing that polls it is
 * TowerReadyRoomPanel — a component that lives three screens deep (Central Hub
 * → Celestial Tower → Battle Towers). So the host sat on "Awaiting invitation
 * responses" until the room expired two hours later while the invitee, who was
 * never on that screen, never learned anything had happened. The invite-code
 * path works out of band, which is probably why this went unnoticed.
 *
 * Transport: the player heartbeat, which is already the documented carrier for
 * pendingChallenges / pendingAttacker / pendingNotices — the same class of
 * "someone is waiting on you" signal. The heartbeat ships the raw per-player
 * invite index (tower-party-invites:<slug>) on the mget it was already making,
 * so this costs no extra request.
 *
 * Why the index alone is not enough to toast from: it is reconciled under a
 * lock on every party mutation, but nothing reconciles it when a party record
 * simply expires, so it can name a party that is gone. A toast that announces
 * an invitation the player cannot find is worse than no toast. So a NEW id is
 * only a TRIGGER: we fetch the real, server-validated envelope once and toast
 * from that. An id that validates away never becomes a toast, and the fetch
 * only happens when an unseen id actually appears.
 */

import { fetchTowerParty, type TowerPartyInvitationView } from "./towers-api";
import { gameToast } from "../components/GameToast";

/** Cap mirrors the server's slice; a runaway index must not become a toast storm. */
const MAX_TOASTS_PER_BEAT = 3;

const seenKey = (playerName: string) => `shinobix:towerInviteToasts:${playerName.toLowerCase()}`;

function readSeen(playerName: string): string[] {
    try {
        const raw = localStorage.getItem(seenKey(playerName));
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
        // Private mode / cleared storage / quota — re-toasting once is a far
        // better failure than throwing inside the heartbeat handler.
        return [];
    }
}

function writeSeen(playerName: string, ids: string[]): void {
    try {
        if (ids.length) localStorage.setItem(seenKey(playerName), JSON.stringify(ids));
        else localStorage.removeItem(seenKey(playerName));
    } catch {
        /* nothing to do — the worst case is one repeated toast */
    }
}

function describe(invitation: TowerPartyInvitationView): string {
    const host = invitation.hostDisplayName?.trim() || invitation.hostSlug;
    const where = invitation.binding.mode === "spire"
        ? `Spire tier ${invitation.binding.ascensionTier}`
        : `floor ${invitation.binding.floor}`;
    return `${host} invited you to a Battle Towers party — ${where}. Open Battle Towers to accept.`;
}

/** In flight guard: the heartbeat beats every second and must never stack fetches. */
let validating = false;

/**
 * Called from the heartbeat handler with whatever `towerPartyInvites` the beat
 * carried (the field is omitted entirely when empty). Fire-and-forget.
 */
export async function noteTowerPartyInvites(
    ids: readonly string[] | undefined,
    playerName: string,
    deps: {
        fetchParty?: typeof fetchTowerParty;
        toast?: (message: string) => void;
    } = {},
): Promise<void> {
    if (!playerName) return;

    // The toast is the ONLY signal an invited player gets, so firing it into a
    // hidden tab would lose it outright — the receipt would be written, nothing
    // would ever be seen, and we would be back to the bug this fixes. Hold
    // instead: the heartbeat keeps beating while hidden (deliberately — see
    // lib/heartbeat-cadence), so the invitation is announced on return.
    if (typeof document !== "undefined" && document.hidden) return;

    const live = (ids ?? []).filter((id) => typeof id === "string" && !!id);
    const seen = readSeen(playerName);

    // Prune ids that are no longer offered, so a re-invitation to the same party
    // toasts again rather than being silently swallowed by a stale receipt.
    const pruned = seen.filter((id) => live.includes(id));
    if (!live.length) {
        if (pruned.length !== seen.length) writeSeen(playerName, pruned);
        return;
    }

    const unseen = live.filter((id) => !pruned.includes(id));
    if (!unseen.length) {
        if (pruned.length !== seen.length) writeSeen(playerName, pruned);
        return;
    }
    if (validating) return;

    validating = true;
    try {
        const fetchParty = deps.fetchParty ?? fetchTowerParty;
        const toast = deps.toast ?? ((message: string) => gameToast(message, { kind: "info" }));
        const envelope = await fetchParty(playerName);
        const invitations = envelope?.invitations ?? [];

        // Only ids the SERVER still vouches for. An index entry whose party has
        // expired is dropped here and recorded as seen, so it cannot re-trigger
        // this fetch on the next beat.
        const confirmed = invitations.filter((invitation) => unseen.includes(invitation.partyId));
        for (const invitation of confirmed.slice(0, MAX_TOASTS_PER_BEAT)) toast(describe(invitation));

        writeSeen(playerName, [...pruned, ...unseen]);
    } catch {
        // Offline or a transient 5xx: record nothing, so the next beat retries.
        // The unseen ids stay unseen and the toast is delayed, never lost.
    } finally {
        validating = false;
    }
}

/** Test seam: the in-flight guard is module state and must be resettable. */
export function resetTowerPartyInviteToastState(): void {
    validating = false;
}
