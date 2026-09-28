export type CardSparChallenge = {
  id: string;
  fromName: string;
  createdAt: number;
  expiresAt: number;
};

export type CardSparAction = "request" | "inbox" | "status" | "respond";
export type CardSparResponse = {
  error?: string;
  status?: "pending" | "accepted" | "declined" | "expired";
  matchId?: string;
  challenges?: CardSparChallenge[];
  challenge?: { id: string; toName: string; status: string };
};

export class CardSparChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardSparChallengeError";
  }
}

export async function requestCardSparChallenge(
  name: string,
  action: CardSparAction,
  fields: { targetName?: string; challengeId?: string; decision?: "accept" | "decline" } = {},
  options: { signal?: AbortSignal } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<CardSparResponse> {
  let response: Response;
  try {
    response = await fetchImpl("/api/card-clash/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, action, ...fields }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new CardSparChallengeError("Could not reach Card Hall. Check your connection and try again.");
  }
  const body = await response.json().catch(() => ({})) as CardSparResponse;
  if (!response.ok) {
    throw new CardSparChallengeError(typeof body.error === "string" && body.error.trim()
      ? body.error
      : "Card Hall could not complete that spar request.");
  }
  return body;
}
