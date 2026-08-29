// Resolve the extensionless relative imports the app is written with.
//
// Next.js resolves `./curve` to `curve.ts` through webpack; node's ESM loader
// does not, and TypeScript will not let the source say `./curve.ts` unless
// allowImportingTsExtensions is on, which changes the build. So the gap is
// closed here, in the test runner, rather than in the code under test.
//
// This is what makes a module with imports testable at all. Until now only a
// dependency-free file could be checked by node, which is a real constraint on
// what gets tested rather than a property of what is worth testing.

import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const from = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : process.cwd();
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const candidate = resolvePath(from, specifier + ext);
      if (existsSync(candidate)) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }
  return next(specifier, context);
}
