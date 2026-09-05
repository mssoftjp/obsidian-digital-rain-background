import esbuild from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await Promise.all([
  copyFile("manifest.json", "dist/manifest.json"),
  copyFile("styles.css", "dist/styles.css"),
]);
await esbuild.build({
  entryPoints: ["src/main.js"],
  bundle: true,
  outfile: "dist/main.js",
  format: "cjs",
  platform: "browser",
  target: "es2018",
  minify: false,
  external: ["obsidian"],
});
