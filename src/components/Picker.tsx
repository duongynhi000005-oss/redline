import { Command } from "cmdk";
import { useEffect, useMemo, useState } from "react";
import { fieldValues, knownLabelValues, moveTargets, nextFieldValue, people } from "../lib/edit";
import type { PriorityLevel, StatusCategory } from "../lib/model";
import { activeCycle, defaultCategory, hueFor, teamOf } from "../lib/model";
import type { Issue, IssueChanges, IssueStatusRef, Metadata } from "../lib/types";
import type { RelationChoice } from "../lib/relations";
import { RELATION_CHOICES, relatedGroups, subIssues } from "../lib/relations";
import type { PickerKind } from "../state/app";
import { useApp } from "../state/app";
import { useIssueSearch, withFound } from "../state/search";
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
  /** For subscribers: whose subscription the option toggles. */
  watcher?: number;
}

const PLACEHOLDER: Record<PickerKind, string> = {
  status: "Change status…",
  priority: "Change priority…",
  assignee: "Assign to…",
  cycle: "Move to cycle…",
  labels: "Change labels…",
  relation: "Connect an issue…",
  subscribers: "Change subscribers…",
  tracker: "Change tracker…",
  category: "Change category…",
  project: "Move to project…",
  done: "Change % done…",
  field: "Set a value…",
};

/** The choices for one property of an issue. */
export function pickerOptions(
  kind: PickerKind,
  issue: Issue,
  meta: Metadata,
  d: Derived,
  allIssues: Iterable<Issue>,
  allowedStatuses: IssueStatusRef[] | null,
  fieldId?: number,
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
    case "subscribers": {
      const me = meta.user?.id;
      const watching = new Set((issue.watchers ?? []).map((w) => w.id));
      // Members first, you first; anyone already subscribed stays listed.
      const list = [...people(meta, issue.project.id)];
      for (const w of issue.watchers ?? []) if (!list.some((p) => p.id === w.id)) list.push(w);
      const ordered = [...list.filter((p) => p.id === me), ...list.filter((p) => p.id !== me)];
      return ordered.map((p) => ({
        key: `subscriber-${p.id}`,
        label: p.id === me ? `${p.name} (you)` : p.name,
        icon: <Avatar name={p.name} size={16} />,
        selected: watching.has(p.id),
        changes: {},
        watcher: p.id,
      }));
    }
    case "tracker": {
      const ids = new Set(meta.projects.find((p) => p.id === issue.project.id)?.trackers.map((t) => t.id) ?? []);
      return meta.trackers
        .filter((t) => ids.has(t.id) || t.id === issue.tracker.id)
        .map((t) => ({
          key: `tracker-${t.id}`,
          label: t.name,
          icon: <Icon name="tracker" />,
          selected: issue.tracker.id === t.id,
          changes: { tracker_id: t.id },
        }));
    }
    case "category": {
      const categories = meta.projects.find((p) => p.id === issue.project.id)?.issue_categories ?? [];
      return [
        {
          key: "category-none",
          label: "No category",
          icon: <Icon name="category" />,
          selected: !issue.category,
          changes: { category_id: null },
        },
        ...[...categories]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((c) => ({
            key: `category-${c.id}`,
            label: c.name,
            icon: <Icon name="category" />,
            selected: issue.category?.id === c.id,
            changes: { category_id: c.id },
          })),
      ];
    }
    case "project": {
      const targets = moveTargets(meta);
      if (!targets.some((p) => p.id === issue.project.id)) {
        const own = meta.projects.find((p) => p.id === issue.project.id);
        if (own) targets.unshift(own);
      }
      return targets.map((p) => ({
        key: `project-${p.id}`,
        label: p.name,
        group: p.parent ? p.parent.name : undefined,
        icon: <Icon name="project" />,
        selected: issue.project.id === p.id,
        changes: { project_id: p.id },
      }));
    }
    case "done":
      return Array.from({ length: 11 }, (_, i) => i * 10).map((n) => ({
        key: `done-${n}`,
        label: `${n}%`,
        icon: <Icon name="done" />,
        selected: (issue.done_ratio ?? 0) === n,
        changes: { done_ratio: n },
      }));
    case "field": {
      const field = issue.custom_fields.find((f) => f.id === fieldId);
      if (!field) return [];
      const current = fieldValues(field.value);
      const values = new Set([...(knownLabelValues(allIssues).get(field.id)?.values ?? []), ...current]);
      const options: PickerOption[] = [...values]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((value) => ({
          key: `field-${field.id}-${value}`,
          label: value,
          selected: current.includes(value),
          changes: { custom_fields: [{ id: field.id, value: nextFieldValue(current, !!field.multiple, value) }] },
        }));
      if (current.length && !field.multiple) {
        options.unshift({
          key: `field-${field.id}-clear`,
          label: `Clear ${field.name}`,
          selected: false,
          changes: { custom_fields: [{ id: field.id, value: "" }] },
        });
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
  const fieldName = useApp((s) =>
    s.picker?.kind === "field"
      ? s.issues.get(s.picker.issueId)?.custom_fields.find((f) => f.id === s.picker!.fieldId)?.name
      : undefined,
  );
  return (
    <Command.Dialog
      open={picker !== null}
      onOpenChange={(open) => !open && closePicker()}
      label={picker ? (fieldName ? `Set ${fieldName}…` : PLACEHOLDER[picker.kind]) : "Picker"}
      shouldFilter={false}
      overlayClassName="palette-overlay"
      contentClassName="palette picker"
    >
      {picker &&
        (picker.kind === "relation" ? (
          <RelationPickerContent issueId={picker.issueId} choice={picker.relation ?? null} />
        ) : (
          <PickerContent kind={picker.kind} issueId={picker.issueId} fieldId={picker.fieldId} issueIds={picker.issueIds} />
        ))}
    </Command.Dialog>
  );
}

/** Kinds whose options switch on and off, rather than pick one value. */
const TOGGLES: PickerKind[] = ["labels", "subscribers"];

function PickerContent({
  kind,
  issueId,
  fieldId,
  issueIds,
}: {
  kind: PickerKind;
  issueId: number;
  fieldId?: number;
  issueIds?: number[];
}) {
  const issue = useApp((s) => s.issues.get(issueId));
  const updateIssues = useApp((s) => s.updateIssues);
  const bulk = !!issueIds && issueIds.length > 1;
  const issues = useApp((s) => s.issues);
  const meta = useApp((s) => s.meta);
  const backend = useApp((s) => s.backend);
  const updateIssue = useApp((s) => s.updateIssue);
  const setWatcher = useApp((s) => s.setWatcher);
  const closePicker = useApp((s) => s.closePicker);
  const d = useDerived();
  const [query, setQuery] = useState("");
  const [allowed, setAllowed] = useState<IssueStatusRef[] | null>(null);

  // Redmine's workflow decides which statuses this user may pick.
  useEffect(() => {
    if (kind !== "status" || !backend || bulk) return;
    let live = true;
    backend
      .getIssueDetails(issueId, true)
      .then((details) => live && setAllowed(details.allowedStatuses))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [kind, issueId, backend, bulk]);

  // With several issues, each gets its own options (assignees depend on the
  // project, say); an option shows as picked when it is for all of them.
  const perIssue = useMemo(
    () =>
      bulk && meta
        ? issueIds!.flatMap((id) => {
            const i = issues.get(id);
            return i ? [{ issue: i, options: pickerOptions(kind, i, meta, d, issues.values(), null, fieldId) }] : [];
          })
        : [],
    [bulk, issueIds, issues, meta, kind, d, fieldId],
  );
  const options = useMemo(() => {
    const own = issue && meta ? pickerOptions(kind, issue, meta, d, issues.values(), allowed, fieldId) : [];
    if (!bulk) return own;
    return own.map((o) => ({
      ...o,
      selected: perIssue.every((p) => p.options.find((x) => x.key === o.key)?.selected),
    }));
  }, [kind, issue, meta, d, issues, allowed, fieldId, bulk, perIssue]);
  const field = kind === "field" ? issue?.custom_fields.find((f) => f.id === fieldId) : undefined;
  const filtered = query.trim() ? options.filter((o) => matchesQuery(`${o.label} ${o.group ?? ""}`, query)) : options;
  // A custom field can take a value no issue has yet: offer what was typed.
  const typed = query.trim();
  const visible =
    field && typed && !options.some((o) => o.label === typed)
      ? [
          {
            key: `field-${field.id}-typed`,
            label: `Set to “${typed}”`,
            selected: false,
            changes: {
              custom_fields: [{ id: field.id, value: nextFieldValue(fieldValues(field.value), !!field.multiple, typed) }],
            },
          },
          ...filtered,
        ]
      : filtered;
  const groups = [...new Set(visible.map((o) => o.group ?? ""))];

  if (!issue) return null;

  const choose = (option: PickerOption) => {
    if (bulk) chooseForAll(option);
    else if (option.watcher !== undefined) void setWatcher(issueId, option.watcher, !option.selected);
    else void updateIssue(issueId, option.changes);
    // Labels, subscribers and multi-value fields toggle; other properties take one value.
    if (kind !== "labels" && kind !== "subscribers" && !field?.multiple) closePicker();
    if (field?.multiple) setQuery("");
  };

  function chooseForAll(option: PickerOption) {
    const toggles = TOGGLES.includes(kind) || !!field?.multiple;
    // A toggle picked on every issue comes off them all; otherwise it goes on where it's missing.
    const want = toggles ? !option.selected : true;
    const changes: [number, IssueChanges][] = [];
    for (const p of perIssue) {
      if (option.key.endsWith("-typed") && field) {
        const own = p.issue.custom_fields.find((f) => f.id === field.id);
        const value = nextFieldValue(fieldValues(own?.value), !!field.multiple, typed);
        changes.push([p.issue.id, { custom_fields: [{ id: field.id, value }] }]);
        continue;
      }
      const own = p.options.find((x) => x.key === option.key);
      if (own && !!own.selected !== want) changes.push([p.issue.id, own.changes]);
    }
    if (changes.length) void updateIssues(changes, perIssue.length - changes.length);
    else useApp.setState({ toast: "Nothing to change: they all have that already." });
  }

  return (
    <>
      <div className="picker-context">{bulk ? `${perIssue.length} issues` : `#${issue.id} ${issue.subject}`}</div>
      <Command.Input value={query} onValueChange={setQuery} placeholder={field ? `Set ${field.name}…` : PLACEHOLDER[kind]} />
      <Command.List>
        <Command.Empty>
          {kind === "labels" ? "This issue has no label fields." : field ? "Type a value to set it." : "No matches."}
        </Command.Empty>
        {groups.map((group) => (
          <Command.Group key={group} heading={group || undefined}>
            {visible
              .filter((o) => (o.group ?? "") === group)
              .map((o) => (
                <Command.Item key={o.key} value={o.key} onSelect={() => choose(o)}>
                  {o.icon}
                  <span className="palette-label">{o.label}</span>
                  {o.selected && (
                    <span className="picker-check" aria-label="Selected">
                      ✓
                    </span>
                  )}
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
  found: Issue[] = [],
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
  const list: { id: number; issue?: Issue }[] = [...withFound(issues, found)]
    .filter((i) => !taken.has(i.id) && (!q || matchesQuery(`#${i.id} ${i.subject}`, query)))
    .sort((a, b) => (b.id === wanted ? 1 : 0) - (a.id === wanted ? 1 : 0) || b.updated_on.localeCompare(a.updated_on))
    .slice(0, RELATION_PICKER_LIMIT)
    .map((i) => ({ id: i.id, issue: i }));
  // An issue Redline hasn't loaded (another project, say) can still be named by number.
  if (wanted !== null && wanted > 0 && !taken.has(wanted) && !list.some((i) => i.id === wanted)) list.unshift({ id: wanted });
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

  const { found } = useIssueSearch(query, !!choice);
  const candidates = useMemo(
    () => (issue && choice ? relationCandidates(issue, choice, issues, query, found) : []),
    [issue, choice, issues, query, found],
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
            <Command.Item
              key={c.choice}
              value={c.choice}
              onSelect={() => {
                // The words that found the kind of link aren't an issue search.
                setQuery("");
                openPicker("relation", issueId, c.choice);
              }}
            >
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
      {/* A new input, so focus is in it again after a click picked the kind of link. */}
      <Command.Input key={choice} autoFocus value={query} onValueChange={setQuery} placeholder={placeholder} />
      <Command.List>
        <Command.Empty>No matching issues. Type an issue number to use one Redline hasn't loaded.</Command.Empty>
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
              <StatusIcon
                category={
                  d.categories.get(other.status.id) ??
                  defaultCategory({ ...other.status, is_closed: !!other.status.is_closed }, meta.trackers)
                }
              />
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
