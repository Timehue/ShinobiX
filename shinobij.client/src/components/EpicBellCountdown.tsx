import { GameArtIcon } from "./GameArtIcon";
import { timeLeftLabel } from "../lib/questbook";
import { useSharedNow } from "../lib/use-shared-now";

/**
 * A timed epic stage's "before the bell rings" line, shown in the wanderer
 * dialog. It is a leaf that holds its own tick on the shared display clock, so
 * neither the hook-free WorldWandererDialog nor the World Map behind it has to
 * re-render once a second to move it. `now` is the instant WorldMap projected
 * when it last rendered; the shared clock only carries it forward.
 * Presentation only: the server decides whether the stage ran out.
 */
export function EpicBellCountdown({ deadline, now }: { deadline: number; now: number }) {
    const sharedNow = useSharedNow();
    const left = timeLeftLabel(deadline, Math.max(now, sharedNow));
    if (!left) return null;
    const expired = left === "0:00";
    return <p style={{ fontSize: ".78rem", margin: "0 0 8px", fontWeight: 700, color: expired ? "var(--red-400)" : "#fbbf24" }}><GameArtIcon kind="mission" size={15} /> {expired ? "The bell rang. Your next attempt restarts this stage." : `${left} before the bell rings`}</p>;
}
