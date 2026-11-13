import { Component, type ReactNode } from "react";

/** A deployment can replace a lazy chunk while an old tab is still open. */
export default class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="panel empty-state" role="alert">
        <h1>The workspace could not load.</h1>
        <p>
          A connection interruption or an application update may have
          interrupted this view.
        </p>
        <p>Reload to reopen the latest case saved in this browser.</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload workspace
        </button>
      </main>
    );
  }
}
