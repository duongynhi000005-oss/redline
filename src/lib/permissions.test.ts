import { allowed } from "./permissions";
import type { Metadata } from "./types";

const meta = (patch: Partial<Metadata["user"] & object> = {}, roles: Metadata["roles"] = undefined): Metadata =>
  ({
    user: {
      id: 1,
      login: "dev",
      firstname: "Dana",
      lastname: "Developer",
      admin: false,
      memberships: [
        { project: { id: 1, name: "Web" }, roles: [{ id: 3, name: "Manager" }] },
        {
          project: { id: 2, name: "Mobile" },
          roles: [
            { id: 4, name: "Developer" },
            { id: 9, name: "Gone" },
          ],
        },
        { project: { id: 3, name: "Docs" }, roles: [{ id: 4, name: "Developer" }] },
      ],
      ...patch,
    },
    roles: roles ?? [
      { id: 3, name: "Manager", permissions: ["add_issue_watchers"] },
      { id: 4, name: "Developer", permissions: ["view_issues"] },
    ],
  }) as unknown as Metadata;

describe("allowed", () => {
  it("follows the user's roles in the project", () => {
    expect(allowed(meta(), 1, "add_issue_watchers")).toBe(true);
    expect(allowed(meta(), 3, "add_issue_watchers")).toBe(false);
  });

  it("can't tell for a role it doesn't know, a project the user isn't in, or no roles at all", () => {
    expect(allowed(meta(), 2, "add_issue_watchers")).toBeNull();
    expect(allowed(meta(), 99, "add_issue_watchers")).toBeNull();
    expect(allowed(meta({}, []), 1, "add_issue_watchers")).toBeNull();
    expect(allowed(null, 1, "add_issue_watchers")).toBeNull();
  });

  it("lets admins do anything", () => {
    expect(allowed(meta({ admin: true }), 3, "add_issue_watchers")).toBe(true);
  });
});
