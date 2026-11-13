import { createRoot } from "react-dom/client";
import App from "./App";
import WorkspaceBoundary from "./ui/WorkspaceBoundary";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <WorkspaceBoundary>
    <App />
  </WorkspaceBoundary>,
);
