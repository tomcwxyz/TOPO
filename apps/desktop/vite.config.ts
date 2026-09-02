import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Rust/Tauri build output contains Windows .pdb files that are locked while
      // cargo is compiling. Watching that directory can crash Vite with EBUSY.
      ignored: ["**/src-tauri/target/**"],
    },
  },
});
