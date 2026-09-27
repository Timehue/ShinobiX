import { TOWER_HONORS, type TowerRecords } from '../../../shared/tower-progression';
export function TowerRecordsPanel({ records }: { records?: TowerRecords }) {
    const bests = Object.entries(records?.bests ?? {}).sort(([,a],[,b]) => a.mode.localeCompare(b.mode) || b.floor-a.floor || a.partySize-b.partySize);
    const earned = TOWER_HONORS.filter(honor => records?.honors[honor.id]);
    return <section className="tower-records" aria-labelledby="tower-records-title">
        <div className="tower-records-heading"><div><small>YOUR CLIMB</small><h2 id="tower-records-title">Personal bests & achievements</h2></div><span>{earned.length} / {TOWER_HONORS.length} earned</span></div>
        <div className="tower-honors">{TOWER_HONORS.map(honor => <div key={honor.id} className="tower-honor" data-earned={Boolean(records?.honors[honor.id])}><strong>{honor.name}</strong><p>{honor.description}</p><small>{records?.honors[honor.id] ? 'Earned' : 'Not yet earned'}</small></div>)}</div>
        {bests.length > 0 && <p className="tower-best-highlight">Personal best · {bests[0][1].mode === 'spire' ? 'Spire' : 'Story'} {bests[0][1].floor} · {bests[0][1].bestScore.toLocaleString()} score · {bests[0][1].fastestRounds} rounds · {bests[0][1].partySize === 1 ? 'Solo' : `${bests[0][1].partySize} players`} · {bests[0][0].split(':')[3]?.replaceAll('-', ' ') ?? 'standard'}</p>}
        <details className="tower-best-list"><summary>Best clears {bests.length > 0 ? `· ${bests.length} records` : '· your first clear starts the record'}</summary>
            <p>Compared by floor, human squad size, and route. Replays can improve your record.</p>
            {bests.length > 0 && <div className="tower-best-table"><table><thead><tr><th>Floor / squad</th><th>Route</th><th>Best score</th><th>Fastest</th><th>No KO</th></tr></thead><tbody>{bests.map(([key,best])=><tr key={key}><th>{best.mode === 'spire' ? 'Spire' : 'Story'} {best.floor} · {best.partySize === 1 ? 'Solo' : `${best.partySize} players`}</th><td>{key.split(':')[3]?.replaceAll('-', ' ') ?? 'standard'}</td><td>{best.bestScore.toLocaleString()}</td><td>{best.fastestRounds} rounds</td><td>{best.noKnockout ? 'Yes' : '—'}</td></tr>)}</tbody></table></div>}
        </details>
    </section>;
}
