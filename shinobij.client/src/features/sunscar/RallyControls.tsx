import { useEffect } from 'react';
import type { RallyAction } from '../../../../shared/sunscar/rally-types';

export function RallyControls({ input, disabled, technique, techniqueUsed, stamina }: {
    input: (kind: RallyAction['kind']) => void; disabled: boolean; technique: string; techniqueUsed: boolean; stamina: number;
}) {
    useEffect(() => {
        const keys: Record<string, RallyAction['kind']> = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ShiftLeft: 'burst-on', ShiftRight: 'burst-on', KeyE: 'technique' };
        const down = (event: KeyboardEvent) => {
            if (disabled || !keys[event.code] || (event.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName))) return;
            event.preventDefault();
            if (!event.repeat && !disabled) input(keys[event.code]);
        };
        const up = (event: KeyboardEvent) => { if (event.code.startsWith('Shift')) { event.preventDefault(); input('burst-off'); } };
        const release = () => input('burst-off');
        window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', release);
        return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
    }, [disabled, input]);
    return <div className="rally-controls" aria-label="Race controls">
        <div className="rally-steering">
            <button type="button" aria-label="Steer left, A or Left Arrow" disabled={disabled} onPointerDown={e => { e.preventDefault(); input('left'); }} onClick={e => { if (e.detail === 0) input('left'); }}>←<small>A / ←</small></button>
            <button type="button" aria-label="Steer right, D or Right Arrow" disabled={disabled} onPointerDown={e => { e.preventDefault(); input('right'); }} onClick={e => { if (e.detail === 0) input('right'); }}>→<small>D / →</small></button>
        </div>
        <div className="rally-actions">
            <button type="button" className="rally-technique" disabled={disabled || techniqueUsed} aria-label={`${technique}, E`} onClick={() => input('technique')}>{techniqueUsed ? 'Used' : technique}<small>E · once per race</small></button>
            <button type="button" disabled={disabled} aria-label="Jump, Space" onPointerDown={e => { e.preventDefault(); input('jump'); }} onClick={e => { if (e.detail === 0) input('jump'); }}>Jump<small>Space</small></button>
            <button type="button" className="rally-burst" disabled={disabled || stamina < 1} aria-label="Hold Burst, Shift" onPointerDown={e => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); input('burst-on'); }} onPointerUp={() => input('burst-off')} onPointerCancel={() => input('burst-off')} onLostPointerCapture={() => input('burst-off')} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') input('burst-on'); }} onKeyUp={() => input('burst-off')}>Burst<small>Hold Shift</small></button>
        </div>
    </div>;
}
