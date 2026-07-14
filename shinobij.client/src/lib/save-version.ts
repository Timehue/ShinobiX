/** Keep the newest valid server-issued save version from an API mutation. */
export function adoptSaveVersion(current: number, incoming: unknown): number {
    return typeof incoming === "number" && Number.isFinite(incoming)
        ? Math.max(current, incoming)
        : current;
}
