import { useState } from 'react';
import { planSelectedCraftIngredients, type CraftMaterialSelection } from '../../../shared/crafting-recipes';
import type { BuildingMaterialRow } from '../../../shared/sector-building-types';

export function BuildingMaterialSelection({rows,busy,label,onConfirm,onCancel}:{rows:BuildingMaterialRow[];busy:boolean;label:string;onConfirm:(materials:CraftMaterialSelection)=>void;onCancel:()=>void}){
    const[selection,setSelection]=useState<Record<string,number>[]>(()=>rows.map(()=>({})));
    const owned=(id:string)=>rows.flatMap(row=>row.owned).find(item=>item.id===id)?.count??0;
    const ready=planSelectedCraftIngredients(rows,owned,1,selection)!==null;
    return<form className="building-material-selection" onSubmit={event=>{event.preventDefault();if(ready&&!busy)onConfirm(selection);}}>
        <p>Choose the exact materials to spend. Higher grades stay in your inventory unless you select them.</p>
        {rows.map((row,index)=><fieldset key={row.label}>
            <legend>{row.label} <span>{Object.values(selection[index]??{}).reduce((sum,n)=>sum+n,0)} / {row.count}</span></legend>
            {row.owned.filter(item=>item.count>0).length?row.owned.filter(item=>item.count>0).map(item=><label key={item.id}>
                <span>{item.name}<small>{item.count} owned</small></span>
                <input type="number" min={0} max={Math.min(item.count,row.count)} step={1} disabled={busy} value={selection[index]?.[item.id]??0}
                    aria-label={`${item.name} for ${row.label}`} onChange={event=>{const amount=Math.max(0,Math.floor(event.currentTarget.valueAsNumber||0));setSelection(old=>old.map((values,i)=>i===index?{...values,[item.id]:amount}:values));}}/>
            </label>):<p className="building-hint">No eligible stock. Obtain {row.label.toLowerCase()} through the existing gathering and hunting activities.</p>}
        </fieldset>)}
        <div className="building-actions"><button type="button" onClick={onCancel} disabled={busy}>Back to the counter</button><button type="submit" disabled={busy||!ready}>{busy?'Recording…':label}</button></div>
    </form>;
}
