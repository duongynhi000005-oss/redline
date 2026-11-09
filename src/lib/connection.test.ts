import {
  DEFAULT_LIMITS,
  connectionProblem,
  isEmptyConnection,
  limitsOf,
  mightNeedHeaders,
  normalizeConnection,
  sameConnection,
} from "./connection";

const h = (name: string, value: string) => ({ name, value });

describe("connection options", () => {
  it("trims and drops blank rows and a blank username", () => {
    const options = { username: "  ", headers: [h(" X-Token ", " abc "), h("", " ")] };
    expect(normalizeConnection(options)).toEqual({ username: null, headers: [h("X-Token", "abc")], limits: null });
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

  it("keeps request limits only when they differ from the defaults", () => {
    expect(normalizeConnection({ username: null, headers: [], limits: DEFAULT_LIMITS }).limits).toBeNull();
    expect(isEmptyConnection({ username: null, headers: [], limits: { ...DEFAULT_LIMITS } })).toBe(true);
    const slow = { username: null, headers: [], limits: { at_once: 1, per_minute: 30 } };
    expect(normalizeConnection(slow).limits).toEqual({ at_once: 1, per_minute: 30 });
    expect(isEmptyConnection(slow)).toBe(false);
    expect(limitsOf({ username: null, headers: [] })).toEqual(DEFAULT_LIMITS);
  });

  it("explains request limits out of range", () => {
    const limits = (at_once: number, per_minute: number) => ({ username: null, headers: [], limits: { at_once, per_minute } });
    expect(connectionProblem(limits(1, 30))).toBeNull();
    expect(connectionProblem(limits(0, 30))).toMatch(/Requests at a time/);
    expect(connectionProblem(limits(9, 30))).toMatch(/from 1 to 8/);
    expect(connectionProblem(limits(2, Number.NaN))).toMatch(/Requests per minute/);
    expect(connectionProblem(limits(2, 5000))).toMatch(/from 10 to 1,200/);
  });

  it("offers headers for errors a proxy can cause", () => {
    expect(mightNeedHeaders("refused")).toBe(true);
    expect(mightNeedHeaders("not_redmine")).toBe(true);
    expect(mightNeedHeaders("invalid_url")).toBe(false);
  });
});
