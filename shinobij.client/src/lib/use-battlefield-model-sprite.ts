import { useEffect, useState } from 'react';
import type { PlayerModel } from '../../../shared/player-model-ref';
import { readSectorModelObject } from './sector-model-object';
import { useSectorModelArtBase } from './sector-obstacles';

async function readBattleSprite(folder: string, revision: string): Promise<ArrayBuffer | null> {
    const bytes = await readSectorModelObject(folder, `${revision}.json`, '.json', 128 * 1024);
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    if (manifest.format !== 'sector-motion-v2' || typeof manifest.battleSprite !== 'string') return null;
    return readSectorModelObject(folder, manifest.battleSprite, '.webp', 256 * 1024);
}

export function useBattlefieldModelSprite(model?: PlayerModel): string | null {
    const artBase = useSectorModelArtBase(!!model);
    const folder = artBase && model ? `${artBase.replace(/\/$/, '')}/players/${model.assetId}/` : '';
    const revision = model?.version;
    const key = folder && revision ? folder + revision : '';
    const [sprite, setSprite] = useState<{ key: string; url: string }>();

    useEffect(() => {
        if (!key || !revision) return;
        let active = true;
        let url: string | undefined;
        void readBattleSprite(folder, revision).then(bytes => {
            if (!active || !bytes) return;
            url = URL.createObjectURL(new Blob([bytes], { type: 'image/webp' }));
            setSprite({ key, url });
        }).catch(() => { /* Bundled art or the portrait remains available. */ });
        return () => {
            active = false;
            if (url) URL.revokeObjectURL(url);
        };
    }, [folder, key, revision]);

    return sprite && sprite.key === key ? sprite.url : null;
}
