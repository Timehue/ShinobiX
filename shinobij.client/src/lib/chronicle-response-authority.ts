export type ChronicleResponseAuthority = "discard" | "session-only" | "authoritative";

type ChronicleResponseAuthorityInput = {
  mounted: boolean;
  activePlayerName: string;
  originatingPlayerName: string;
  responsePlayerName?: string;
  carriesAuthoritativeSnapshot: boolean;
  saveVersion?: number;
  onServerVersion?: (version?: number) => boolean | void;
};

function normalizePlayerName(name: string | undefined): string {
  return String(name ?? "").trim().toLowerCase();
}

/**
 * Classifies an async Card Hall response before it can touch account-scoped
 * version authority or paint a full character snapshot.
 *
 * Non-mutating duel projections remain presentable without a save version.
 * Terminal rewards/characters and AI-start deck writes require the App-level
 * version decision, while an unmounted or switched-account response is dropped
 * before that callback is invoked.
 */
export function chronicleResponseAuthority({
  mounted,
  activePlayerName,
  originatingPlayerName,
  responsePlayerName,
  carriesAuthoritativeSnapshot,
  saveVersion,
  onServerVersion,
}: ChronicleResponseAuthorityInput): ChronicleResponseAuthority {
  const active = normalizePlayerName(activePlayerName);
  const originating = normalizePlayerName(originatingPlayerName);
  const responsePlayer = responsePlayerName === undefined
    ? originating
    : normalizePlayerName(responsePlayerName);

  if (!mounted || !active || active !== originating || responsePlayer !== originating) {
    return "discard";
  }
  if (!carriesAuthoritativeSnapshot) return "session-only";
  return onServerVersion?.(saveVersion) === false ? "session-only" : "authoritative";
}
