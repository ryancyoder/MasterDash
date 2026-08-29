// Installs the resolver in scripts/ts-resolve-hooks.mjs. Used as
// `node --experimental-strip-types --import ./scripts/ts-resolve.mjs`.
import { register } from "node:module";
register("./ts-resolve-hooks.mjs", import.meta.url);
