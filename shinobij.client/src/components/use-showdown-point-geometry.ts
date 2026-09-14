import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage } from 'three';

/** Keep the attribute attached until geometry disposal. Replacing a JSX
 * bufferAttribute with a fresh typed array on every UI render orphaned its
 * uploaded WebGL buffer; detaching it before disposal loses that owner too. */
export function useShowdownPointGeometry(count: number): BufferGeometry {
    const geometry = useMemo(() => {
        const value = new BufferGeometry();
        value.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3).setUsage(DynamicDrawUsage));
        return value;
    }, [count]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    return geometry;
}
