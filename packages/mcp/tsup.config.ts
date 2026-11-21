import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm", "cjs"],
  dts: {
    entry: "src/index.ts",
    // tsup's DTS worker chokes on composite project references.
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

