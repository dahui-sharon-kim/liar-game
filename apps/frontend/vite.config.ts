import { defineConfig } from "vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  resolve: {
    tsconfigPaths: true,
  },
});
