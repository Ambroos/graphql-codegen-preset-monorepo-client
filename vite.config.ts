import { defineConfig } from "vite";
import dts from "vite-plugin-dts";
import { externalizeDeps } from "vite-plugin-externalize-deps";

export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: "./src/index.ts",
      formats: ["es", "cjs"],
      fileName: "index",
    },
  },
  plugins: [
    dts({
      entryRoot: "./src",
      insertTypesEntry: true,
    }),
    externalizeDeps(),
  ],
});
