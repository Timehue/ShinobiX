import {
  KEEPER_PATH_ACTS,
  KEEPER_PATH_CHRONICLE_POINTS,
  KEEPER_PATH_RESOLVE,
} from "../../../shared/keeper-path-contract";
import "../styles/keeper-path-entrance.css";
import type { Ref } from "react";

export function KeeperPathEntrance({ busy, onEnter, buttonRef }: {
  busy: boolean;
  onEnter: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <section className="chronicle-panel keeper-path-entrance" aria-labelledby="keeper-path-entrance-title">
      <div className="keeper-path-entrance__art">
        <img
          src="/chronicle/keeper-path-entrance-v1.webp"
          alt="A masked Keeper awaits at a lantern-lit gate, where mountain paths lead to distant shrines."
          width={1400}
          height={636}
          decoding="async"
        />
        <span className="keeper-path-entrance__art-label">A Chronicle expedition</span>
      </div>
      <div className="keeper-path-entrance__content">
        <p className="keeper-path-entrance__eyebrow">Solo card adventure</p>
        <h2 id="keeper-path-entrance-title">Keeper's Path</h2>
        <p className="keeper-path-entrance__intro" id="keeper-path-entrance-summary">
          One deck. Three acts. A path of your choosing.
        </p>
        <p className="keeper-path-entrance__description">
          Challenge the Keepers, brave Elite duels, or seek a Shrine.
          Collect boons along the way to shape your deck for the battles ahead.
        </p>
        <ul className="keeper-path-entrance__facts" aria-label="Run rules">
          <li><strong>{KEEPER_PATH_ACTS}</strong> acts</li>
          <li><strong>{KEEPER_PATH_RESOLVE}</strong> Resolve</li>
          <li>Boons last the run</li>
        </ul>
        <p className="keeper-path-entrance__stakes">
          Each loss costs one Resolve. Lose them all and the run ends.
        </p>
        <div className="keeper-path-entrance__footer">
          <p className="keeper-path-entrance__reward">
            <strong>{KEEPER_PATH_CHRONICLE_POINTS} Chronicle Points</strong>
            <span>for a full clear · paid once per day</span>
          </p>
          <button
            ref={buttonRef}
            type="button"
            className="keeper-path-entrance__enter"
            disabled={busy}
            onClick={onEnter}
            aria-describedby="keeper-path-entrance-summary keeper-path-entrance-note"
          >
            Walk the Keeper's Path <span aria-hidden="true">→</span>
          </button>
        </div>
        <p className="keeper-path-entrance__note" id="keeper-path-entrance-note">
          Open the expedition to begin a new run or continue your current one.
        </p>
      </div>
    </section>
  );
}
