import { Component, type ErrorInfo, type ReactNode } from 'react';
import { clearAllCaptures } from '../../storage/captureStore';

interface Props {
  children: ReactNode;
}

interface State {
  errorMessage: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { errorMessage: null };

  static getDerivedStateFromError(error: Error): State {
    return { errorMessage: error?.message || 'Unexpected rendering error.' };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('StyleLens UI ErrorBoundary caught:', error, info);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleResetHistory = async () => {
    await clearAllCaptures().catch(() => {});
    window.location.reload();
  };

  render() {
    if (!this.state.errorMessage) {
      return this.props.children;
    }

    return (
      <div className="sl-stealth-canvas flex h-screen flex-col items-center justify-center p-6 text-center text-zinc-100">
        <div className="sl-card max-w-xs space-y-4 rounded-xl p-5">
          <h1 className="text-[15px] font-semibold text-white">StyleLens hit a snag</h1>
          <p className="sl-mono break-words text-[11px] text-zinc-400">
            {this.state.errorMessage}
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="sl-btn-white rounded-lg py-2 text-[12.5px]"
            >
              Reload Panel
            </button>
            <button
              type="button"
              onClick={() => void this.handleResetHistory()}
              className="sl-btn-carbon rounded-lg py-2 text-[12px]"
            >
              Clear Saved Captures &amp; Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
