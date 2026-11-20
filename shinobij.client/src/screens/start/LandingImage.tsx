import { useEffect, useRef, type ImgHTMLAttributes } from 'react';

/** Keep the image's layout box while reserving cold-start bandwidth for the hero. */
export function LandingImage({ src, ...props }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
    const ref = useRef<HTMLImageElement>(null);
    useEffect(() => {
        const image = ref.current;
        if (!image) return;
        if (typeof IntersectionObserver === 'undefined') {
            image.src = src;
            return;
        }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                image.src = src;
                observer.disconnect();
            }
        }, { rootMargin: '240px' });
        observer.observe(image);
        return () => observer.disconnect();
    }, [src]);
    return <img {...props} ref={ref} decoding="async" />;
}
