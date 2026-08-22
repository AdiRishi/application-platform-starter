import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rolldownOptions: {
      external: ["cloudflare:workers"],
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [devtools(), tailwindcss(), tanstackStart(), viteReact()],
});
