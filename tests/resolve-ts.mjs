import { registerHooks } from "node:module";

// Next.js resolves extensionless relative imports to .ts files; mirror that for node:test.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      if (error?.code !== "ERR_MODULE_NOT_FOUND" || !relative || /\.[cm]?[jt]s$/.test(specifier)) {
        throw error;
      }
      return nextResolve(specifier + ".ts", context);
    }
  }
});
