import { Component, type ReactNode } from "react";
import { colors, fonts } from "./theme";

type Props = {
  children: ReactNode;
  fallbackMessage?: string;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: colors.bg,
            color: colors.text,
            fontFamily: fonts.mono,
            padding: 32,
            gap: 16,
          }}
        >
          <div style={{ color: colors.accent, fontSize: 16, fontWeight: "bold" }}>
            {this.props.fallbackMessage ?? "Something went wrong"}
          </div>
          <pre
            style={{
              color: colors.textDim,
              fontSize: 12,
              maxWidth: 600,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "rgba(255,255,255,0.05)",
              padding: 16,
              borderRadius: 4,
            }}
          >
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: colors.accent,
              color: "#fff",
              border: "none",
              borderRadius: 4,
              padding: "8px 24px",
              fontFamily: fonts.mono,
              fontSize: 13,
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
