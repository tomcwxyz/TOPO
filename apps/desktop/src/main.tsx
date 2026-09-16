import React from "react";
import ReactDOM from "react-dom/client";
import { CalmApp } from "./CalmApp";
import { SetupGate } from "./SetupGate";
import "./styles.css";
import "./memory-pages.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SetupGate>
      <CalmApp />
    </SetupGate>
  </React.StrictMode>,
);
