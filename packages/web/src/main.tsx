import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "react-error-boundary";
import { Route, Router, Switch } from "wouter";
import { handleError, RootErrorFallback } from "./components/ErrorFallback.js";
import { initSentry } from "./lib/sentry.js";
import { Landing } from "./screens/Landing.js";
import { PersonApp } from "./screens/PersonApp.js";
import "./index.css";

initSentry();

function App() {
  return (
    <ErrorBoundary FallbackComponent={RootErrorFallback} onError={handleError}>
      <Router>
        <Switch>
          <Route path="/p/:token" nest>
            <PersonApp />
          </Route>
          <Route path="/" component={Landing} />
          <Route>
            <div className="flex items-center justify-center min-h-screen">
              <p className="text-text-muted">Page not found</p>
            </div>
          </Route>
        </Switch>
      </Router>
    </ErrorBoundary>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
