import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { inlineAttachment } from "../lib/attachments";
import type { Attachment, WikiPage } from "../lib/types";
import { linkWikiRefs, readWikiHref, sameTitle } from "../lib/wiki";
import { useApp } from "../state/app";
import { AttachmentImage } from "./Attachments";

/**
 * Turns Redmine's #123 references, @login mentions and [[wiki links]] into
 * links Redline can show, leaving code spans and fenced blocks alone.
 */
export function linkIssueRefs(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : linkWikiRefs(part)
            .replace(/(^|[\s(])#(\d+)\b/g, (_m, pre: string, id: string) => `${pre}[#${id}](#issue-${id})`)
            .replace(/(^|[\s(])@([A-Za-z0-9_.-]*[A-Za-z0-9_])/g, (_m, pre: string, login: string) => `${pre}[@${login}](#user-${login})`),
    )
    .join("");
}

/**
 * Markdown as Redmine shows it. Images named like one of `attachments` show
 * that file. Wiki links open the wiki of `projectId`, or of the project they
 * name; with `wikiPages`, links to pages that don't exist yet look it.
 */
export function Markdown({
  text,
  attachments,
  projectId,
  wikiPages,
}: {
  text: string;
  attachments?: Attachment[] | null;
  projectId?: number;
  wikiPages?: WikiPage[];
}) {
  const openIssue = useApp((s) => s.openIssue);
  const navigate = useApp((s) => s.navigate);
  const projects = useApp((s) => s.meta?.projects);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img({ src, alt }) {
            const attachment = inlineAttachment(attachments, typeof src === "string" ? src : undefined);
            if (attachment) return <AttachmentImage attachment={attachment} alt={alt || attachment.filename} className="inline-attachment" />;
            return <img src={typeof src === "string" ? src : undefined} alt={alt ?? ""} />;
          },
          a({ href, children }) {
            const issue = href?.match(/^#issue-(\d+)$/);
            if (issue) {
              return (
                <a
                  href={href}
                  className="issue-ref"
                  onClick={(e) => {
                    e.preventDefault();
                    openIssue(Number(issue[1]));
                  }}
                >
                  {children}
                </a>
              );
            }
            if (href?.startsWith("#user-")) return <span className="mention">{children}</span>;
            const wiki = href ? readWikiHref(href) : null;
            if (wiki) {
              const target = wiki.project ? projects?.find((p) => p.identifier === wiki.project)?.id : projectId;
              if (target === undefined) return <span className="wiki-link wiki-link-unknown">{children}</span>;
              const missing =
                target === projectId && wiki.title !== null && wikiPages !== undefined && !wikiPages.some((p) => sameTitle(p.title, wiki.title!));
              return (
                <a
                  href={href}
                  className={missing ? "wiki-link wiki-link-new" : "wiki-link"}
                  title={missing ? "No page yet" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate({ view: "wiki", projectId: target, title: wiki.title });
                  }}
                >
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {linkIssueRefs(text)}
      </ReactMarkdown>
    </div>
  );
}
