// Quick checks that catch a broken deploy before it happens: every JavaScript file parses,
// settings.json is valid and has the fields the app needs, and every file the server lists
// as part of the page exists. Run with: node scripts/check.js
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const problems = [];

const jsFiles = (dir) =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (["node_modules", "vendor", ".git"].includes(e.name) ? [] : jsFiles(path.join(dir, e.name))) : e.name.endsWith(".js") ? [path.join(dir, e.name)] : [],
  );
const files = ["server.js", ...jsFiles("public"), ...jsFiles("scripts"), ...jsFiles("test"), ...(existsSync(path.join(root, "eval")) ? jsFiles("eval") : [])];
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  } catch (err) {
    problems.push(`${file} has a syntax error:\n${String(err.stderr).trim()}`);
  }
}

try {
  const settings = JSON.parse(readFileSync(path.join(root, "settings.json"), "utf8"));
  for (const key of ["appName", "personality", "model", "onlineModel"]) {
    if (typeof settings[key] !== "string" || !settings[key].trim()) problems.push(`settings.json is missing "${key}"`);
  }
} catch (err) {
  problems.push(`settings.json isn't valid JSON: ${err.message}`);
}

// Files the server serves by name (its STATIC_FILES list), apart from optional music.
const server = readFileSync(path.join(root, "server.js"), "utf8");
for (const [, file] of server.matchAll(/^\s*"\/[^"]*":\s*\["([^"]+)"/gm)) {
  if (/^music\.(mp3|m4a|ogg)$/.test(file)) continue;
  if (!existsSync(path.join(root, "public", file))) problems.push(`public/${file} is listed in server.js but missing`);
}

if (problems.length) {
  console.error(`${problems.length} problem(s) found:\n\n${problems.join("\n\n")}`);
  process.exit(1);
}
console.log(`All good: ${files.length} JavaScript files parse, settings.json is valid, and every page file exists.`);
