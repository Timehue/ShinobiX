import { Component, type ErrorInfo, type ReactNode } from "react";
import { resetStoryFieldContent } from "../lib/story-field-content-loader";
import { resetStoryRoadContent } from "../lib/story-road-content-loader";
import { StoryFieldContentLoadError } from "../lib/story-field-content-loader-core";
import { reportError } from "../lib/sentry";

type Props = { children: ReactNode; onReturn: () => void };
type State = { error: StoryFieldContentLoadError | null };

/** Keeps a missing or stale personal-journey asset from taking down WorldMap. */
export class StoryFieldContentBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: unknown): State {
        if (!(error instanceof StoryFieldContentLoadError)) throw error;
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        reportError(error, { componentStack: info.componentStack, source: "story_field_content" });
    }

    private retry = (): void => {
        resetStoryFieldContent();
        resetStoryRoadContent();
        this.setState({ error: null });
    };

    render(): ReactNode {
        if (!this.state.error) return this.props.children;
        const stale = this.state.error.staleDeployment;
        return <section className="summary-box" role="alert" aria-live="assertive">
            <h2>{stale ? "A newer game release is ready" : "Personal journey unavailable"}</h2>
            <p>{stale
                ? "This open game version points to a retired journey record. Reload the latest game to continue."
                : "The journey record could not be verified. No destination, choice, or reward was changed."}</p>
            <div className="menu">
                {stale
                    ? <button type="button" onClick={() => window.location.reload()}>Reload Latest Game</button>
                    : <button type="button" onClick={this.retry}>Retry Journey Load</button>}
                <button type="button" onClick={this.props.onReturn}>Return to Village</button>
            </div>
        </section>;
    }
}
