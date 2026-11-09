import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { knownLabelValues, people } from "../lib/edit";
import type { PriorityLevel, StatusCategory } from "../lib/model";
import { activeCycle, defaultCategory, hueFor, teamOf } from "../lib/model";
import type { Issue, IssueChanges, IssueStatusRef, Metadata } from "../lib/types";
import type { RelationChoice } from "../lib/relations";
import { RELATION_CHOICES, relatedGroups, subIssues } from "../lib/relations";
import type { PickerKind } from "../state/app";
import { useApp } from "../state/app";
import type { Derived } from "../state/derived";
import { useDerived } from "../state/derived";
import { Avatar } from "./Avatar";
import { Icon, PriorityIcon, StatusIcon } from "./icons";
import { matchesQuery } from "./CommandPalette";

export interface PickerOption {
  key: string;
  label: string;
  group?: string;
  icon?: React.ReactNode;
  selected: boolean;
  changes: IssueChanges;
}

const PLACEHOLDER: Record<PickerKind, string> = {
  status: "Change status…",
  priority: "Change priority…",
  assignee: "Assign to…",
  cycle: "Move to cycle…",
  labels: "Change labels…",
  relation: "Connect an issue…",
};

/** The choices for one property of an issue. */
export function pickerOptions(
  kind: PickerKind,
  issue: Issue,
  meta: Metadata,
  d: Derived,
  allIssues: Iterable<Issue>,
  allowedStatuses: IssueStatusRef[] | null,
): PickerOption[] {
  switch (kind) {
    case "status": {
      const statuses = allowedStatuses?.length
        ? allowedStatuses.map((s) => meta.statuses.find((x) => x.id === s.id) ?? { ...s, is_closed: !!s.is_closed })
        : meta.statuses;
      // Redmine lists the current status as allowed; keep it first-class.
      return statuses.map((s) => {
        const category: StatusCategory = d.categories.get(s.id) ?? defaultCategory(s, meta.trackers);
        return {
          key: `status-${s.id}`,
          label: s.name,
          icon: <StatusIcon category={category} />,
          selected: issue.status.id === s.id,
          changes: { status_id: s.id },
        };
      });
    }
    case "priority":
      return [...meta.priorities].reverse().map((p) => ({
        key: `priority-${p.id}`,
        label: p.name,
        icon: <PriorityIcon level={(d.priorities.get(p.id) ?? 0) as PriorityLevel} />,
        selected: issue.priority.id === p.id,
        changes: { priority_id: p.id },
      }));
    case "assignee": {
      const me = meta.user?.id;
      const list = people(meta, issue.project.id);
      const ordered = [...list.filter((p) => p.id === me), ...list.filter((p) => p.id !== me)];
      return [
        {
          key: "assignee-none",
          label: "No assignee",
          icon: <Avatar name={null} size={16} />,
          selected: !issue.assigned_to,
          changes: { assigned_to_id: null },
        },
        ...ordered.map((p) => ({
          key: `assignee-${p.id}`,
          label: p.id === me ? `${p.name} (you)` : p.name,
          icon: <Avatar name={p.name} size={16} />,
          selected: issue.assigned_to?.id === p.id,
          changes: { assigned_to_id: p.id },
        })),
      ];
    }
    case "cycle": {
      const team = teamOf(issue.project.id, meta);
      const current = activeCycle(team, meta.versions);
      const versions = meta.versions.filter(
        (v) =>
          (v.project.id === issue.project.id || v.project.id === team || (v.sharing && v.sharing !== "none")) &&
          (v.status === "open" || v.id === issue.fixed_version?.id),
      );
      const unique = [...new Map(versions.map((v) => [v.id, v])).values()].sort((a, b) =>
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"),
      );
      return [
        {
          key: "cycle-none",
          label: "No cycle",
          icon: <Icon name="cycle" />,
          selected: !issue.fixed_version,
          changes: { fixed_version_id: null },
        },
        ...unique.map((v) => ({
          key: `cycle-${v.id}`,
          label: v.id === current?.id ? `${v.name} (current)` : v.name,
          icon: <Icon name="cycle" />,
          selected: issue.fixed_version?.id === v.id,
          changes: { fixed_version_id: v.id },
        })),
      ];
    }
    case "labels": {
      const options: PickerOption[] = [];
      const known = knownLabelValues(allIssues);
      const isLabel = (f: { id: number; multiple?: boolean }) => (d.labelFields ? d.labelFields.has(f.id) : !!f.multiple);
      for (const field of issue.custom_fields.filter(isLabel)) {
        const current = Array.isArray(field.value) ? field.value.filter(Boolean) : field.value ? [field.value] : [];
        const values = new Set([...(known.get(field.id)?.values ?? []), ...current]);
        for (const value of [...values].sort((a, b) => a.localeCompare(b))) {
          const selected = current.includes(value);
          let value_: string | string[];
          if (field.multiple) {
            const next = selected ? current.filter((v) => v !== value) : [...current, value];
            // Redmine clears a multi-value field when sent a single blank.
            value_ = next.length ? next : [""];
          } else {
            value_ = selected ? "" : value;
          }
          options.push({
            key: `label-${field.id}-${value}`,
            label: value,
            group: field.name,
            icon: <span className="chip-dot" style={{ background: `hsl(${hueFor(field.name + value)} 55% 55%)` }} />,
            selected,
            changes: { custom_fields: [{ id: field.id, value: value_ }] },
          });
        }
      }
      return options;
    }
    case "relation":
      // Issues, not values: see RelationPickerContent.
      return [];
  }
}

export function Picker() {
  const picker = useApp((s) => s.picker);
  const closePicker = useApp((s) => s.closePicker);
  return (
    <Command.Dialog
      open={picker !== null}
      onOpenChange={(open) => !open && closePicker()}
      label={picker ? PLACEHOLDER[picker.kind] : "Picker"}
      shouldFilter={false}
      overlayClassName="palette-overlay"
      contentClassName="palette picker"
    >
      {picker &&
        (picker.kind === "relation" ? (
          <RelationPickerContent issueId={picker.issueId} choice={picker.relation ?? null} />
        ) : (
          <PickerContent kind={picker.kind} issueId={picker.issueId} />
        ))}
    </Command.Dialog>
  );
}

function PickerContent({ kind, issueId }: { kind: PickerKind; issueId: number }) {
  const issue = useApp((s) => s.issues.get(issueId));
  const issues = useApp((s) => s.issues);
  const meta = useApp((s) => s.meta);
  const backend = useApp((s) => s.backend);
  const updateIssue = useApp((s) => s.updateIssue);
  const closePicker = useApp((s) => s.closePicker);
  const d = useDerived();
  const [query, setQuery] = useState("");
  const [allowed, setAllowed] = useState<IssueStatusRef[] | null>(null);

  // Redmine's workflow decides which statuses this user may pick.
  useEffect(() => {
    if (kind !== "status" || !backend) return;
    let live = true;
    backend
      .getIssueDetails(issueId, true)
      .then((details) => live && setAllowed(details.allowedStatuses))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [kind, issueId, backend]);

  const options = useMemo(
    () => (issue && meta ? pickerOptions(kind, issue, meta, d, issues.values(), allowed) : []),
    [kind, issue, meta, d, issues, allowed],
  );
  const visible = query.trim() ? options.filter((o) => matchesQuery(`${o.label} ${o.group ?? ""}`, query)) : options;
  const groups = [...new Set(visible.map((o) => o.group ?? ""))];

  if (!issue) return null;

  const choose = (option: PickerOption) => {
    void updateIssue(issueId, option.changes);
    // Labels toggle; other properties take one value.
    if (kind !== "labels") closePicker();
  };

  return (
    <>
      <div className="picker-context">
        #{issue.id} {issue.subject}
      </div>
      <Command.Input value={query} onValueChange={setQuery} placeholder={PLACEHOLDER[kind]} />
      <Command.List>
        <Command.Empty>{kind === "labels" ? "This issue has no label fields." : "No matches."}</Command.Empty>
        {groups.map((group) => (
          <Command.Group key={group} heading={group || undefined}>
            {visible
              .filter((o) => (o.group ?? "") === group)
              .map((o) => (
                <Command.Item key={o.key} value={o.key} onSelect={() => choose(o)}>
                  {o.icon}
                  <span className="palette-label">{o.label}</span>
                  {o.selected && <span className="picker-check" aria-label="Selected">✓</span>}
                </Command.Item>
              ))}
          </Command.Group>
        ))}
      </Command.List>
    </>
  );
}

/** The most issues the relation picker lists at once; typing narrows it. */
const RELATION_PICKER_LIMIT = 50;

/** The issues that could be connected to `issue` in the chosen way. */
export function relationCandidates(
  issue: Issue,
  choice: RelationChoice,
  issues: Map<number, Issue>,
  query: string,
): { id: number; issue?: Issue }[] {
  const taken = new Set<number>([issue.id]);
  if (choice === "parent") {
    if (issue.parent) taken.add(issue.parent.id);
    // A sub-issue can't also be the parent.
    for (const child of subIssues(issue, issues.values())) taken.add(child.id);
  } else if (choice === "sub-issue") {
    for (const child of subIssues(issue, issues.values())) taken.add(child.id);
    if (issue.parent) taken.add(issue.parent.id);
  } else {
    for (const group of relatedGroups(issue, issues)) {
      if (group.type === choice) group.items.forEach((i) => taken.add(i.otherId));
    }
  }
  const q = query.trim().replace(/^#/, "");
  const wanted = /^\d+$/.test(q) ? Number(q) : null;
  const list: { id: number; issue?: Issue }[] = [...issues.values()]
    .filter((i) => !taken.has(i.id) && (!q || matchesQuery(`#${i.id} ${i.subject}`, query)))
    .sort((a, b) => (b.id === wanted ? 1 : 0) - (a.id === wanted ? 1 : 0) || b.updated_on.localeCompare(a.updated_on))
    .slice(0, RELATION_PICKER_LIMIT)
    .map((i) => ({ id: i.id, issue: i }));
  // An issue Redline hasn't synced (another project, say) can still be named by number.
  if (wanted !== null && wanted > 0 && !taken.has(wanted) && !issues.has(wanted)) list.unshift({ id: wanted });
  return list;
}

function RelationPickerContent({ issueId, choice }: { issueId: number; choice: RelationChoice | null }) {
  const issue = useApp((s) => s.issues.get(issueId));
  const issues = useApp((s) => s.issues);
  const openPicker = useApp((s) => s.openPicker);
  const closePicker = useApp((s) => s.closePicker);
  const relateIssue = useApp((s) => s.relateIssue);
  const updateIssue = useApp((s) => s.updateIssue);
  const d = useDerived();
  const meta = useApp((s) => s.meta);
  const [query, setQuery] = useState("");

  const candidates = useMemo(
    () => (issue && choice ? relationCandidates(issue, choice, issues, query) : []),
    [issue, choice, issues, query],
  );
  if (!issue) return null;

  if (!choice) {
    const visible = RELATION_CHOICES.filter((c) => matchesQuery(c.label, query));
    return (
      <>
        <div className="picker-context">
          #{issue.id} {issue.subject}
        </div>
        <Command.Input value={query} onValueChange={setQuery} placeholder="Connect an issue…" />
        <Command.List>
          <Command.Empty>No matches.</Command.Empty>
          {visible.map((c) => (
            <Command.Item key={c.choice} value={c.choice} onSelect={() => openPicker("relation", issueId, c.choice)}>
              <Icon name={c.choice === "sub-issue" || c.choice === "parent" ? "sub-issue" : "relation"} />
              <span className="palette-label">{c.label}</span>
            </Command.Item>
          ))}
        </Command.List>
      </>
    );
  }

  const placeholder = RELATION_CHOICES.find((c) => c.choice === choice)?.placeholder ?? "Choose an issue…";
  const choose = (otherId: number) => {
    closePicker();
    void relateIssue(issueId, choice, otherId);
  };
  return (
    <>
      <div className="picker-context">
        #{issue.id} {issue.subject}
      </div>
      <Command.Input value={query} onValueChange={setQuery} placeholder={placeholder} />
      <Command.List>
        <Command.Empty>No matching issues. Type an issue number to use one Redline hasn't synced.</Command.Empty>
        {choice === "parent" && issue.parent && !query.trim() && (
          <Command.Item
            value="no-parent"
            onSelect={() => {
              closePicker();
              void updateIssue(issueId, { parent_issue_id: null });
            }}
          >
            <Icon name="sub-issue" />
            <span className="palette-label">Remove parent (#{issue.parent.id})</span>
          </Command.Item>
        )}
        {candidates.map(({ id, issue: other }) => (
          <Command.Item key={id} value={`issue-${id}`} onSelect={() => choose(id)}>
            {other && meta ? (
              <StatusIcon category={d.categories.get(other.status.id) ?? defaultCategory({ ...other.status, is_closed: !!other.status.is_closed }, meta.trackers)} />
            ) : (
              <Icon name="issues" />
            )}
            <span className="palette-id">#{id}</span>
            <span className="palette-label">{other?.subject ?? "An issue Redline hasn't synced"}</span>
          </Command.Item>
        ))}
      </Command.List>
    </>
  );
}
