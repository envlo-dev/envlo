import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "parser/index": "src/parser/index.ts",
  },
  format: ["esm", "cjs"],
  dts: {
    // tsup's DTS worker chokes on composite project references with multi-entry builds.
    compilerOptions: {
      composite: false,
      declarationMap: true,
    },
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "es2022",
  outDir: "dist",
});
