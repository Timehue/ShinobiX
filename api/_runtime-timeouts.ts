function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
    if (value === undefined || value.trim() === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(max, Math.floor(parsed));
}

export function runtimeTimeouts(env: NodeJS.ProcessEnv = process.env) {
    const statementMs = boundedInteger(env.PG_STATEMENT_TIMEOUT_MS, 30_000, 100, 120_000);
    const connectionMs = boundedInteger(env.PG_CONNECTION_TIMEOUT_MS, 15_000, 100, 60_000);
    return {
        statementMs,
        connectionMs,
        poolMax: boundedInteger(env.PG_POOL_MAX, env.RAILWAY_ENVIRONMENT ? 15 : 5, 1, 100),
        // Normal drain budget covers a connection wait plus one bounded query,
        // with 5s for final telemetry/pool close. The supervisor grace period
        // must allow this budget; code cannot extend an external SIGKILL.
        shutdownMs: boundedInteger(env.SHUTDOWN_TIMEOUT_MS, Math.max(45_000, statementMs + connectionMs + 5_000), 1000, 300_000),
    };
}
