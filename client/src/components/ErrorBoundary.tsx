import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Name of the area being guarded ("Main content", "Point of Sale"). It appears in
   * the fallback and in the console log so a crash report says which screen broke.
   */
  section?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * AI Agent Note: without a boundary, one thrown render anywhere under the router
 * unmounts the whole tree and the user gets a blank white page with no way back.
 * Wrapping the routed content keeps the sidebar and the session alive: the user can
 * click another screen (App remounts the boundary per location) or retry in place.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No remote logger yet, so the component stack goes to the console — the only
    // place a support engineer can read it from.
    console.error(
      `[ErrorBoundary] ${this.props.section ?? "Application"} crashed:`,
      error,
      info.componentStack,
    );
  }

  private reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, section } = this.props;

    if (!error) {
      return children;
    }

    return (
      <div className="flex h-full items-center justify-center p-6" role="alert">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-destructive/40 bg-card p-6 text-card-foreground shadow-xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="space-y-1">
              <h1 className="text-lg font-semibold">
                {section ? `${section} could not be displayed` : "Something went wrong"}
              </h1>
              <p className="text-sm text-muted-foreground">
                The rest of the application is still running. Retry this screen, or reload
                the page if the problem persists.
              </p>
            </div>
          </div>

          <pre className="max-h-32 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">
            {error.message}
          </pre>

          <div className="flex gap-2">
            <Button onClick={this.reset} variant="secondary">
              <RotateCcw className="mr-2 h-4 w-4" />
              Try again
            </Button>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
