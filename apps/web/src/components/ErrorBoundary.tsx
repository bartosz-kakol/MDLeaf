import { Component, type ReactNode } from 'react';

/** Per-pane error boundary. */
export class PaneBoundary extends Component<{ children: ReactNode; name: string }, { error: Error | null; key: number }> {
  override state = { error: null as Error | null, key: 0 };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error(`[mdleaf] ${this.props.name} crashed`, error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-fg-muted">
          <p>Something went wrong in this panel.</p>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-fg hover:bg-bg-hover"
            onClick={() => this.setState((s) => ({ error: null, key: s.key + 1 }))}
          >
            Reload panel
          </button>
        </div>
      );
    }
    return (
      <div key={this.state.key} className="contents">
        {this.props.children}
      </div>
    );
  }
}
