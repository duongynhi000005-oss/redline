import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./icons";

export interface MenuItem {
  label: string;
  icon: IconName;
  danger?: boolean;
  run: () => void;
}

/** A "…" button with a menu of actions; arrow keys move, Escape closes. Nothing shows when there are no actions. */
export function MenuButton({ label, menuLabel, items }: { label: string; menuLabel: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!items.length) return null;

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="issue-menu">
      <button
        ref={buttonRef}
        type="button"
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={open ? undefined : label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          role="menu"
          aria-label={menuLabel}
          className="issue-menu-panel"
          onKeyDown={(e) => {
            const all = [...(menuRef.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const at = all.indexOf(document.activeElement as HTMLElement);
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = (at + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
              all[next]?.focus();
            }
          }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={item.danger ? "is-danger" : undefined}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
