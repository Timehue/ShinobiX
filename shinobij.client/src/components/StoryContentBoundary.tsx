import { Component, type ErrorInfo, type ReactNode } from "react";
import type { StoryContentVillage } from "../lib/story-content-contract";
import { resetStoryContent } from "../lib/story-content-loader";
import { StoryContentLoadError } from "../lib/story-content-loader-core";
import { reportError } from "../lib/sentry";

type BoundaryProps = {
    /** Clears both cache layers so Retry issues a fresh, validated request. */
    reset: () => void;
    title: string;
    body: string;
    retryLabel: string;
    returnLabel?: string;
    children: ReactNode;
    onReturn?: () => void;
};

type State = { error: StoryContentLoadError | null };

/** A narrow boundary for fetched story archives. Retry is deliberate: malformed
 * payloads remain failed until the player asks for a fresh, validated request. */
export class ContentLoadBoundary extends Component<BoundaryProps, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: unknown): State {
        if (!(error instanceof StoryContentLoadError)) throw error;
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        reportError(error, { componentStack: info.componentStack, source: "story_content" });
    }

    private retry = (): void => {
        this.props.reset();
        this.setState({ error: null });
    };

    private reloadLatest = (): void => { window.location.reload(); };

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        const staleDeployment = this.state.error.staleDeployment;
        return (
            <section className="summary-box" role="alert" aria-live="assertive">
                <h2>{staleDeployment ? "A newer game release is ready" : this.props.title}</h2>
                <p>{staleDeployment
                    ? "This open game version points to a retired archive. Reload the latest game to continue; progress since your last completed save may be lost."
                    : this.props.body}</p>
                <div className="menu">
                    {staleDeployment
                        ? <button type="button" onClick={this.reloadLatest}>Reload Latest Game</button>
                        : <button type="button" onClick={this.retry}>{this.props.retryLabel}</button>}
                    {!staleDeployment && this.props.onReturn ? <button type="button" onClick={this.props.onReturn}>{this.props.returnLabel ?? "Go Back"}</button> : null}
                </div>
            </section>
        );
    }
}

/** The village-chronicle boundary, unchanged API: the generic boundary with the
 * village loader's reset and copy. */
export function StoryContentBoundary({ village, children, onReturn }: {
    village: StoryContentVillage;
    children: ReactNode;
    onReturn?: () => void;
}) {
    return (
        <ContentLoadBoundary
            reset={() => resetStoryContent(village)}
            title="Village chronicle unavailable"
            body="The archive could not be verified. No chapter, reward, or story choice was changed."
            retryLabel="Retry Chronicle Load"
            returnLabel="Return to Village"
            onReturn={onReturn}
        >
            {children}
        </ContentLoadBoundary>
    );
}
