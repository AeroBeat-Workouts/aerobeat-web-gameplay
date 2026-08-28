// @ts-check

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} path
 * @returns {string[]}
 */
function collectFiles(path) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && entry !== "node_modules") {
      files.push(...collectFiles(fullPath));
    } else if (entry.endsWith(".html") || entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

const failures = [];
const roots = ["src/screens", ".testbed/scenes"].filter((path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
});

for (const root of roots) {
  for (const file of collectFiles(root)) {
    const source = readFileSync(file, "utf8");
    if (/<(?:button|input|select|textarea)\b/u.test(source)) {
      failures.push(`${file}: visible controls must be named aero-* Web Components`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("Component-only scaffold check passed.");
