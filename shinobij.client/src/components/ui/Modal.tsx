import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "../../lib/useBodyScrollLock";
import { CloseButton } from "./CloseButton";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Hide the default header (title + close). Caller renders its own chrome. */
  bare?: boolean;
  /** Disable closing on backdrop click (e.g. required choices). */
  disableBackdropClose?: boolean;
  className?: string;
  children: ReactNode;
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
  size = "md",
  bare = false,
  disableBackdropClose = false,
  className = "",
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open) return;
    // Remember what had focus so we can restore it when the dialog closes —
    // otherwise keyboard/SR users are dumped at the top of the page.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const card = cardRef.current;

    // Move focus into the dialog on open (first focusable, else the card).
    const focusables = () =>
      Array.from(card?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
    (focusables()[0] ?? card)?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      // Trap Tab within the dialog so focus can't wander to the page behind it.
      if (e.key === "Tab" && card) {
        const items = focusables();
        if (items.length === 0) {
          e.preventDefault();
          card.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === card)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-modal-backdrop"
      role="presentation"
      onClick={disableBackdropClose ? undefined : onClose}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className={`ui-modal-card ui-modal-card--${size} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {!bare && (
          <div className="ui-modal-header">
            {title != null ? <h2 className="ui-modal-title">{title}</h2> : <span />}
            <CloseButton onClick={onClose} />
          </div>
        )}
        <div className={bare ? "" : "ui-modal-body"}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
