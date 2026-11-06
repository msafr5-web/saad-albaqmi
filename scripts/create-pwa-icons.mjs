// Rasterizes the brand tile (public/logo.svg) into the PWA PNG icons. Requires ImageMagick.
import { execFileSync } from "node:child_process";
const dir = new URL("../artifacts/saad-albaqmi/public/", import.meta.url).pathname;
for (const n of [192, 512]) {
  execFileSync("magick", ["-background", "none", "-density", "384", `${dir}logo.svg`, "-resize", `${n}x${n}`, `${dir}icons/icon-${n}.png`]);
}
