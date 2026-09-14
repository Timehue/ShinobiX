import { Suspense, type ReactNode } from "react";
import { readStoryFieldContent } from "../lib/story-field-content-loader";
import { preloadStoryRoadContent, readStoryRoadContent } from "../lib/story-road-content-loader";
import { StoryFieldContentBoundary } from "./StoryFieldContentBoundary";

function StoryFieldContentGate({ children }: { children: ReactNode }) {
    preloadStoryRoadContent();
    readStoryFieldContent();
    readStoryRoadContent();
    return children;
}

export function StoryFieldRouteBoundary({ children, onReturn }: { children: ReactNode; onReturn: () => void }) {
    return <StoryFieldContentBoundary onReturn={onReturn}>
        <Suspense fallback={<div className="loading-screen" role="status">Opening personal journey…</div>}>
            <StoryFieldContentGate>{children}</StoryFieldContentGate>
        </Suspense>
    </StoryFieldContentBoundary>;
}
