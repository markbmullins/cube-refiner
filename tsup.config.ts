import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/cli/index.ts"],
  external: ["node:sqlite"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node24"
});
