import { useState } from 'react';
import { StoryBossFightHost } from '../../src/components/StoryBossFightHost';
import { requestStoryBossFight, type StoryFightTheme } from '../../src/lib/story-fight-theme';
import type { Character } from '../../src/types/character';
import { GameAlertHost, GameConfirmHost } from '../../src/components/GameAlert';

export function TwinTrialQa() {
    const config = (window as unknown as { __TWIN_TRIAL_QA__: { character: Character; theme: StoryFightTheme } }).__TWIN_TRIAL_QA__;
    const [reward, setReward] = useState('No reward');
    return <><GameAlertHost /><GameConfirmHost /><button onClick={() => requestStoryBossFight(config.theme)}>Start twin trial</button>
        <output data-testid="twin-qa-reward">{reward}</output>
        <StoryBossFightHost character={config.character} sharedImages={{}} onSettled={result => setReward(`Chapter ${result.progress} saved`)} />
    </>;
}
