import { useEffect, type CSSProperties } from 'react';
import { RALLY_ATTACK, RALLY_HZ, type RallyAction } from '../../../../shared/sunscar/rally-types';

export function RallyControls({ input, disabled, technique, techniqueUsed, techniqueActive, stamina, bursting, attack, attackDescription, charge, attackBlocked }: {
    input: (kind: RallyAction['kind']) => void; disabled: boolean; technique: string; techniqueUsed: boolean; techniqueActive: boolean;
    stamina: number; bursting: boolean; attack: string; attackDescription: string; charge: number; attackBlocked: boolean;
}) {
    useEffect(() => {
        const keys: Record<string, RallyAction['kind']> = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ShiftLeft: 'burst-on', ShiftRight: 'burst-on', KeyE: 'technique', KeyQ: 'attack' };
        const down = (event: KeyboardEvent) => {
            if (disabled || !keys[event.code] || (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return;
            // Space activates a focused control; it must not also trigger Jump.
            if (event.code === 'Space' && event.target instanceof HTMLElement && event.target.closest('button')) return;
            event.preventDefault();
            if (!event.repeat && (keys[event.code] !== 'technique' || !techniqueUsed)) input(keys[event.code]);
        };
        const up = (event: KeyboardEvent) => { if (event.code.startsWith('Shift')) { event.preventDefault(); input('burst-off'); } };
        const release = () => input('burst-off');
        window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
    }, [disabled, input, techniqueUsed]);
    return <div className="rally-controls" aria-label="Race controls">
        <div className="rally-steering">
            <button type="button" aria-label="Steer left, A or Left Arrow" disabled={disabled} onPointerDown={e => { e.preventDefault(); input('left'); }} onClick={e => { if (e.detail === 0) input('left'); }}>←<small>A / ←</small></button>
            <button type="button" aria-label="Steer right, D or Right Arrow" disabled={disabled} onPointerDown={e => { e.preventDefault(); input('right'); }} onClick={e => { if (e.detail === 0) input('right'); }}>→<small>D / →</small></button>
        </div>
        <div className="rally-actions">
            <button type="button" className={`rally-technique${techniqueUsed ? ' is-used' : ''}`} disabled={disabled || techniqueUsed} aria-label={`${technique}, ${techniqueUsed ? 'used this race' : 'E'}`}
                title={techniqueUsed ? 'Used this race. Available again next race.' : 'Once per race'} onClick={() => input('technique')}>{technique}<small>{techniqueUsed ? techniqueActive ? 'Used · active' : 'Used this race' : 'E · once per race'}</small></button>
            <button type="button" className={`rally-attack${charge >= 100 && !attackBlocked ? ' is-ready' : ''}`} style={{ '--rally-charge': `${charge}%` } as CSSProperties}
                disabled={disabled || charge < 100 || attackBlocked} aria-label={`${attack}, Q, ${attackBlocked ? 'recovering' : charge >= 100 ? 'ready' : 'charging'}`}
                title={`${attackDescription} Fires down your lane. Firing costs 10% speed for 0.45 seconds. Jump or steer to dodge incoming shots.`}
                onClick={() => input('attack')}>{attack}<small>{charge >= 100 ? attackBlocked ? 'Recovering' : 'Q · Fire' : `${((100 - charge) / 100 * RALLY_ATTACK.chargeTicks / RALLY_HZ).toFixed(1)}s · charging`}</small></button>
            <button type="button" disabled={disabled} aria-label="Jump, Space" onPointerDown={e => { e.preventDefault(); input('jump'); }} onClick={e => { if (e.detail === 0) input('jump'); }}>Jump<small>Space</small></button>
            <button type="button" className={`rally-burst${bursting ? ' is-active' : ''}`} disabled={disabled} aria-pressed={bursting} aria-label="Hold Burst, Shift" title="28% faster while held. Uses stamina; release to recover."
                onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); input('burst-on'); }} onPointerUp={() => input('burst-off')} onPointerCancel={() => input('burst-off')} onLostPointerCapture={() => input('burst-off')}
                onBlur={() => input('burst-off')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input('burst-on'); } }} onKeyUp={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input('burst-off'); } }}>Burst<small>{bursting ? '+28% pace' : stamina < 1 ? 'Recovering' : 'Hold Shift'}</small></button>
        </div>
    </div>;
}
