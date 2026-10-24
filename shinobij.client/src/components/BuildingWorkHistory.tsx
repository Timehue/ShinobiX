import type { SectorBuildingProgress } from '../../../shared/sector-building-types';

export function BuildingWorkHistory({progress}:{progress?:SectorBuildingProgress}){
    return <section className="building-work-history" aria-label="Saved road book">
        <h3>Your road record</h3>
        <p>{progress?.repairs??0} repairs · {progress?.deliveries??0} deliveries · {progress?.watches??0} watch rounds · {progress?.surveys??0} field accounts</p>
        {!!progress?.titles.length&&<p><strong>Counter distinctions:</strong> {progress.titles.join(' · ')}</p>}
        <details><summary>Recent counter receipts ({progress?.receipts.length??0})</summary>
            <p className="building-hint">The road book keeps your last 80 counter actions. Completed deeds and local trust remain after older receipts leave the book.</p>
            {progress?.receipts.length?[...progress.receipts].reverse().map(receipt=><article key={receipt.id}>
                <h4>{receipt.buildingName??receipt.buildingId.replaceAll('-',' ')}</h4>
                <small>{new Date(receipt.at).toLocaleString()}{receipt.sector?` · Sector ${receipt.sector}`:''}</small>
                <p>{receipt.message}</p>
                {!!(receipt.reward.ryo||receipt.reward.boneCharms||receipt.reward.fateShards)&&<p>{receipt.reward.ryo} ryo · {receipt.reward.boneCharms} bone charms · {receipt.reward.fateShards} fate shards</p>}
            </article>):<p>No counter receipts yet. Speak to a keeper or accept work to start your record.</p>}
        </details>
    </section>;
}
