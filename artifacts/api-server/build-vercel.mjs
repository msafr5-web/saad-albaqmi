import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const dir = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.resolve(dir, "src/vercel.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: path.resolve(dir, "dist/vercel.mjs"),
  external: ["pg-native"],
  logLevel: "info",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
