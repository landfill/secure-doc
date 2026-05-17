export const PLUGIN_CATEGORIES = ["delivery", "template", "audit", "branding", "policy"] as const;

export type PluginCategory = (typeof PLUGIN_CATEGORIES)[number];

export const PLUGIN_PERMISSIONS = [
  "network:smtp",
  "secret:safeStorage",
  "package:read",
  "history:read",
  "history:write",
  "ui:settings",
  "ui:publish-action"
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

export interface PluginActionContribution {
  id: string;
  label: string;
  description: string;
}

export interface PluginTemplateContribution {
  id: string;
  label: string;
  description: string;
}

export interface PluginContributes {
  settingsPanel?: boolean;
  publishActions?: PluginActionContribution[];
  templates?: PluginTemplateContribution[];
  historyActions?: PluginActionContribution[];
}

type PluginContributionPoint = keyof PluginContributes;

export const PLUGIN_CONTRIBUTION_PERMISSION_REQUIREMENTS = {
  settingsPanel: ["ui:settings"],
  publishActions: ["ui:publish-action"],
  templates: [],
  historyActions: ["history:read"]
} as const satisfies Record<PluginContributionPoint, readonly PluginPermission[]>;

export const PLUGIN_ID_PREFIXES_BY_CATEGORY = {
  delivery: ["delivery."],
  template: ["template-pack."],
  audit: ["audit."],
  branding: ["branding."],
  policy: ["policy."]
} as const satisfies Record<PluginCategory, readonly string[]>;

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  category: PluginCategory;
  permissions: PluginPermission[];
  contributes: PluginContributes;
}

export interface PluginDescriptor extends PluginManifest {
  enabled: boolean;
}

export interface ResolvedPluginActionContribution extends PluginActionContribution {
  pluginId: string;
  pluginName: string;
}

export interface ResolvedPluginTemplateContribution extends PluginTemplateContribution {
  pluginId: string;
  pluginName: string;
}

export interface PluginContributions {
  publishActions: ResolvedPluginActionContribution[];
  templates: ResolvedPluginTemplateContribution[];
  historyActions: ResolvedPluginActionContribution[];
}

export const GMAIL_SMTP_PLUGIN_ID = "delivery.smtp.gmail";
export const GMAIL_SMTP_SEND_ACTION_ID = "send-email";
export const GMAIL_SMTP_HISTORY_SEND_ACTION_ID = "send-email-from-history";
export const GMAIL_SMTP_TEST_ACTION_ID = "test-smtp";
export const AUDIT_INTEGRITY_PLUGIN_ID = "audit.integrity.report";
export const AUDIT_INTEGRITY_HISTORY_ACTION_ID = "verify-package";

export const EMPTY_PLUGIN_CONTRIBUTIONS: PluginContributions = {
  publishActions: [],
  templates: [],
  historyActions: []
};

export const BUILT_IN_PLUGIN_MANIFESTS: PluginManifest[] = [
  {
    id: GMAIL_SMTP_PLUGIN_ID,
    name: "Gmail SMTP 발송",
    version: "0.1.0",
    description:
      "보안 HTML 파일을 Gmail SMTP 메일에 첨부해 외부 수신자에게 보냅니다. 활성화하면 SMTP 설정 패널과 발행 직후/발행 이력 이메일 발송 버튼이 나타납니다.",
    category: "delivery",
    permissions: [
      "network:smtp",
      "secret:safeStorage",
      "package:read",
      "history:read",
      "ui:settings",
      "ui:publish-action"
    ],
    contributes: {
      settingsPanel: true,
      publishActions: [
        {
          id: GMAIL_SMTP_SEND_ACTION_ID,
          label: "이메일 발송",
          description: "방금 발행한 보안 HTML 파일을 수신자 이메일로 첨부 발송합니다."
        }
      ],
      historyActions: [
        {
          id: GMAIL_SMTP_HISTORY_SEND_ACTION_ID,
          label: "이메일 발송",
          description: "이미 발행 이력에 저장된 보안 HTML 파일을 다시 이메일로 첨부 발송합니다."
        }
      ]
    }
  },
  {
    id: AUDIT_INTEGRITY_PLUGIN_ID,
    name: "패키지 무결성 감사",
    version: "0.1.0",
    description:
      "저장된 보안 HTML 파일이 발행 당시 기록된 SHA-256 해시와 일치하는지 검사합니다. 활성화하면 발행 이력에서 정상/파일 없음/변조 의심 리포트를 볼 수 있습니다.",
    category: "audit",
    permissions: ["history:read", "package:read"],
    contributes: {
      historyActions: [
        {
          id: AUDIT_INTEGRITY_HISTORY_ACTION_ID,
          label: "무결성 검증",
          description: "발행 이력의 SHA-256 해시와 현재 저장된 HTML 파일을 비교해 변조 여부를 확인합니다."
        }
      ]
    }
  }
];

function isNonEmptyContribution(value: PluginContributes[PluginContributionPoint]): boolean {
  return Array.isArray(value) ? value.length > 0 : value === true;
}

function findDuplicateIds(items: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of items) {
    if (seen.has(item.id)) {
      duplicates.add(item.id);
    }
    seen.add(item.id);
  }

  return [...duplicates];
}

export function getPluginManifestContractViolations(manifest: PluginManifest): string[] {
  const violations: string[] = [];
  const idPattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

  if (!idPattern.test(manifest.id)) {
    violations.push(`${manifest.id}: plugin id must use lowercase dot/dash segments`);
  }

  if (!PLUGIN_ID_PREFIXES_BY_CATEGORY[manifest.category].some((prefix) => manifest.id.startsWith(prefix))) {
    violations.push(`${manifest.id}: plugin id must match the ${manifest.category} category prefix`);
  }

  const permissions = new Set(manifest.permissions);
  for (const contributionPoint of Object.keys(PLUGIN_CONTRIBUTION_PERMISSION_REQUIREMENTS) as PluginContributionPoint[]) {
    if (!isNonEmptyContribution(manifest.contributes[contributionPoint])) {
      continue;
    }

    for (const permission of PLUGIN_CONTRIBUTION_PERMISSION_REQUIREMENTS[contributionPoint]) {
      if (!permissions.has(permission)) {
        violations.push(`${manifest.id}: ${contributionPoint} requires ${permission}`);
      }
    }
  }

  for (const point of ["publishActions", "historyActions", "templates"] as const) {
    const contributions = manifest.contributes[point] ?? [];
    for (const duplicateId of findDuplicateIds(contributions)) {
      violations.push(`${manifest.id}: duplicate ${point} id ${duplicateId}`);
    }

    for (const contribution of contributions) {
      if (!idPattern.test(contribution.id)) {
        violations.push(`${manifest.id}: ${point} id ${contribution.id} must use lowercase dot/dash segments`);
      }
    }
  }

  return violations;
}

export function buildPluginDescriptors(
  enabledPluginIds: readonly string[],
  manifests: readonly PluginManifest[] = BUILT_IN_PLUGIN_MANIFESTS
): PluginDescriptor[] {
  const enabledIds = new Set(enabledPluginIds);
  return manifests.map((manifest) => ({
    ...manifest,
    enabled: enabledIds.has(manifest.id)
  }));
}

export function getEnabledPluginContributions(
  enabledPluginIds: readonly string[],
  manifests: readonly PluginManifest[] = BUILT_IN_PLUGIN_MANIFESTS
): PluginContributions {
  const enabledIds = new Set(enabledPluginIds);
  const contributions: PluginContributions = {
    publishActions: [],
    templates: [],
    historyActions: []
  };

  for (const manifest of manifests) {
    if (!enabledIds.has(manifest.id)) {
      continue;
    }

    for (const action of manifest.contributes.publishActions ?? []) {
      contributions.publishActions.push({
        ...action,
        pluginId: manifest.id,
        pluginName: manifest.name
      });
    }

    for (const template of manifest.contributes.templates ?? []) {
      contributions.templates.push({
        ...template,
        pluginId: manifest.id,
        pluginName: manifest.name
      });
    }

    for (const action of manifest.contributes.historyActions ?? []) {
      contributions.historyActions.push({
        ...action,
        pluginId: manifest.id,
        pluginName: manifest.name
      });
    }

  }

  return contributions;
}
