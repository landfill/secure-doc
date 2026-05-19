import type { ReactElement } from "react";

type NavIconTarget = "document" | "history" | "security" | "plugins" | "settings";

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

  if (target === "security") {
    return (
      <svg className="nav-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path {...commonProps} d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
        <path {...commonProps} d="m9 12 2 2 4-4" />
      </svg>
    );
  }

  if (target === "plugins") {
    return (
      <svg className="nav-icon" aria-hidden="true" viewBox="0 0 24 24">
        <path {...commonProps} d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z" />
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
