/** Keep rejected starts actionable without changing their server-owned state. */
export function aiFightStartErrorMessage(error: unknown, sector?: number): string {
    const message = error instanceof Error ? error.message : String(error);
    switch (message) {
        case 'world-sector-mismatch':
            return `This encounter belongs to ${sector == null ? 'another sector' : `sector ${sector}`}. Return to the map and travel there before retrying.`;
        case 'world-ambush-ineligible':
            return 'This ambush is no longer available. Return to the map. If the same encounter keeps returning, contact support; your saved progress has been retained.';
        case 'world-chain-start-unconfirmed':
            return 'The next fight could not be confirmed. Retry when your connection is ready, or return to the map. Your saved chain has been retained.';
        case 'world-chain-proof-missing':
        case 'world-chain-stage-invalid':
            return 'This encounter could not be resumed from its saved progress. Return to the map and contact support if it persists.';
        default:
            return message;
    }
}
