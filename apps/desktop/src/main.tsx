import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { SetupGate } from "./SetupGate";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SetupGate>
      <App />
    </SetupGate>
  </React.StrictMode>,
);
