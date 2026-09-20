import { useState } from 'react';

/** Key this leaf by source to retry changed artwork without remounting a marker. */
export function SectorPortrait({ src, name }: { src?: string; name: string }) {
    const [failed, setFailed] = useState(false);
    return <>
        <span className="sector-avatar-initials">{name.slice(0, 2).toUpperCase()}</span>
        {src && !failed && <img src={src} alt="" style={{position:'absolute',inset:0}}
            onError={() => setFailed(true)} />}
    </>;
}
