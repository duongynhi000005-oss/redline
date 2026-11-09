import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useApp } from "../state/app";

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

export function Markdown({ text }: { text: string }) {
  const openIssue = useApp((s) => s.openIssue);
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
