export interface SecureDocViewerTheme {
  accentColor?: string;
  accentSoftColor?: string;
  backgroundColor?: string;
  surfaceColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  borderColor?: string;
  documentBorderColor?: string;
}

export const VIEWER_THEME_COLOR_KEYS = [
  "accentColor",
  "accentSoftColor",
  "backgroundColor",
  "surfaceColor",
  "textColor",
  "mutedTextColor",
  "borderColor",
  "documentBorderColor"
] as const satisfies readonly (keyof SecureDocViewerTheme)[];

export function isSafeViewerThemeColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function compactViewerTheme(theme: SecureDocViewerTheme | undefined): SecureDocViewerTheme | undefined {
  if (!theme) {
    return undefined;
  }

  const compacted: SecureDocViewerTheme = {};
  for (const key of VIEWER_THEME_COLOR_KEYS) {
    const value = theme[key];
    if (isSafeViewerThemeColor(value)) {
      compacted[key] = value.toLowerCase();
    }
  }

  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

export function getViewerThemeContractViolations(
  owner: string,
  theme: SecureDocViewerTheme | undefined
): string[] {
  if (!theme) {
    return [];
  }

  const violations: string[] = [];
  for (const key of VIEWER_THEME_COLOR_KEYS) {
    const value = theme[key];
    if (value !== undefined && !isSafeViewerThemeColor(value)) {
      violations.push(`${owner}: viewer theme ${key} must be a #rrggbb color`);
    }
  }

  for (const key of Object.keys(theme)) {
    if (!(VIEWER_THEME_COLOR_KEYS as readonly string[]).includes(key)) {
      violations.push(`${owner}: viewer theme ${key} is not supported`);
    }
  }

  return violations;
}
