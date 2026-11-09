import type { WikiPage } from "./types";
import { ancestors, descendants, withoutTitleHeading, linkWikiRefs, parseWikiLink, prettyTitle, readWikiHref, sameTitle, titleProblem, titleize, wikiHref, wikiTree } from "./wiki";

const page = (title: string, parent?: string): WikiPage => ({ title, parent: parent ? { title: parent } : null, version: 1 });
const pages = [page("Wiki"), page("Getting_started", "Wiki"), page("Code_review", "Getting_started"), page("Architecture"), page("Orphan", "Gone")];

describe("wiki titles", () => {
  it("stores titles the way Redmine does", () => {
    expect(titleize("  release   checklist ")).toBe("Release_checklist");
    expect(titleize("v1.2: notes, part 1/2?")).toBe("V12_notes_part_12");
    expect(prettyTitle("Release_checklist")).toBe("Release checklist");
    expect(sameTitle("release checklist", "Release_Checklist")).toBe(true);
  });

  it("says why a new title won't do", () => {
    expect(titleProblem("  ", pages)).toBe("Give the page a title.");
    expect(titleProblem("getting started", pages)).toBe("There's already a page with this title.");
    expect(titleProblem("Roadmap", pages)).toBeNull();
  });
});

describe("the page tree", () => {
  it("nests pages under their parents, alphabetically, with unknown parents at the top", () => {
    const tree = wikiTree(pages);
    expect(tree.get("")!.map((p) => p.title)).toEqual(["Architecture", "Orphan", "Wiki"]);
    expect(tree.get("wiki")!.map((p) => p.title)).toEqual(["Getting_started"]);
    expect(ancestors("Code_review", pages).map((p) => p.title)).toEqual(["Wiki", "Getting_started"]);
    expect(descendants("Wiki", pages).map((p) => p.title)).toEqual(["Getting_started", "Code_review"]);
  });

  it("survives a parent loop", () => {
    const loop = [page("A", "B"), page("B", "A")];
    expect(ancestors("A", loop).length).toBeLessThanOrEqual(2);
    expect(descendants("A", loop).map((p) => p.title)).toEqual(["B", "A"]);
  });
});

describe("wiki links", () => {
  it("reads Redmine's link forms", () => {
    expect(parseWikiLink("Release checklist")).toEqual({ project: null, title: "Release_checklist", label: "Release checklist" });
    expect(parseWikiLink("Release checklist|the checklist")).toEqual({ project: null, title: "Release_checklist", label: "the checklist" });
    expect(parseWikiLink("Guide#install")).toEqual({ project: null, title: "Guide", label: "Guide#install" });
    expect(parseWikiLink("mobile:Setup")).toEqual({ project: "mobile", title: "Setup", label: "Setup" });
    expect(parseWikiLink("mobile:")).toEqual({ project: "mobile", title: null, label: "mobile" });
  });

  it("turns them into links Redline can follow, and leaves escaped ones alone", () => {
    const md = linkWikiRefs("See [[Release checklist]] and ![[Not a link]].");
    expect(md).toBe(`See [Release checklist](${wikiHref({ project: null, title: "Release_checklist", label: "" })}) and [[Not a link]].`);
    expect(readWikiHref("#wiki-mobile/Setup")).toEqual({ project: "mobile", title: "Setup" });
    expect(readWikiHref("#wiki-/")).toEqual({ project: null, title: null });
    expect(readWikiHref("#issue-3")).toBeNull();
  });
});

describe("the title heading", () => {
  it("drops a first heading that repeats the title, and keeps any other", () => {
    expect(withoutTitleHeading("# Getting started\n\n1. Clone", "Getting_started")).toBe("1. Clone");
    expect(withoutTitleHeading("  # getting  started ##\nText", "Getting_started")).toBe("Text");
    expect(withoutTitleHeading("# Web\n\nStart here", "Wiki")).toBe("# Web\n\nStart here");
    expect(withoutTitleHeading("Intro\n# Getting started", "Getting_started")).toBe("Intro\n# Getting started");
  });
});
