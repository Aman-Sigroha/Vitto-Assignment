import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transform } from "sucrase";

export function load(url, context, nextLoad) {
  if (!shouldTransform(url)) return nextLoad(url, context);

  const source = readFileSync(fileURLToPath(url), "utf8");
  const transformed = transform(source, {
    transforms: ["jsx"],
    jsxRuntime: "automatic",
    production: true,
  }).code;

  return {
    format: "module",
    shortCircuit: true,
    source: addJsExtensions(transformed),
  };
}

function shouldTransform(url) {
  if (!url.startsWith("file:") || !url.endsWith(".js") || url.includes("/node_modules/")) {
    return false;
  }
  return url.includes("/app/") || url.includes("/lib/");
}

function addJsExtensions(source) {
  return source.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (match, start, specifier, end) => (
      specifier.endsWith(".js") ? match : `${start}${specifier}.js${end}`
    ),
  );
}
