import { useId, useState } from "react";
import type { ModelOperations } from "../../../shared/avatar-model-operations";

const paths = { A: "Path A", B: "Path B", unknown: "Unknown path" } as const;
const retryLabels = { "expired-style": "Expired style", "worker-failure": "Worker failure", unknown: "Unclassified" };
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });

function formatAge(seconds: number) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor(seconds / 60) % 60;
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return seconds < 60 ? `${seconds}s` : `${minutes}m`;
}

export function AvatarModelOperations({ adminPw }: { adminPw: string }) {
    const title = useId();
    const [snapshot, setSnapshot] = useState<ModelOperations | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);

    async function refresh() {
        setLoading(true);
        setError(false);
        try {
            const response = await fetch("/api/admin/avatar-model/operations", {
                headers: { "x-admin-password": adminPw },
            });
            if (!response.ok) throw new Error("Could not load activity");
            setSnapshot(await response.json() as ModelOperations);
        } catch {
            setSnapshot(null);
            setError(true);
        } finally {
            setLoading(false);
        }
    }

    return (
        <section className="summary-box" aria-labelledby={title} aria-busy={loading}>
            <h3 id={title}>World model activity</h3>
            <button type="button" disabled={loading} onClick={() => void refresh()}>
                {loading ? "Loading activity…" : snapshot ? "Refresh activity" : "Load world model activity"}
            </button>
            {error && <p role="alert">Could not load world model activity. Try again.</p>}
            {snapshot && (
                <>
                    <p>New submissions {snapshot.creationConfigured ? "configured" : "unavailable"}</p>
                    <ul>
                        <li>{snapshot.queue.dispatch} queued for processing</li>
                        <li>{snapshot.queue.publication} queued for publication</li>
                        <li>Oldest queued submission · {snapshot.queue.oldestSeconds === null
                            ? "Unavailable" : formatAge(snapshot.queue.oldestSeconds)}</li>
                    </ul>
                    <div style={{ overflowX: "auto", maxWidth: "100%" }}>
                        <table>
                            <caption>Jobs admitted in the last {snapshot.windowDays} days</caption>
                            <thead>
                                <tr>
                                    <th scope="col">Path</th><th scope="col">Admitted</th><th scope="col">Ready</th>
                                    <th scope="col">Failed</th><th scope="col">Cancelled</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(Object.keys(paths) as Array<keyof typeof paths>).map(path => {
                                    const counts = snapshot.paths[path];
                                    return <tr key={path}><th scope="row">{paths[path]}</th><td>{counts.admitted}</td>
                                        <td>{counts.ready}</td><td>{counts.failed}</td><td>{counts.cancelled}</td></tr>;
                                })}
                            </tbody>
                        </table>
                    </div>
                    <p>Average cost per ready model · {snapshot.billing.averageReadyMicros === null
                        ? "Unavailable" : usd.format(snapshot.billing.averageReadyMicros / 1_000_000)}
                        {" "}({snapshot.billing.settledReady} fully settled)</p>
                    <p>Recorded Modal worker time · {snapshot.billing.workerMilliseconds === null
                        ? "Unavailable" : `${(snapshot.billing.workerMilliseconds / 1000).toLocaleString()} s`}
                        {" "}({snapshot.billing.timedJobs} jobs with duration)</p>
                    <details>
                        <summary>Retries, failures and versions</summary>
                        <h4>Retries</h4>
                        <ul>
                            {(Object.keys(retryLabels) as Array<keyof typeof retryLabels>).map(cause =>
                                <li key={cause}>{retryLabels[cause]} · {snapshot.retries[cause]}</li>)}
                        </ul>
                        <h4>Failure reasons</h4>
                        {Object.keys(snapshot.failures).length === 0 ? <p>No recorded failures</p> :
                            <ul>{Object.entries(snapshot.failures).map(([reason, count]) =>
                                <li key={reason}>{reason.replaceAll("-", " ")} · {count}</li>)}</ul>}
                        <h4>Pipeline and kit versions</h4>
                        {snapshot.versions.length === 0 ? <p>No recorded versions</p> :
                            <ul style={{ overflowWrap: "anywhere" }}>{snapshot.versions.map(({ pipeline, kit, count }) =>
                                <li key={`${pipeline}/${kit}`}>{pipeline} / {kit} · {count}</li>)}</ul>}
                    </details>
                </>
            )}
        </section>
    );
}
