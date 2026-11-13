import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog, { trapDialogTabKey } from "../src/ui/ConfirmDialog";

function controls() {
  const make = (hidden = false) => ({
    hidden,
    tabIndex: 0,
    getClientRects: () => (hidden ? [] : [{}]),
    focus: vi.fn(),
  });
  const confirm = make(),
    cancel = make(),
    hidden = make(true);
  const root = {
    querySelectorAll: () => [confirm, hidden, cancel],
    ownerDocument: { activeElement: cancel as unknown },
    focus: vi.fn(),
  };
  return {
    confirm,
    cancel,
    hidden,
    root,
    dialog: root as unknown as HTMLDialogElement,
  };
}

describe("accessible confirmation dialog", () => {
  it("associates its visible title and explanation and retains a safe cancel choice", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        title: "Open breaker <B1>?",
        confirmLabel: "Confirm and re-solve",
        onCancel: () => {},
        onConfirm: () => {},
        confirmDisabled: true,
        children: createElement("p", {}, "Only the simulated study changes."),
      }),
    );
    expect(html).toContain("<dialog");
    expect(html).toContain("Open breaker &lt;B1&gt;?");
    const title = html.match(/aria-labelledby="([^"]+)"/)?.[1],
      description = html.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(title).toBeTruthy();
    expect(html).toContain(`<h2 id="${title}">`);
    expect(html).toContain(`<div id="${description}">`);
    expect(html).toMatch(
      /<button[^>]+disabled=""[^>]*>Confirm and re-solve<\/button>/,
    );
    expect(html).toContain("<button>Cancel</button>");
  });
  it("wraps Tab from the last control and reverse Tab from the first without focusing hidden content", () => {
    const { confirm, cancel, hidden, root, dialog } = controls();
    const preventDefault = vi.fn();
    trapDialogTabKey(dialog, { key: "Tab", shiftKey: false, preventDefault });
    expect(confirm.focus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(hidden.focus).not.toHaveBeenCalled();
    root.ownerDocument.activeElement = confirm;
    trapDialogTabKey(dialog, { key: "Tab", shiftKey: true, preventDefault });
    expect(cancel.focus).toHaveBeenCalledOnce();
  });
  it("leaves ordinary tab order and activation keys to the browser and recovers focus that escaped", () => {
    const { confirm, root, dialog } = controls();
    const preventDefault = vi.fn();
    root.ownerDocument.activeElement = confirm;
    trapDialogTabKey(dialog, { key: "Tab", shiftKey: false, preventDefault });
    trapDialogTabKey(dialog, { key: "Enter", shiftKey: false, preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    root.ownerDocument.activeElement = null;
    trapDialogTabKey(dialog, { key: "Tab", shiftKey: false, preventDefault });
    expect(confirm.focus).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
