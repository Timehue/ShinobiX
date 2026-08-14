export type FreePlayQueueAction = "join" | "leave" | "poll";

export type FreePlayQueueAuthority = Readonly<{
  accountKey: string;
  generation: number;
}>;

export function normalizeFreePlayQueueAccount(name: string): string {
  return name.trim().toLowerCase();
}

/** Synchronously retires every request captured for a previous account. */
export function advanceFreePlayQueueAuthority(
  current: FreePlayQueueAuthority,
  accountName: string,
): FreePlayQueueAuthority {
  const accountKey = normalizeFreePlayQueueAccount(accountName);
  return accountKey === current.accountKey
    ? current
    : Object.freeze({ accountKey, generation: current.generation + 1 });
}

export function freePlayQueueAuthorityIsCurrent(
  current: FreePlayQueueAuthority,
  captured: FreePlayQueueAuthority,
): boolean {
  return Boolean(captured.accountKey)
    && current.accountKey === captured.accountKey
    && current.generation === captured.generation;
}

export type FreePlayQueueMatch = {
  matchId: string;
  opponent?: string;
  p1?: boolean;
};

export type FreePlayQueueResponse = {
  inQueue?: boolean;
  reason?: string;
  error?: string;
  match?: FreePlayQueueMatch | null;
};

export class FreePlayQueueError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "FreePlayQueueError";
    this.status = status;
  }
}

export async function requestFreePlayQueue(
  name: string,
  action: FreePlayQueueAction,
  options: { keepalive?: boolean; signal?: AbortSignal } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<FreePlayQueueResponse> {
  let response: Response;
  try {
    response = await fetchImpl("/api/card-clash/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, action }),
      keepalive: options.keepalive,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new FreePlayQueueError("Could not reach the showdown queue. Check your connection and try again.");
  }

  const body = await response.json().catch(() => ({})) as FreePlayQueueResponse;
  if (!response.ok) {
    throw new FreePlayQueueError(
      typeof body.error === "string" && body.error.trim()
        ? body.error
        : "The showdown queue could not complete that request.",
      response.status,
    );
  }
  return body;
}

export type FreePlayPollOutcome =
  | { kind: "matched"; matchId: string }
  | { kind: "waiting" }
  | { kind: "expired" };

export function freePlayPollOutcome(body: FreePlayQueueResponse): FreePlayPollOutcome {
  const matchId = body.match?.matchId;
  if (typeof matchId === "string" && matchId.trim()) {
    return { kind: "matched", matchId };
  }
  return body.inQueue === false ? { kind: "expired" } : { kind: "waiting" };
}
