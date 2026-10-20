/** Clan progress comes from the assault receipt, never the local boss actor HP. */
export function clanBossResult(receipt: unknown) {
    const data = receipt && typeof receipt === 'object' ? receipt as Record<string, unknown> : {};
    const pool = data.pool as number;
    const confirmed = data.ok === true && Number.isFinite(pool) && pool >= 0;
    const defeated = confirmed && pool === 0;
    return {
        confirmed,
        defeated,
        detail: confirmed
            ? `Contribution saved. ${defeated ? "Your clan has defeated this week's boss." : `Clan boss health remaining: ${pool.toLocaleString()} HP.`}`
            : typeof data.error === 'string' && data.error ? data.error : 'Clan contribution not confirmed.',
    };
}
