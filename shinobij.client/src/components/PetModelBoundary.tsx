/*
 * PetModelBoundary — keeps one pet's failed 3D model from taking down the
 * screen it is standing on.
 *
 * A missing or corrupt GLB makes useGLTF THROW rather than suspend, and the
 * throw travels straight past <Suspense> to the nearest error boundary. In the
 * Coliseum that boundary was ScreenErrorBoundary, so a single 404'd model
 * replaced the whole battle with the "This screen hit a snag" card. That is how
 * the stage-0 starters broke the Pet Coliseum for every new player when they
 * were missing from the .dockerignore allowlist (scripts/pet-model-shipping.test.ts
 * now guards the shipping side).
 *
 * IntroCompanion3D solves this by wrapping its whole <Canvas>. The Coliseum
 * cannot: every fighter shares ONE canvas, so a canvas-level boundary would
 * still blank the entire arena over one bad pet. This boundary therefore lives
 * INSIDE the r3f tree, around a single combatant's model.
 *
 * Because it renders inside the canvas, `fallback` must be an r3f node or null —
 * never DOM. It defaults to null: the caller is expected to use `onFail` to fall
 * back to its own 2D standee path, which is the same path pets with no approved
 * model already take.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
    children: ReactNode;
    /** Fired once when the model fails, so the caller can switch to 2D art.
     *  Omit where rendering nothing is already the right degrade (a portrait). */
    onFail?: () => void;
    /** Rendered for the commit(s) before `onFail` takes effect. r3f nodes only. */
    fallback?: ReactNode;
};

type State = { failed: boolean };

export class PetModelBoundary extends Component<Props, State> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        // Warn, don't report: a missing model is a content/shipping problem, and
        // one 404 would otherwise fire once per frame-driven remount.
        console.warn("[pet-model] 3D model failed; falling back to 2D art", error, info?.componentStack);
        this.props.onFail?.();
    }

    render(): ReactNode {
        return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
    }
}
