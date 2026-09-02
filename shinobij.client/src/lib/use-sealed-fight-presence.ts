/*
 * Sealed-fight presence — "is a server-authoritative fight on screen right now?"
 *
 * Both sealed hosts (components/StoryBossFightHost, components/AiFightHost) render
 * their fight in a BODY PORTAL, so App's `screen` never moves while one is up and
 * every screen-keyed guard reads back "not in a battle". That is how a story
 * chapter's own VN re-opened on top of the boss fight it had just launched: the
 * auto-trigger effect saw `screen === "village"`, re-offered the still-unconsumed
 * chapter (only a boss WIN consumes it), and painted over the live fight at
 * z-index 1000000. Picking a lane again simply restarted the loop, and Skip — the
 * one control that dismisses a scene for the session — revealed the battle that had
 * been running underneath all along. That is the reported "the visual novels just
 * repeat, and then Skip takes you to the battle".
 *
 * Two readings of the same fact, deliberately:
 *   • `engagedRef` — synchronous truth. A host announces from a CHILD effect, and
 *     React flushes child effects before the parent's in the same commit, so the
 *     App effect that would re-open the VN already sees the fight engaged. State
 *     cannot do this: it lands one render late, and one render late is exactly the
 *     window a launch opens.
 *   • `sealedFightOpen` — the render/dependency-visible mirror, so an effect gated
 *     on it re-runs when the fight ends and a genuinely pending scene can fire.
 *
 * Hosts announce from ACCEPTANCE, not from the opened session: the sealed start is
 * a network round-trip, and the VN trigger fires inside it.
 */
import { useCallback, useRef, useState } from "react";

export type SealedFightPresence = {
    /** A story-lane sealed fight (chapter boss / academy spar) is engaged. */
    storyFightOpen: boolean;
    /** Either host has a sealed fight engaged: accepted, starting, or on screen. */
    sealedFightOpen: boolean;
    /** `sealedFightOpen` read synchronously, before the state commit lands. */
    engagedRef: { readonly current: boolean };
    setStoryFightOpen: (open: boolean) => void;
    setAiFightOpen: (open: boolean) => void;
};

export function useSealedFightPresence(): SealedFightPresence {
    const [storyFightOpen, setStoryOpen] = useState(false);
    const [aiFightOpen, setAiOpen] = useState(false);
    const sidesRef = useRef({ story: false, ai: false });
    const engagedRef = useRef(false);
    const announce = useCallback((side: "story" | "ai", open: boolean, commit: (open: boolean) => void) => {
        sidesRef.current[side] = open;
        engagedRef.current = sidesRef.current.story || sidesRef.current.ai;
        commit(open);
    }, []);
    const setStoryFightOpen = useCallback((open: boolean) => announce("story", open, setStoryOpen), [announce]);
    const setAiFightOpen = useCallback((open: boolean) => announce("ai", open, setAiOpen), [announce]);
    return {
        storyFightOpen,
        sealedFightOpen: storyFightOpen || aiFightOpen,
        engagedRef,
        setStoryFightOpen,
        setAiFightOpen,
    };
}
