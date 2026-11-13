import { useId, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
}

export function trapDialogTabKey(
  container: HTMLDialogElement,
  event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">,
): void {
  if (event.key !== "Tab") return;
  const controls = [
    ...container.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter(
    (control) =>
      !control.hidden &&
      control.getClientRects().length > 0 &&
      control.tabIndex >= 0,
  );
  const first = controls[0],
    last = controls.at(-1),
    active = container.ownerDocument.activeElement;
  if (!first) {
    event.preventDefault();
    container.focus();
  } else if (
    event.shiftKey &&
    (active === first || !controls.some((control) => control === active))
  ) {
    event.preventDefault();
    last?.focus();
  } else if (
    !event.shiftKey &&
    (active === last || !controls.some((control) => control === active))
  ) {
    event.preventDefault();
    first.focus();
  }
}

/** Native modal semantics make the rest of the document inert; Cancel receives initial focus. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const titleId = useId(),
    descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null),
    cancel = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!element) return;
    element.showModal();
    cancel.current?.focus();
    return () => {
      if (element.open) element.close();
      if (opener?.isConnected) opener.focus();
      else
        document
          .querySelector<HTMLElement>(
            "main button:not(:disabled), nav button:not(:disabled)",
          )
          ?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="panel confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      style={{
        maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 32px)",
        overflow: "auto",
      }}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => trapDialogTabKey(event.currentTarget, event)}
    >
      <h2 id={titleId}>{title}</h2>
      <div id={descriptionId}>{children}</div>
      <div className="button-row">
        <button
          className="primary"
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button ref={cancel} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
