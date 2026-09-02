import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
    children: ReactNode;
    fallback?: ReactNode;
    onFail?: (error: Error) => void;
};

type State = { failed: boolean };

/** Isolates one battle canvas so a renderer failure cannot blank the game screen. */
export class PetBattleRenderBoundary extends Component<Props, State> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.warn("[pet-battle-render] arena renderer failed; preserving the resolved battle", error, info?.componentStack);
        this.props.onFail?.(error);
    }

    render(): ReactNode {
        return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
    }
}
