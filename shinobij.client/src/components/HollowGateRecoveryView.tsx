/** Recovery keeps the shrine locked until its authoritative board is available. */
export function HollowGateRecoveryView() {
    return <main className="panel" aria-labelledby="shrine-recovery-title">
        <h1 id="shrine-recovery-title">Restoring the shrine</h1>
        <p role="status">Your unfinished run remains reserved while its sealed map loads.</p>
        <p>If the map does not return, reconnect and reload to retry.</p>
        <button onClick={() => window.location.reload()}>Reload shrine</button>
    </main>;
}
