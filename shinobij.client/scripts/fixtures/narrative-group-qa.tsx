import { useState } from 'react';
import { AiFightHost } from '../../src/components/AiFightHost';
import { requestAiFight, type AiFightRequest } from '../../src/lib/ai-fight-request';
import type { Character } from '../../src/types/character';
import { GameAlertHost, GameConfirmHost } from '../../src/components/GameAlert';

export function NarrativeGroupQa() {
    const config = (window as unknown as { __GROUP_QA__: { character: Character; request: AiFightRequest } }).__GROUP_QA__;
    const [status, setStatus] = useState('No reward');
    return <><GameAlertHost /><GameConfirmHost /><button onClick={() => requestAiFight(config.request)}>Start group encounter</button>
        <output data-testid="group-qa-result">{status}</output>
        <AiFightHost character={config.character} sharedImages={{}} onSettled={() => setStatus('Saved')} onClose={() => setStatus('Closed')} />
    </>;
}
