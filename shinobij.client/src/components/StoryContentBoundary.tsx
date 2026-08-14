import { Component, type ErrorInfo, type ReactNode } from "react";
import type { StoryContentVillage } from "../lib/story-content-contract";
import { resetStoryContent } from "../lib/story-content-loader";
import { StoryContentLoadError } from "../lib/story-content-loader-core";
import { reportError } from "../lib/sentry";

type Props = {
    village: StoryContentVillage;
    children: ReactNode;
    onReturn?: () => void;
};

type State = { error: StoryContentLoadError | null };

/** A narrow boundary for fetched story archives. Retry is deliberate: malformed
 * payloads remain failed until the player asks for a fresh, validated request. */
export class StoryContentBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: unknown): State {
        if (!(error instanceof StoryContentLoadError)) throw error;
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        reportError(error, { componentStack: info.componentStack, source: "story_content" });
    }

    private retry = (): void => {
        resetStoryContent(this.props.village);
        this.setState({ error: null });
    };

    private reloadLatest = (): void => { window.location.reload(); };

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        const staleDeployment = this.state.error.staleDeployment;
        return (
            <section className="summary-box" role="alert" aria-live="assertive">
                <h2>{staleDeployment ? "A newer game release is ready" : "Village chronicle unavailable"}</h2>
                <p>{staleDeployment
                    ? "This open game version points to a retired archive. Reload the latest game to continue; progress since your last completed save may be lost."
                    : "The archive could not be verified. No chapter, reward, or story choice was changed."}</p>
                <div className="menu">
                    {staleDeployment
                        ? <button type="button" onClick={this.reloadLatest}>Reload Latest Game</button>
                        : <button type="button" onClick={this.retry}>Retry Chronicle Load</button>}
                    {!staleDeployment && this.props.onReturn ? <button type="button" onClick={this.props.onReturn}>Return to Village</button> : null}
                </div>
            </section>
        );
    }
}
