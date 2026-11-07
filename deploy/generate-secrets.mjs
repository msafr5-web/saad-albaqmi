// Creates deploy/secrets.env from the template and fills every secret that can be generated locally.
// Existing values are never overwritten, so it is safe to run again. Nothing is printed, nothing leaves your machine.
//   node deploy/generate-secrets.mjs
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(dir, "secrets.env");
const source = fs.existsSync(target) ? target : path.join(dir, "secrets.template.env");
const GENERATED = { DB_PASSWORD: () => crypto.randomBytes(16).toString("hex"), OTP_HMAC_SECRET: () => crypto.randomBytes(32).toString("hex"), CARD_HMAC_SECRET: () => crypto.randomBytes(32).toString("hex") };

let filled = [];
const out = fs.readFileSync(source, "utf8").split(/\r?\n/).map((line) => {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && GENERATED[m[1]] && !m[2].trim()) { filled.push(m[1]); return `${m[1]}=${GENERATED[m[1]]()}`; }
  return line;
}).join("\n");
fs.writeFileSync(target, out, { mode: 0o600 });
const missing = out.split("\n").filter((l) => /^(DOMAIN|LETSENCRYPT_EMAIL|SSH_KEY_PATH|SMTP_PASSWORD|CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY|VITE_CLERK_PUBLISHABLE_KEY|ORG_OWNER_EMAIL|RESEND_API_KEY|RESEND_FROM_EMAIL)=\s*$/.test(l)).map((l) => l.split("=")[0]);
console.log(`deploy/secrets.env ready. Generated now: ${filled.join(", ") || "(none, already present)"}`);
console.log(missing.length ? `Still to fill by you: ${missing.join(", ")}` : "All required values are filled.");
