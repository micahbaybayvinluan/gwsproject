import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Catches render errors in a page so the user sees a message and a retry button instead of a blank white screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Page crashed', error, info.componentStack); }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="mx-auto max-w-lg rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-semibold">This page hit an error.</p>
      <p className="mt-1 break-words text-xs text-red-700">{this.state.error.message || String(this.state.error)}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded bg-red-700 px-3 py-1.5 text-white" onClick={() => this.setState({ error: null })}>Try again</button>
        <button type="button" className="rounded border border-red-300 px-3 py-1.5" onClick={() => { window.location.href = '/'; }}>Go to dashboard</button>
      </div>
    </div>;
  }
}
