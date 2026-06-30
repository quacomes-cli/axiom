import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-base">
        <div className="flex max-w-sm flex-col items-center gap-6 px-6 text-center">
          {/* Logo */}
          <div className="relative">
            <div
              className="h-14 w-14 bg-text-faint"
              style={{
                WebkitMaskImage: "url('/logo.svg')",
                maskImage: "url('/logo.svg')",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }}
            />
            <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-danger/20">
              <span className="text-[0.7857rem] text-danger">!</span>
            </div>
          </div>

          {/* Text */}
          <div className="flex flex-col gap-2">
            <h1 className="text-base font-medium text-text">
              Sanırım bazı sorunlar var
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary">
              Beklenmeyen bir hata oluştu. Endişelenme, verilerinde bir kayıp
              yok — sayfayı yenileyerek devam edebilirsin.
            </p>
          </div>

          {/* Error detail */}
          {this.state.error && (
            <div className="w-full rounded-lg border border-border bg-surface px-3 py-2">
              <p className="break-all font-mono text-xs text-text-faint">
                {this.state.error.message}
              </p>
            </div>
          )}

          {/* Reload button */}
          <button
            onClick={this.handleReload}
            className="rounded-lg bg-surface-3 px-5 py-2.5 text-sm font-medium text-text transition-colors hover:bg-accent-hover"
          >
            Yeniden Başlat
          </button>
        </div>
      </div>
    );
  }
}
