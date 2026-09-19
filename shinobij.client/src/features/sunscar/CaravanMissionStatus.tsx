import { caravanObjectiveProgress, caravanRewardPreview } from '../../../../shared/sunscar/caravan-state';
import { CARAVAN_TOOLS, type CaravanChanges, type CaravanRun, type CaravanTool } from '../../../../shared/sunscar/caravan-types';

const changeNames = { cargo: '% cargo', supplies: ' supplies', morale: '% morale', hp: ' health', chakra: ' chakra', stamina: ' stamina', ryo: ' Ryo', reputation: ' mission reputation', bonus: '% delivery bonus', discoveries: ' discoveries', travelersHelped: ' travelers helped', enemiesDefeated: ' battles won', scouted: ' stops revealed' } as const;
export function CaravanChangeSummary({ changes, title = 'Last decision' }: { changes?: CaravanChanges; title?: string }) {
    if (!changes) return null;
    const entries = Object.entries(changeNames).flatMap(([key, label]) => {
        const delta = changes[key as keyof typeof changeNames];
        const singular: Record<string, string> = { supplies: ' supply', discoveries: ' discovery', travelersHelped: ' traveler helped', enemiesDefeated: ' battle won', scouted: ' stop revealed' };
        const unit = delta && Math.abs(delta) === 1 ? singular[key] ?? label : label;
        return delta ? [`${delta > 0 ? '+' : '−'}${Math.abs(delta).toLocaleString()}${unit}`] : [];
    });
    for (const [tool, delta] of Object.entries(changes.tools ?? {})) {
        if (delta) entries.push(`${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${CARAVAN_TOOLS[tool as CaravanTool].name.toLowerCase()}`);
    }
    return <div className="caravan-feedback" role="status" aria-atomic="true"><strong>{title}</strong><div>{entries.length ? entries.map(entry => <span key={entry}>{entry}</span>) : <span>No resource change</span>}</div></div>;
}

export function CaravanMissionStatus({ run }: { run: CaravanRun }) {
    const objective = caravanObjectiveProgress(run);
    const reward = caravanRewardPreview(run);
    const cargo = run.contract.objective.kind === 'cargo';
    return <div className="caravan-mission-status" aria-label="Mission progress">
        <div className="caravan-objective-progress"><strong>{objective.label}</strong><span>{objective.current}{cargo ? '%' : ''} / {objective.target}{cargo ? '%' : ''}</span></div>
        <small>{objective.complete ? cargo ? 'Target met · preserve it through delivery' : 'Target met · finish the delivery to earn the bonus' : run.contract.objective.label}</small>
        <div className="caravan-payout-preview"><span>Delivery payout estimate</span><strong>{reward.ryo.toLocaleString()} Ryo</strong></div>
        <small>At current cargo · {reward.reputation} reputation on delivery.</small>
        <small className="caravan-objective-bonus">Objective bonus: +{reward.objectiveBonus.toLocaleString()} Ryo and +5 reputation {reward.objectiveComplete ? '(included)' : '(not yet earned)'}.</small>
    </div>;
}
