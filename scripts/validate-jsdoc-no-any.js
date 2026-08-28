// @ts-check

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * @param {string} path
 * @returns {string[]}
 */
function collectJavaScriptFiles(path) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(path)) {
    const fullPath = join(path, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory() && entry !== "node_modules") {
      files.push(...collectJavaScriptFiles(fullPath));
    } else if (entry.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

const failures = [];

for (const target of ["src", ".testbed"]) {
  for (const file of collectJavaScriptFiles(target)) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("// @ts-check")) {
      failures.push(`${file}: missing // @ts-check`);
    }
    if (/@(?:type|param|returns|typedef)\s*\{\s*(?:any|\*)/u.test(source)) {
      failures.push(`${file}: contains an undocumented JSDoc escape`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("JSDoc/no-escape scaffold check passed.");
