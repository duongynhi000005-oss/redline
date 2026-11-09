import { Command } from "cmdk";
import { useMemo, useState } from "react";
import type { Filter, FilterField, FilterOption } from "../lib/filters";
import { FILTER_FIELDS, describeFilter, filterOptions, toggleFilterValue } from "../lib/filters";
import type { PriorityLevel, StatusCategory } from "../lib/model";
import { hueFor } from "../lib/model";
import type { Issue } from "../lib/types";
import type { Route } from "../state/app";
import { routeKey, useApp } from "../state/app";
import { issuesForRoute, useDerived } from "../state/derived";
import { Avatar } from "./Avatar";
import { matchesQuery } from "./CommandPalette";
import { Icon, PriorityIcon, StatusIcon } from "./icons";

/** The issues a list shows before its filters, which the filter menu offers values from. */
export function useRouteIssues(route: Route): Issue[] {
  const issues = useApp((s) => s.issues);
  const meta = useApp((s) => s.meta);
  const account = useApp((s) => s.account);
  const d = useDerived();
  return useMemo(
    () => (meta ? issuesForRoute(route, issues.values(), d, account?.userId, meta) : []),
    [route, issues, d, account, meta],
  );
}

/** Fields that would tell the list nothing new are left out. */
function fieldsFor(route: Route): FilterField[] {
  return FILTER_FIELDS.map((f) => f.field).filter(
    (f) => !(f === "project" && route.view === "project") && !(f === "cycle" && route.view === "cycle"),
  );
}

function optionIcon(field: FilterField, option: FilterOption, levels: Map<number, PriorityLevel>) {
  switch (field) {
    case "status":
      return <StatusIcon category={option.value as StatusCategory} />;
    case "priority":
      return <PriorityIcon level={levels.get(Number(option.value)) ?? 0} />;
    case "assignee":
      return <Avatar name={option.value === "none" ? null : option.label.replace(/ \(you\)$/, "")} size={16} />;
    case "label":
      return option.value === "none" ? (
        <span className="chip-dot chip-dot-empty" />
      ) : (
        <span
          className="chip-dot"
          style={{
            background: `hsl(${hueFor(option.value.replace(":", ""))} 55% 55%)`,
          }}
        />
      );
    case "cycle":
      return <Icon name="cycle" />;
    case "project":
      return <Icon name="project" />;
    case "tracker":
      return null;
  }
}

function useFilterOptions(field: FilterField | null, route: Route): FilterOption[] {
  const meta = useApp((s) => s.meta);
  const me = useApp((s) => s.account?.userId);
  const d = useDerived();
  const base = useRouteIssues(route);
  return useMemo(() => (field && meta ? filterOptions(field, base, meta, d, me) : []), [field, base, meta, d, me]);
}

/** Linear's F menu: pick a field, then tick the values to keep. */
export function FilterMenu() {
  const menu = useApp((s) => s.filterMenu);
  const close = useApp((s) => s.closeFilterMenu);
  return (
    <Command.Dialog
      open={menu !== null}
      onOpenChange={(open) => !open && close()}
      label="Filter"
      shouldFilter={false}
      overlayClassName="palette-overlay"
      contentClassName="palette picker"
    >
      {menu && <FilterMenuContent key={menu.field ?? ""} field={menu.field} />}
    </Command.Dialog>
  );
}

function FilterMenuContent({ field }: { field: FilterField | null }) {
  const route = useApp((s) => s.route);
  const filters = useApp((s) => s.filters[routeKey(s.route)]);
  const setFilters = useApp((s) => s.setFilters);
  const openFilterMenu = useApp((s) => s.openFilterMenu);
  const d = useDerived();
  const options = useFilterOptions(field, route);
  const [query, setQuery] = useState("");
  const current = filters ?? [];
  const selected = new Set(current.find((f) => f.field === field)?.values ?? []);

  const fields = FILTER_FIELDS.filter((f) => fieldsFor(route).includes(f.field));
  const q = query.trim();

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Backspace on an empty search goes back to the fields, as in Linear.
    if (field && e.key === "Backspace" && !query) {
      e.preventDefault();
      openFilterMenu(null);
    }
  };

  if (!field) {
    const visible = q ? fields.filter((f) => matchesQuery(f.label, q)) : fields;
    return (
      <>
        <Command.Input value={query} onValueChange={setQuery} placeholder="Filter by…" onKeyDown={onKeyDown} />
        <Command.List>
          <Command.Empty>No matches.</Command.Empty>
          {visible.map((f) => (
            <Command.Item key={f.field} value={f.field} onSelect={() => openFilterMenu(f.field)}>
              <Icon name="filter" />
              <span className="palette-label">{f.label}</span>
              {current.some((x) => x.field === f.field) && (
                <span className="picker-check" aria-label="Filtered">
                  ●
                </span>
              )}
            </Command.Item>
          ))}
          {current.length > 0 && (
            <Command.Item value="clear" onSelect={() => setFilters(routeKey(route), [])}>
              <Icon name="close" />
              <span className="palette-label">Clear filters</span>
            </Command.Item>
          )}
        </Command.List>
      </>
    );
  }

  const label = FILTER_FIELDS.find((f) => f.field === field)?.label ?? field;
  const visible = q ? options.filter((o) => matchesQuery(o.label, q)) : options;
  return (
    <>
      <div className="picker-context">Filter: {label}</div>
      <Command.Input value={query} onValueChange={setQuery} placeholder={`${label} is…`} onKeyDown={onKeyDown} />
      <Command.List>
        <Command.Empty>{options.length ? "No matches." : "No values in this view."}</Command.Empty>
        {visible.map((o) => (
          <Command.Item
            key={o.value}
            value={o.value}
            onSelect={() => setFilters(routeKey(route), toggleFilterValue(current, field, o.value))}
          >
            {optionIcon(field, o, d.priorities)}
            <span className="palette-label">{o.label}</span>
            <span className="palette-count">{o.count}</span>
            {selected.has(o.value) && (
              <span className="picker-check" aria-label="Selected">
                ✓
              </span>
            )}
          </Command.Item>
        ))}
      </Command.List>
    </>
  );
}

function FilterChip({ filter, route }: { filter: Filter; route: Route }) {
  const options = useFilterOptions(filter.field, route);
  const openFilterMenu = useApp((s) => s.openFilterMenu);
  const setFilters = useApp((s) => s.setFilters);
  const filters = useApp((s) => s.filters[routeKey(s.route)] ?? []);
  const text = describeFilter(filter, options);
  return (
    <span className="filter-chip">
      <button type="button" className="filter-chip-body" onClick={() => openFilterMenu(filter.field)}>
        <span className="filter-chip-field">{text.field}</span> <span className="filter-chip-op">is</span>{" "}
        <span>{text.values}</span>
      </button>
      <button
        type="button"
        className="filter-chip-remove"
        aria-label={`Remove ${text.field} filter`}
        onClick={() =>
          setFilters(
            routeKey(route),
            filters.filter((f) => f.field !== filter.field),
          )
        }
      >
        <Icon name="close" />
      </button>
    </span>
  );
}

/** The row of active filters under a list's header. */
export function FilterBar({ route, shown, total }: { route: Route; shown: number; total: number }) {
  const filters = useApp((s) => s.filters[routeKey(route)]);
  const setFilters = useApp((s) => s.setFilters);
  const openFilterMenu = useApp((s) => s.openFilterMenu);
  if (!filters?.length) return null;
  return (
    <div className="filter-bar" aria-label="Filters">
      {filters.map((f) => (
        <FilterChip key={f.field} filter={f} route={route} />
      ))}
      <button type="button" className="filter-add" aria-label="Add filter" onClick={() => openFilterMenu(null)}>
        <Icon name="plus" />
      </button>
      <span className="filter-summary">
        {shown} of {total}
      </span>
      <button type="button" className="filter-clear" onClick={() => setFilters(routeKey(route), [])}>
        Clear
      </button>
    </div>
  );
}
