import {useState} from 'react';
import {clanCampaignSeasonKey,type ClanCampaignRecord,type ClanCampaignPrestige} from '../../../shared/clan-campaign-history';
import {GameArtIcon} from './GameArtIcon';
export function ClanCampaignHistory({history=[],prestige}:{history?:ClanCampaignRecord[];prestige?:ClanCampaignPrestige}) {
    const [season]=useState(()=>clanCampaignSeasonKey(Date.now()));const current=prestige?.seasons?.[season];
    return <section className="summary-box"><h3><GameArtIcon kind="crown" size={20}/> Campaign Record</h3>
        <p>{season} · {current?.points??0} prestige · {current?.wins??0} wins · {current?.draws??0} draws</p>
        <p className="hint">Quarterly seasons: a played campaign victory earns 3 prestige; a draw earns 1. Three seasonal wins earn a clan banner.</p>
        {prestige?.earnedBanners?.includes(`campaign-victor:${season}`)&&<p className="clan-campaign-result"><GameArtIcon kind="crown" size={18}/> Campaign Victor · {season}</p>}
        {!history.length?<p className="hint">Your first finished campaign will start the clan’s rivalry record.</p>:<details><summary>Recent campaigns · {history.length}</summary><div className="clan-campaign-history">{history.slice(0,12).map(entry=><article key={entry.instanceId}>
            <h4>{entry.result} · vs {entry.opponent}</h4><p>{entry.points.toLocaleString()} – {entry.enemyPoints.toLocaleString()} War Points</p><small>{entry.normalPoints} normal · {entry.shrinePoints} shrine · {entry.played} battles · {new Date(entry.endedAt).toLocaleDateString()}{entry.mvp?` · MVP ${entry.mvp}`:''}</small>
        </article>)}</div></details>}</section>;
}
