import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { inlineAttachment } from "../lib/attachments";
import type { Attachment } from "../lib/types";
import { useApp } from "../state/app";
import { AttachmentImage } from "./Attachments";

/**
 * Turns Redmine's #123 references and @login mentions into links Redline can
 * show, leaving code spans and fenced blocks alone.
 */
export function linkIssueRefs(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  return parts
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/(^|[\s(])#(\d+)\b/g, (_m, pre: string, id: string) => `${pre}[#${id}](#issue-${id})`)
            .replace(/(^|[\s(])@([A-Za-z0-9_.-]*[A-Za-z0-9_])/g, (_m, pre: string, login: string) => `${pre}[@${login}](#user-${login})`),
    )
    .join("");
}

/** Markdown as Redmine shows it. Images named like one of `attachments` show that file. */
export function Markdown({ text, attachments }: { text: string; attachments?: Attachment[] | null }) {
  const openIssue = useApp((s) => s.openIssue);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img({ src, alt }) {
            const attachment = inlineAttachment(attachments, typeof src === "string" ? src : undefined);
            if (attachment) return <AttachmentImage attachment={attachment} alt={alt ?? attachment.filename} className="inline-attachment" />;
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
