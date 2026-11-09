import { createDemoBackend } from "./demoBackend";
import { describeDetail } from "./journal";

describe("describeDetail", () => {
  it("names statuses, people and cycles instead of ids", async () => {
    const meta = await createDemoBackend().getMetadata();
    expect(describeDetail({ property: "attr", name: "status_id", old_value: "1", new_value: "2" }, meta)).toBe(
      "changed status from New to In Progress",
    );
    expect(describeDetail({ property: "attr", name: "assigned_to_id", old_value: null, new_value: "2" }, meta)).toBe(
      "set assignee to Sam Teammate",
    );
    expect(describeDetail({ property: "attr", name: "fixed_version_id", old_value: "2", new_value: "" }, meta)).toBe(
      "removed cycle Sprint 2",
    );
    expect(describeDetail({ property: "cf", name: "2", old_value: "S", new_value: "M" }, meta)).toBe(
      "changed Size from S to M",
    );
    expect(describeDetail({ property: "attachment", name: "7", new_value: "trace.log" }, meta)).toBe("attached trace.log");
    expect(describeDetail({ property: "attr", name: "description", old_value: "a", new_value: "b" }, meta)).toBe(
      "updated the description",
    );
  });
});
