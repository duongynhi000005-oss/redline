import { hueFor, initials } from "../lib/model";

export function Avatar({ name, size = 18 }: { name: string | null | undefined; size?: number }) {
  if (!name) {
    return (
      <span className="avatar avatar-empty" style={{ width: size, height: size }} aria-label="Unassigned" role="img" />
    );
  }
  return (
    <span
      className="avatar"
      role="img"
      aria-label={name}
      title={name}
      style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${hueFor(name)} 45% 48%)` }}
    >
      {initials(name)}
    </span>
  );
}
