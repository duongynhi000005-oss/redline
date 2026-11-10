import { createDemoBackend, demoIssues } from "./demoBackend";
import { matchesFilters, toggleFilterValue } from "./filters";
import { derive } from "../state/derived";

describe("filters", () => {
  it("matches any value within a field and every field", async () => {
    const backend = createDemoBackend({ signedIn: true });
    const meta = await backend.getMetadata();
    const d = derive(meta);
    const issues = demoIssues();
    const ui = issues.filter((i) => matchesFilters(i, [{ field: "label", values: ["Area:UI"] }], d));
    expect(ui.length).toBeGreaterThan(0);
    expect(ui.every((i) => i.custom_fields.some((f) => Array.isArray(f.value) && f.value.includes("UI")))).toBe(true);

    const mineAndUi = issues.filter((i) =>
      matchesFilters(
        i,
        [
          { field: "label", values: ["Area:UI"] },
          { field: "assignee", values: ["1", "none"] },
        ],
        d,
      ),
    );
    expect(mineAndUi.every((i) => !i.assigned_to || i.assigned_to.id === 1)).toBe(true);
    expect(mineAndUi.length).toBeLessThanOrEqual(ui.length);
  });

  it("adds and removes values, dropping a filter when it empties", () => {
    let f = toggleFilterValue([], "status", "started");
    f = toggleFilterValue(f, "status", "unstarted");
    expect(f).toEqual([{ field: "status", values: ["started", "unstarted"] }]);
    f = toggleFilterValue(toggleFilterValue(f, "status", "started"), "status", "unstarted");
    expect(f).toEqual([]);
  });
});
