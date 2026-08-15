/**
 * Explicit operator acknowledgement for a live overlay-to-base copy.
 *
 * This flag does not stop writers by itself. The operator sets it only after
 * independently stopping and verifying every overlay save/image writer.
 * MAINTENANCE_MODE is intentionally insufficient because it gates Express
 * player traffic, not cron, Socket.IO, the game loop, or other processes.
 */
export function migrationSourceWritersStopped(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    return env.KV_MIGRATION_WRITE_FROZEN === '1';
}
