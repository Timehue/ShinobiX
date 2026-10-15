import React from 'react';

export function WeeklyBossResult({settleState, settleResult, onRetry, onExit, exitLabel}: {
    settleState:'idle'|'pending'|'settled'|'failed';
    settleResult:unknown;
    onRetry:()=>void;
    onExit:()=>void;
    exitLabel:string;
}): React.JSX.Element {
    const receipt=settleResult as {dealt?:number}|null;
    const confirmed=settleState==='settled';

    return <div className="battle-ended-overlay"><div className="card battle-ended-card" role="dialog" aria-modal="true" aria-labelledby="weekly-boss-result-title">
        <h2 id="weekly-boss-result-title">{confirmed ? 'Assault Logged' : 'Assault ended'}</h2>
        {confirmed && typeof receipt?.dealt==='number' ? <>
            <p>You dealt <strong>{receipt.dealt.toLocaleString()}</strong> damage this run. Your contribution is banked to this week&apos;s leaderboard.</p>
            <p>Boss health: <strong>Unlimited</strong>. Use your remaining attempts before the event timer ends.</p>
        </> : settleState==='failed' ? <p>Your damage hasn&apos;t been confirmed. Retry settlement to bank this saved attempt.</p> : <p>Banking your damage to this week&apos;s leaderboard…</p>}
        {settleState==='failed' && <button className="start-primary-btn" onClick={onRetry}>Retry settlement</button>}
        <button className="start-primary-btn" disabled={!confirmed} onClick={onExit}>{exitLabel}</button>
        {settleState==='failed' && <button className="start-primary-btn start-primary-btn--muted" onClick={onExit}>Leave without confirmation</button>}
    </div></div>;
}
