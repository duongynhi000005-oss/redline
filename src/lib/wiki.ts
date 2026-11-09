import type { WikiPage } from "./types";

/**
 * A title as Redmine stores it: spaces become underscores, the characters
 * Redmine doesn't allow (, . / ? ; | :) go, and the first letter is a capital.
 */
export function titleize(title: string): string {
  const t = title.trim().replace(/\s+/g, "_").replace(/[,./?;|:]/g, "");
  return t.slice(0, 1).toUpperCase() + t.slice(1);
}

/** A title as people read it, with spaces. */
export function prettyTitle(title: string): string {
  return title.replace(/_/g, " ");
}

/** Redmine finds pages by title without minding case. */
export function sameTitle(a: string, b: string): boolean {
  return titleize(a).toLowerCase() === titleize(b).toLowerCase();
}

/** Pages under each parent title ("" for the top), by title. */
export function wikiTree(pages: WikiPage[]): Map<string, WikiPage[]> {
  const byTitle = new Map(pages.map((p) => [p.title.toLowerCase(), p]));
  const tree = new Map<string, WikiPage[]>();
  for (const page of pages) {
    // A parent Redline can't see puts the page at the top.
    const parent = page.parent && byTitle.has(page.parent.title.toLowerCase()) ? page.parent.title.toLowerCase() : "";
    const list = tree.get(parent) ?? [];
    list.push(page);
    tree.set(parent, list);
  }
  for (const list of tree.values()) list.sort((a, b) => prettyTitle(a.title).localeCompare(prettyTitle(b.title)));
  return tree;
}

/** The page's parents, top first. */
export function ancestors(title: string, pages: WikiPage[]): WikiPage[] {
  const byTitle = new Map(pages.map((p) => [p.title.toLowerCase(), p]));
  const out: WikiPage[] = [];
  let parent = byTitle.get(title.toLowerCase())?.parent;
  while (parent && out.length < 50) {
    const page = byTitle.get(parent.title.toLowerCase());
    if (!page || out.includes(page)) break;
    out.unshift(page);
    parent = page.parent;
  }
  return out;
}

/** The page and every page under it. */
export function descendants(title: string, pages: WikiPage[]): WikiPage[] {
  const tree = wikiTree(pages);
  const out: WikiPage[] = [];
  const walk = (t: string) => {
    for (const child of tree.get(t.toLowerCase()) ?? []) {
      if (out.includes(child)) continue;
      out.push(child);
      walk(child.title);
    }
  };
  walk(title);
  return out;
}

/** Why a new page's title won't do, or null when it will. */
export function titleProblem(title: string, pages: WikiPage[]): string | null {
  const t = titleize(title);
  if (!t) return "Give the page a title.";
  if (t.length > 255) return "Titles are 255 characters at most.";
  if (pages.some((p) => sameTitle(p.title, t))) return "There's already a page with this title.";
  return null;
}

/** Where a Redmine wiki link points: a page (or the start page) in this or another project's wiki. */
export interface WikiLink {
  /** Another project's identifier, or null for this project. */
  project: string | null;
  /** The page, or null for the wiki's start page. */
  title: string | null;
  label: string;
}

/** Reads `[[Page]]`, `[[Page|label]]`, `[[Page#section]]`, `[[project:Page]]` and `[[project:]]`. */
export function parseWikiLink(inside: string): WikiLink {
  const bar = inside.indexOf("|");
  const target = (bar >= 0 ? inside.slice(0, bar) : inside).trim();
  const label = bar >= 0 ? inside.slice(bar + 1).trim() : "";
  const colon = target.match(/^([a-z][a-z0-9_-]*):(.*)$/);
  const project = colon ? colon[1]! : null;
  const page = (colon ? colon[2]! : target).replace(/#.*$/, "").trim();
  const shown = label || (colon && !page ? project! : target.replace(/^[a-z][a-z0-9_-]*:/, ""));
  return { project, title: page ? titleize(page) : null, label: shown };
}

/** The href Markdown gets for a wiki link, read back by `readWikiHref`. */
export function wikiHref(link: WikiLink): string {
  return `#wiki-${encodeURIComponent(link.project ?? "")}/${encodeURIComponent(link.title ?? "")}`;
}

export function readWikiHref(href: string): { project: string | null; title: string | null } | null {
  const m = href.match(/^#wiki-([^/]*)\/(.*)$/);
  if (!m) return null;
  const project = decodeURIComponent(m[1]!);
  const title = decodeURIComponent(m[2]!);
  return { project: project || null, title: title || null };
}

/** Turns `[[…]]` wiki links into Markdown links. `![[…]]` stays as written, as in Redmine. Expects text outside code. */
export function linkWikiRefs(text: string): string {
  return text.replace(/(!?)\[\[([^\]\n]+)\]\]/g, (whole, bang: string, inside: string) => {
    if (bang) return whole.slice(1);
    const link = parseWikiLink(inside);
    const label = link.label.replace(/([[\]\\])/g, "\\$1");
    return `[${label}](${wikiHref(link)})`;
  });
}

/**
 * The text without a first heading that only repeats the page's title, since
 * Redline shows the title above it. Redmine pages often start with one.
 */
export function withoutTitleHeading(text: string, title: string): string {
  const m = text.match(/^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/);
  if (!m || !sameTitle(m[1]!, title)) return text;
  return text.slice(m[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
}
