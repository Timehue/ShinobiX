import type { GameConfirmOptions } from "../components/GameAlert";
import { SaveRateLimitError } from "./save-persistence";

/** Only a confirmed HTTP 429 gets timing advice; other failures retain their guard. */
export function logoutSaveFailure(error: unknown): { message: string; options: GameConfirmOptions } {
    if (error instanceof SaveRateLimitError) {
        const seconds = error.retryAfterMs === null ? null : Math.max(1, Math.ceil(error.retryAfterMs / 1000));
        const pause = seconds === null ? "wait a little" : `wait about ${seconds} ${seconds === 1 ? "second" : "seconds"}`;
        return {
            message: `The server is temporarily limiting saves. Stay logged in, ${pause}, then choose Logout again to retry. Progress already saved on the server is still there, but your latest changes have not been confirmed saved. Logging out anyway may lose those changes.`,
            options: { title: "Save temporarily paused", confirmLabel: "Log out anyway", cancelLabel: "Stay logged in", danger: true },
        };
    }
    return {
        message: "Your progress could not be saved to the server. Logging out now will lose everything since your last successful save. Log out anyway?",
        options: { title: "Save Failed", confirmLabel: "Log out anyway", danger: true },
    };
}
