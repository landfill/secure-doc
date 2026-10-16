import type { ReactElement } from "react";

type NavIconTarget = "document" | "history" | "settings";

const commonProps = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  strokeWidth: 1.85
};

export function NavIcon({ target }: { target: NavIconTarget }): ReactElement {
  if (target === "document") {
    return (
      <svg className="nav-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path {...commonProps} d="M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v1" />
        <path {...commonProps} d="M14 2v4a2 2 0 0 0 2 2h4" />
        <rect {...commonProps} width="8" height="5" x="2" y="13" rx="1" />
        <path {...commonProps} d="M8 13v-2a2 2 0 1 0-4 0v2" />
      </svg>
    );
  }

  if (target === "history") {
    return (
      <svg className="nav-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path {...commonProps} d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path {...commonProps} d="M3 3v5h5" />
        <path {...commonProps} d="M12 7v5l4 2" />
      </svg>
    );
  }

  return (
    <svg className="nav-icon" aria-hidden="true" viewBox="0 0 24 24">
      <path {...commonProps} d="M14 17H5" />
      <path {...commonProps} d="M19 7h-9" />
      <circle {...commonProps} cx="17" cy="17" r="3" />
      <circle {...commonProps} cx="7" cy="7" r="3" />
    </svg>
  );
}
