import { connectionProblem, isEmptyConnection, mightNeedHeaders, normalizeConnection, sameConnection } from "./connection";

const h = (name: string, value: string) => ({ name, value });

describe("connection options", () => {
  it("trims and drops blank rows and a blank username", () => {
    const options = { username: "  ", headers: [h(" X-Token ", " abc "), h("", " ")] };
    expect(normalizeConnection(options)).toEqual({ username: null, headers: [h("X-Token", "abc")] });
    expect(isEmptyConnection({ username: " ", headers: [h("", "")] })).toBe(true);
    expect(sameConnection({ username: "dana ", headers: [] }, { username: "dana", headers: [h("", "")] })).toBe(true);
  });

  it("accepts a username and ordinary headers", () => {
    expect(connectionProblem({ username: "dana", headers: [h("X-Gateway-Token", "abc"), h("Authorization", "Bearer x")] })).toBeNull();
  });

  it("explains what can't be sent", () => {
    const cases: [ReturnType<typeof h>[], RegExp][] = [
      [[h("X-Redmine-API-Key", "k")], /API key field/],
      [[h("Accept", "x")], /sets Accept itself/],
      [[h("Has space", "x")], /isn't a valid header name/],
      [[h("X-Empty", "")], /Give X-Empty a value/],
      [[h("", "orphan")], /needs a name/],
      [[h("X-A", "1"), h("x-a", "2")], /listed twice/],
      [[h("X-Line", "a\nb")], /characters that can't go in a header/],
    ];
    for (const [headers, message] of cases) expect(connectionProblem({ username: null, headers })).toMatch(message);
    expect(connectionProblem({ username: "dana", headers: [h("X-Redmine-Username", "dana")] })).toMatch(/Username field/);
  });

  it("offers headers for errors a proxy can cause", () => {
    expect(mightNeedHeaders("refused")).toBe(true);
    expect(mightNeedHeaders("not_redmine")).toBe(true);
    expect(mightNeedHeaders("invalid_url")).toBe(false);
  });
});
