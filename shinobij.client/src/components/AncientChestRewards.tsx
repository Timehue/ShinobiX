import type { ReactNode } from 'react';
import { GiOpenTreasureChest } from './icons/LightweightGameIcons';

/** Reward presentation only; WorldMap retains receipt and continuation authority. */
export function AncientChestRewards({ replayed, rewards, onContinue }: {
    replayed: boolean;
    rewards: { icon: ReactNode; label: string; sub: string }[];
    onContinue: () => void;
}) {
    return <div className="card cinematic-card ancient-chest-reveal-card">
        <div className="chest-reveal">
            <div className="chest-reveal-content" role="region" aria-label="Chest reward details" tabIndex={0}>
                <div className="chest-reveal-header">
                    <p className="act-label"><GiOpenTreasureChest style={{ verticalAlign: '-0.14em', marginRight: '0.3rem' }} />ANCIENT CHEST CONTENTS</p>
                    <h2 className="chest-reveal-title">{replayed ? 'Previously saved chest' : 'Rewards saved'}</h2>
                    <p className="chest-reveal-sub">{replayed
                        ? 'These rewards were saved when this chest was first opened.'
                        : 'These rewards are saved to your character.'}</p>
                </div>
                <div className="chest-rewards">
                    {rewards.map((reward, index) => <div key={index} className="chest-reward-row">
                        <span className="chest-reward-icon">{reward.icon}</span>
                        <div className="chest-reward-text">
                            <strong>{reward.label}</strong>
                            <small>{reward.sub}</small>
                        </div>
                    </div>)}
                </div>
            </div>
            <button className="chest-claim-btn" onClick={onContinue}>Continue</button>
        </div>
    </div>;
}
