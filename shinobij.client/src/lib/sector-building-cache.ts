import type { BuildingDetailView, BuildingWorldView, BuildingWorkView, SectorBuilding, SectorBuildingProgress } from '../../../shared/sector-building-types';

export type BuildingCache = {
    player:string;
    details:Record<string,BuildingDetailView>;
    progress?:SectorBuildingProgress;
    work?:BuildingWorkView;
    activeBuilding?:SectorBuilding;
    version:number;
};

/** Save versions order personal projections; communal revisions independently
 * prevent a late replica read from reversing another player's visible work. */
export function mergeBuildingView(old:BuildingCache,view:BuildingWorldView,player:string):BuildingCache{
    if(old.player===player&&old.version>view.saveVersion)return old;
    const details=old.player===player?{...old.details}:{};
    for(const detail of view.buildings){
        const previous=details[detail.building.id];
        details[detail.building.id]=previous&&previous.shared.revision>detail.shared.revision?{...detail,shared:previous.shared}:detail;
    }
    return{player,details,progress:view.progress,work:view.work,activeBuilding:view.activeBuilding,version:view.saveVersion};
}
