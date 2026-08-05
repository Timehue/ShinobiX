import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
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
const inertSnapshots = new Map<HTMLElement, { inert: boolean; ariaHidden: string | null }>();

function syncModalBackgroundInert() {
  const bodyChildren = Array.from(document.body.children) as HTMLElement[];
  const backdrops = bodyChildren.filter((element) => element.classList.contains("ui-modal-backdrop"));
  const topmostBackdrop = backdrops.at(-1);

  if (!topmostBackdrop) {
    for (const [element, snapshot] of inertSnapshots) {
      if (!element.isConnected) continue;
      element.inert = snapshot.inert;
      if (snapshot.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", snapshot.ariaHidden);
    }
    inertSnapshots.clear();
    return;
  }

  for (const element of bodyChildren) {
    if (element === topmostBackdrop) {
      const snapshot = inertSnapshots.get(element);
      element.inert = snapshot?.inert ?? false;
      if (snapshot?.ariaHidden == null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", snapshot.ariaHidden);
      continue;
    }
    if (!inertSnapshots.has(element)) {
      inertSnapshots.set(element, {
        inert: element.inert,
        ariaHidden: element.getAttribute("aria-hidden"),
      });
    }
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  }
}

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
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  useBodyScrollLock(open);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Deliberately separate from the focus/key effect below so caller re-renders
  // cannot re-push an outer modal while an inner one is still open.
  useEffect(() => {
    if (!open) return;
    openModals.push(titleId);
    return () => {
      const at = openModals.indexOf(titleId);
      if (at >= 0) openModals.splice(at, 1);
    };
  }, [open, titleId]);

  useLayoutEffect(() => {
    if (!open) return;
    syncModalBackgroundInert();
    return () => {
      queueMicrotask(syncModalBackgroundInert);
    };
  }, [open]);

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
        onCloseRef.current();
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
      // The layout-effect cleanup removes inert in a microtask. Restore focus
      // immediately after that; focusing an inert opener is ignored by browsers.
      queueMicrotask(() => previouslyFocused?.focus());
    };
  }, [open, titleId]);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-modal-backdrop"
      role="presentation"
      onClick={disableBackdropClose ? undefined : onClose}
    >
      <div
        ref={cardRef}
        className={`ui-modal-card ui-modal-card--${size}${bare ? " ui-modal-card--bare" : ""} ${className}`.trim()}
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
        <div className={`ui-modal-body${bare ? " ui-modal-body--bare" : ""}`}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
