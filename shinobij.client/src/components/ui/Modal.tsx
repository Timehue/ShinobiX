import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../../lib/useBodyScrollLock";
import { CloseButton } from "./CloseButton";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Accessible name for a bare dialog whose visible title is rendered by the caller. */
  ariaLabel?: string;
  size?: "sm" | "md" | "lg";
  /** Hide the default header (title + close). Caller renders its own chrome. */
  bare?: boolean;
  /** Disable closing on backdrop click (e.g. required choices). */
  disableBackdropClose?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * Open-modal stack, innermost last. Every Modal listens for Escape on `window`,
 * and `stopPropagation` does NOT stop sibling listeners on that same target —
 * so without this, one Escape closed every nested modal at once (e.g. reading a
 * card on top of an open Graveyard pile shut both). Only the topmost entry
 * reacts. Registration order is mount order, so a modal opened on top of
 * another registers later and wins.
 */
const openModals: string[] = [];

/**
 * Canonical modal. Portals to <body> (escapes the side-rail stacking context),
 * locks body scroll, closes on Escape + backdrop click. Replaces the 6 ad-hoc
 * modal/overlay patterns previously scattered across screens.
 */
export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  size = "md",
  bare = false,
  disableBackdropClose = false,
  className = "",
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useBodyScrollLock(open);

  // Deliberately separate from the focus/key effect below: that one depends on
  // `onClose`, which callers routinely pass as an inline arrow, so it re-runs
  // on every parent render. Re-running this one would re-push an outer modal
  // to the top of the stack while an inner one is still open.
  useEffect(() => {
    if (!open) return;
    openModals.push(titleId);
    return () => {
      const at = openModals.indexOf(titleId);
      if (at >= 0) openModals.splice(at, 1);
    };
  }, [open, titleId]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const focusableSelector = [
      "button:not([disabled])",
      "[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const focusables = () => Array.from(card?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
    (focusables()[0] ?? card)?.focus();

    function onKey(e: KeyboardEvent) {
      // Only the topmost modal handles keys: Escape must close just the one on
      // top, and an outer modal's focus trap must not fight the inner one for
      // Tab while it is open.
      if (openModals[openModals.length - 1] !== titleId) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab") {
        const items = focusables();
        if (!items.length) {
          e.preventDefault();
          card?.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open, onClose, titleId]);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-modal-backdrop"
      role="presentation"
      onClick={disableBackdropClose ? undefined : onClose}
    >
      <div
        ref={cardRef}
        className={`ui-modal-card ui-modal-card--${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null ? titleId : undefined}
        aria-label={title == null ? (ariaLabel ?? "Dialog") : undefined}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {!bare && (
          <div className="ui-modal-header">
            {title != null ? <h2 id={titleId} className="ui-modal-title">{title}</h2> : <span />}
            <CloseButton onClick={onClose} />
          </div>
        )}
        <div className={bare ? "" : "ui-modal-body"}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
