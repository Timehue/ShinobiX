import {
  TURN_TIMEOUT_MS,
  type ChronicleProjection,
} from "../../../shared/chronicle-duel";

const PVP_REFRESH_MS = 2_000;

export interface ChronicleRequestOrder {
  nextRequestId: number;
  latestSettledRequestId: number;
}

export function createChronicleRequestOrder(): ChronicleRequestOrder {
  return { nextRequestId: 0, latestSettledRequestId: 0 };
}

export function beginChronicleRequest(order: ChronicleRequestOrder): number {
  order.nextRequestId += 1;
  return order.nextRequestId;
}

/**
 * Only the newest response seen so far may update the board or its error
 * state. A slow poll therefore cannot roll back a faster player action.
 */
export function acceptChronicleResponse(
  order: ChronicleRequestOrder,
  requestId: number,
): boolean {
  if (requestId < order.latestSettledRequestId) return false;
  order.latestSettledRequestId = requestId;
  return true;
}

/**
 * Poll steadily for remote moves, but never sleep past the authoritative
 * response/turn deadline. This keeps a lone player's board from sticking at
 * 0s when the opponent has disconnected.
 */
export function chronicleNextStateRefreshMs(
  view: ChronicleProjection | null,
  waiting: boolean,
  now = Date.now(),
): number | null {
  if (waiting || !view) return PVP_REFRESH_MS;
  if (view.status !== "active") return null;
  const deadline =
    view.responseWindow?.expiresAt ??
    view.turnStartedAt + TURN_TIMEOUT_MS;
  return Math.max(
    100,
    Math.min(PVP_REFRESH_MS, deadline - now + 100),
  );
}
