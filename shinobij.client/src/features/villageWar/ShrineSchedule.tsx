import type { ShrineWindow } from '../../../../shared/village-war-campaign';

export function ShrineSchedule({ windows }: { windows: readonly ShrineWindow[] }) {
    return <details className='village-shrine-schedule'><summary>Locked shrine schedule · your local time</summary>
        <ol aria-label='Locked shrine windows'>{windows.map((window, day) => <li key={window.id}>
            Day {day + 1}: <time dateTime={new Date(window.opensAt).toISOString()}>{new Date(window.opensAt).toLocaleString()}</time>
            {' – '}<time dateTime={new Date(window.closesAt).toISOString()}>{new Date(window.closesAt).toLocaleString()}</time>
        </li>)}</ol>
    </details>;
}
