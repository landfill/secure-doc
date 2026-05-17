import {
  COMPAT_PIN_KDF_ITERATIONS,
  DEFAULT_PIN_KDF_ITERATIONS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH
} from "./pinPolicy.ts";
import {
  PUBLISH_POLICY_METADATA_FIELDS,
  type PublishPolicyMetadataField
} from "./publishPolicy.ts";
import { getViewerThemeContractViolations, type SecureDocViewerTheme } from "./branding.ts";

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

export interface PluginPolicyProfileContribution {
  id: string;
  label: string;
  description: string;
  minimumPinLength?: number;
  minimumKdfIterations?: number;
  requiredMetadata?: PublishPolicyMetadataField[];
  requireWatermark?: boolean;
}

export interface PluginBrandingPresetContribution {
  id: string;
  label: string;
  description: string;
  issuer?: string;
  watermarkText?: string;
  viewerTheme?: SecureDocViewerTheme;
}

export interface PluginContributes {
  settingsPanel?: boolean;
  publishActions?: PluginActionContribution[];
  templates?: PluginTemplateContribution[];
  historyActions?: PluginActionContribution[];
  policyProfiles?: PluginPolicyProfileContribution[];
  brandingPresets?: PluginBrandingPresetContribution[];
}

type PluginContributionPoint = keyof PluginContributes;

export const PLUGIN_CONTRIBUTION_PERMISSION_REQUIREMENTS = {
  settingsPanel: ["ui:settings"],
  publishActions: ["ui:publish-action"],
  templates: [],
  historyActions: ["history:read"],
  policyProfiles: [],
  brandingPresets: []
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

export interface ResolvedPluginPolicyProfileContribution extends PluginPolicyProfileContribution {
  pluginId: string;
  pluginName: string;
}

export interface ResolvedPluginBrandingPresetContribution extends PluginBrandingPresetContribution {
  pluginId: string;
  pluginName: string;
}

export interface PluginContributions {
  publishActions: ResolvedPluginActionContribution[];
  templates: ResolvedPluginTemplateContribution[];
  historyActions: ResolvedPluginActionContribution[];
  policyProfiles: ResolvedPluginPolicyProfileContribution[];
  brandingPresets: ResolvedPluginBrandingPresetContribution[];
}

export const GMAIL_SMTP_PLUGIN_ID = "delivery.smtp.gmail";
export const GMAIL_SMTP_SEND_ACTION_ID = "send-email";
export const GMAIL_SMTP_HISTORY_SEND_ACTION_ID = "send-email-from-history";
export const GMAIL_SMTP_TEST_ACTION_ID = "test-smtp";
export const GENERIC_SMTP_PLUGIN_ID = "delivery.smtp.generic";
export const GENERIC_SMTP_SEND_ACTION_ID = "send-email";
export const GENERIC_SMTP_HISTORY_SEND_ACTION_ID = "send-email-from-history";
export const GENERIC_SMTP_TEST_ACTION_ID = "test-smtp";
export const SMTP_DELIVERY_PLUGIN_IDS = [GMAIL_SMTP_PLUGIN_ID, GENERIC_SMTP_PLUGIN_ID] as const;
export type SmtpDeliveryPluginId = (typeof SMTP_DELIVERY_PLUGIN_IDS)[number];
export const AUDIT_INTEGRITY_PLUGIN_ID = "audit.integrity.report";
export const AUDIT_INTEGRITY_HISTORY_ACTION_ID = "verify-package";
export const STRICT_PIN_POLICY_PLUGIN_ID = "policy.strict-pin";
export const STRICT_PIN_POLICY_PROFILE_ID = "strict-pin";
export const COMPANY_DEFAULT_BRANDING_PLUGIN_ID = "branding.company-defaults";
export const COMPANY_DEFAULT_BRANDING_PRESET_ID = "company-defaults";

export const EMPTY_PLUGIN_CONTRIBUTIONS: PluginContributions = {
  publishActions: [],
  templates: [],
  historyActions: [],
  policyProfiles: [],
  brandingPresets: []
};

export function isSmtpDeliveryPluginId(pluginId: string): pluginId is SmtpDeliveryPluginId {
  return (SMTP_DELIVERY_PLUGIN_IDS as readonly string[]).includes(pluginId);
}

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
    id: GENERIC_SMTP_PLUGIN_ID,
    name: "Generic SMTP 발송",
    version: "0.1.0",
    description:
      "발행 이력과 패키지 해시를 검증한 뒤 설정된 SMTP 서버를 통해 보안 HTML 패키지를 전송합니다.",
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
          id: GENERIC_SMTP_SEND_ACTION_ID,
          label: "SMTP 발송",
          description: "방금 발행한 보안 HTML 패키지를 설정된 SMTP 서버로 전송합니다."
        }
      ],
      historyActions: [
        {
          id: GENERIC_SMTP_HISTORY_SEND_ACTION_ID,
          label: "SMTP 발송",
          description: "발행 이력에 저장된 보안 HTML 패키지를 설정된 SMTP 서버로 다시 전송합니다."
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
  },
  {
    id: COMPANY_DEFAULT_BRANDING_PLUGIN_ID,
    name: "조직 기본 브랜딩",
    version: "0.1.0",
    description:
      "문서 발행 시 조직명, 기본 워터마크, 오프라인 viewer 색상 preset을 적용합니다. 원격 이미지나 외부 리소스는 포함하지 않습니다.",
    category: "branding",
    permissions: [],
    contributes: {
      brandingPresets: [
        {
          id: COMPANY_DEFAULT_BRANDING_PRESET_ID,
          label: "조직 기본",
          description: "발행자, 워터마크, viewer 강조색을 조직 기본값으로 맞춥니다.",
          issuer: "Secure Doc Team",
          watermarkText: "CONFIDENTIAL",
          viewerTheme: {
            accentColor: "#2f6fed",
            accentSoftColor: "#eaf1ff",
            backgroundColor: "#f7f9fc",
            surfaceColor: "#ffffff",
            textColor: "#182033",
            mutedTextColor: "#637083",
            borderColor: "#d9e1ec",
            documentBorderColor: "#2f6fed"
          }
        }
      ]
    }
  },
  {
    id: STRICT_PIN_POLICY_PLUGIN_ID,
    name: "엄격 발행 정책",
    version: "0.1.0",
    description:
      "문서 발행 전 더 긴 PIN, 기본 PBKDF2 반복 횟수, 수신자/문서번호/만료일/워터마크 필수 입력을 적용합니다. 활성화하면 발행 다이얼로그에서 정책 위반 항목을 안내합니다.",
    category: "policy",
    permissions: [],
    contributes: {
      policyProfiles: [
        {
          id: STRICT_PIN_POLICY_PROFILE_ID,
          label: "엄격 발행 정책",
          description: "PIN 10자리 이상, PBKDF2 1,000,000회 이상, 수신자/문서번호/만료일/워터마크 입력을 요구합니다.",
          minimumPinLength: 10,
          minimumKdfIterations: DEFAULT_PIN_KDF_ITERATIONS,
          requiredMetadata: ["recipientName", "documentNumber", "displayExpiresAt"],
          requireWatermark: true
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

  for (const point of ["publishActions", "historyActions", "templates", "policyProfiles", "brandingPresets"] as const) {
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

  const validMetadataFields = new Set<string>(PUBLISH_POLICY_METADATA_FIELDS);
  for (const policyProfile of manifest.contributes.policyProfiles ?? []) {
    if (
      policyProfile.minimumPinLength !== undefined &&
      (!Number.isInteger(policyProfile.minimumPinLength) ||
        policyProfile.minimumPinLength < PIN_MIN_LENGTH ||
        policyProfile.minimumPinLength > PIN_MAX_LENGTH)
    ) {
      violations.push(`${manifest.id}: policy profile ${policyProfile.id} minimumPinLength must be between ${PIN_MIN_LENGTH} and ${PIN_MAX_LENGTH}`);
    }

    if (
      policyProfile.minimumKdfIterations !== undefined &&
      (!Number.isInteger(policyProfile.minimumKdfIterations) ||
        policyProfile.minimumKdfIterations < COMPAT_PIN_KDF_ITERATIONS)
    ) {
      violations.push(
        `${manifest.id}: policy profile ${policyProfile.id} minimumKdfIterations must be at least ${COMPAT_PIN_KDF_ITERATIONS}`
      );
    }

    for (const field of policyProfile.requiredMetadata ?? []) {
      if (!validMetadataFields.has(field)) {
        violations.push(`${manifest.id}: policy profile ${policyProfile.id} requiredMetadata field ${field} is not supported`);
      }
    }
  }

  for (const brandingPreset of manifest.contributes.brandingPresets ?? []) {
    violations.push(
      ...getViewerThemeContractViolations(
        `${manifest.id}: branding preset ${brandingPreset.id}`,
        brandingPreset.viewerTheme
      )
    );
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
    historyActions: [],
    policyProfiles: [],
    brandingPresets: []
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

    for (const policyProfile of manifest.contributes.policyProfiles ?? []) {
      contributions.policyProfiles.push({
        ...policyProfile,
        pluginId: manifest.id,
        pluginName: manifest.name
      });
    }

    for (const brandingPreset of manifest.contributes.brandingPresets ?? []) {
      contributions.brandingPresets.push({
        ...brandingPreset,
        pluginId: manifest.id,
        pluginName: manifest.name
      });
    }
  }

  return contributions;
}
