import { describe, expect, test, vi } from "vitest";
import { buildCatalog, MODES } from "./catalog";
import { FULL_ACCESS_MODE_ID } from "./permission-mode";

describe("catalog defaults", () => {
  test("opens a new session in Full access at the high tier", async () => {
    // A binary that cannot run makes the discovery fail fast, which is the bundled model list.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const catalog = await buildCatalog("default", "/nonexistent/agy-for-tests");
      expect(catalog.defaultMode).toBe(FULL_ACCESS_MODE_ID);
      expect(MODES.some((mode) => mode.id === catalog.defaultMode)).toBe(true);
      expect(catalog.defaultThinkingOption).toBe("high");
      const model = catalog.models.find((entry) => entry.id === catalog.defaultModel);
      expect(model?.thinkingOptions?.map((option) => option.id)).toContain(
        catalog.defaultThinkingOption,
      );
    } finally {
      quiet.mockRestore();
    }
  });
});
