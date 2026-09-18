import { useEffect, useRef } from 'react';

/** One-time entrances. Content is visible by default, even without observation. */
export function useLandingReveals() {
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || !('IntersectionObserver' in window)) return;
        const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-landing-reveal]'));
        const seen = new WeakSet<Element>();
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                seen.add(entry.target);
                if (!reducedMotion.matches) entry.target.classList.add('is-revealed');
                observer.unobserve(entry.target);
            }
        }, { rootMargin: '0px 0px -32px 0px', threshold: 0.08 });

        function syncMotion() {
            observer.disconnect();
            for (const element of elements) {
                element.classList.remove('is-revealed');
                // Never animate content already on screen (including restored
                // scroll positions), or replay a section the visitor has seen.
                if (element.getBoundingClientRect().top < window.innerHeight) seen.add(element);
                if (!reducedMotion.matches && !seen.has(element)) observer.observe(element);
            }
        }

        function revealFocusedContent(event: FocusEvent) {
            const target = event.target;
            if (!(target instanceof Element) || target === root) return;
            for (const element of elements) {
                if (!element.contains(target) && !target.contains(element)) continue;
                seen.add(element);
                observer.unobserve(element);
                element.classList.remove('is-revealed');
            }
        }

        syncMotion();
        reducedMotion.addEventListener('change', syncMotion);
        root.addEventListener('focusin', revealFocusedContent);
        return () => {
            observer.disconnect();
            reducedMotion.removeEventListener('change', syncMotion);
            root.removeEventListener('focusin', revealFocusedContent);
            for (const element of elements) element.classList.remove('is-revealed');
        };
    }, []);

    return rootRef;
}
