export type PlayerOwnedRequest = {
    readonly kind: string;
    readonly epoch: number;
    readonly playerName: string;
    readonly normalizedPlayerName: string;
    readonly controller: AbortController;
};

export const normalizePlayerIdentity = (name: string): string => name.trim().toLowerCase();

/**
 * Owns browser requests by both operation and active player identity.
 * A response is usable only while its exact attempt is current; switching
 * accounts aborts every request before the next identity can render.
 */
export class PlayerRequestOwner {
    private epoch = 0;
    private normalizedPlayerName = "";
    private active = false;
    private readonly attempts = new Map<string, PlayerOwnedRequest>();

    activate(playerName: string): number {
        this.abortAll();
        this.epoch += 1;
        this.normalizedPlayerName = normalizePlayerIdentity(playerName);
        this.active = Boolean(this.normalizedPlayerName);
        return this.epoch;
    }

    deactivate(epoch = this.epoch): void {
        if (epoch !== this.epoch) return;
        this.abortAll();
        this.active = false;
        this.epoch += 1;
    }

    begin(kind: string, playerName: string): PlayerOwnedRequest | null {
        if (!this.active || normalizePlayerIdentity(playerName) !== this.normalizedPlayerName) return null;
        this.abort(kind);
        const attempt: PlayerOwnedRequest = {
            kind,
            epoch: this.epoch,
            playerName,
            normalizedPlayerName: this.normalizedPlayerName,
            controller: new AbortController(),
        };
        this.attempts.set(kind, attempt);
        return attempt;
    }

    current(kind: string): PlayerOwnedRequest | null {
        const attempt = this.attempts.get(kind) ?? null;
        return attempt && this.isCurrent(attempt) ? attempt : null;
    }

    isCurrent(attempt: PlayerOwnedRequest): boolean {
        return this.active
            && !attempt.controller.signal.aborted
            && attempt.epoch === this.epoch
            && attempt.normalizedPlayerName === this.normalizedPlayerName
            && this.attempts.get(attempt.kind) === attempt;
    }

    finish(attempt: PlayerOwnedRequest): boolean {
        const usable = this.isCurrent(attempt);
        if (this.attempts.get(attempt.kind) === attempt) this.attempts.delete(attempt.kind);
        return usable;
    }

    abort(kind: string): void {
        const attempt = this.attempts.get(kind);
        if (!attempt) return;
        attempt.controller.abort();
        if (this.attempts.get(kind) === attempt) this.attempts.delete(kind);
    }

    abortAll(): void {
        for (const attempt of this.attempts.values()) attempt.controller.abort();
        this.attempts.clear();
    }
}
