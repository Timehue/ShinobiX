export function ClaimImpactNotice({ title, reward, onClose }: { title: string; reward: string; onClose: () => void }) {
    return <section className="summary-box" role="status" aria-label="Claimed reward">
        <strong>{title} recorded</strong>
        <p>What changed: {reward}</p>
        <button type="button" onClick={onClose}>Dismiss</button>
    </section>;
}
