import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import Landing from "./Landing.jsx";

const App = lazy(() => import("./App.jsx"));

/**
 * Resume-friendly landing at `/`.
 * Live interview UI loads when a room is present (?room=…) or ?app=1.
 */
function Root() {
  const params = new URLSearchParams(window.location.search);
  const showApp = params.has("room") || params.get("app") === "1";

  if (!showApp) return <Landing />;

  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100vh",
            display: "grid",
            placeItems: "center",
            background: "#0f1115",
            color: "#8a90a2",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          Opening room…
        </div>
      }
    >
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
