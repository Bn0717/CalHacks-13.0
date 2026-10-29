import { configDefaults, defineConfig } from "vitest/config";

// Default test search, plus: never look inside the VS Code helper's own installed packages or build output.
// The helper's tests (extensions/vscode/tests) do run here too.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "extensions/*/node_modules/**", "extensions/*/dist/**", "extensions/*/*.vsix"],
  },
});
