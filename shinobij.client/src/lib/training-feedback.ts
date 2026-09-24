import { AMBIGUOUS_ACTION_MESSAGE } from "./ambiguous-action";

/** A missing/malformed reply or server error does not prove a mutation failed. */
export function trainingResponseError(status: number, error: string | undefined, rejectionFallback: string): string {
    return status >= 400 && status < 500 && status !== 408
        ? error || rejectionFallback
        : AMBIGUOUS_ACTION_MESSAGE;
}

export function jutsuHallNoticeTitle(tone: JutsuHallNotice["tone"]): string {
    return tone === "error" ? "Training needs attention" : tone === "success" ? "Hall updated" : "Training note";
}

export type JutsuHallNotice = { tone: "success" | "error" | "info"; message: string };

export function friendlyJutsuTrainingError(error: string | undefined): string {
    const messages: Record<string, string> = {
        "jutsu-training-already-active": "A jutsu session is already active. Refresh the hall if it is not shown here.",
        "invalid-or-legacy-jutsu-training": "This training session is out of date. Refresh the game before trying again.",
        "training-not-finished": "That lesson is still in progress.",
        "not-enough-ryo": "You do not have enough ryo for that lesson.",
        "jutsu-at-training-cap": "That jutsu has reached its current Training Hall cap.",
        "jutsu-training-queue-full": "The training queue already has a second lesson.",
        "unknown-or-unowned-jutsu": "That jutsu is no longer available to this character.",
        "bloodline-required": "Equip the bloodline that grants this jutsu before training it.",
        "not-enough-honor-seals": "You do not have enough Honor Seals for that lesson.",
        "seal-training-below-level-30": "Train this jutsu to level 30 with ryo before its Honor Seal lessons.",
        "jutsu-at-seal-training-cap": "Honor Seal lessons can't take this jutsu further — it's at level 40 or your rank's cap.",
    };
    // The mutation helper cannot prove whether these responses reached the save.
    // Preserve its existing retries; ask the player to reconcile before a new intent.
    if (!error || [
        "The jutsu training server is unreachable.",
        "Jutsu training is temporarily busy. Please retry.",
        "Jutsu training was rejected.",
    ].includes(error)) return AMBIGUOUS_ACTION_MESSAGE;
    return messages[error] ?? error;
}
