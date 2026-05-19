import {
  DEFAULT_PIN_KDF_ITERATIONS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  evaluatePinPolicy,
  normalizePin
} from "./pinPolicy.ts";
import { DEFAULT_LOCALE, translate, type Locale } from "./i18n.ts";
import type { ResolvedPluginPolicyProfileContribution } from "./plugins.ts";

export const PUBLISH_POLICY_METADATA_FIELDS = [
  "recipientName",
  "documentNumber",
  "displayExpiresAt"
] as const;

export type PublishPolicyMetadataField = (typeof PUBLISH_POLICY_METADATA_FIELDS)[number];

export const CORE_PUBLISH_POLICY_MINIMUM_PIN_LENGTH = PIN_MIN_LENGTH;
export const CORE_PUBLISH_POLICY_MINIMUM_KDF_ITERATIONS = DEFAULT_PIN_KDF_ITERATIONS;
export const CORE_PUBLISH_POLICY_REQUIRED_METADATA_FIELDS = [
  "recipientName",
  "documentNumber",
  "displayExpiresAt"
] as const satisfies readonly PublishPolicyMetadataField[];
export const CORE_PUBLISH_POLICY_REQUIRE_WATERMARK = true;

export const PUBLISH_POLICY_METADATA_FIELD_LABELS = {
  recipientName: "수신자",
  documentNumber: "문서번호",
  displayExpiresAt: "만료일"
} as const satisfies Record<PublishPolicyMetadataField, string>;

export const PUBLISH_POLICY_METADATA_FIELD_REQUIRED_MESSAGES = {
  recipientName: "수신자를 입력하세요.",
  documentNumber: "문서번호를 입력하세요.",
  displayExpiresAt: "만료일을 입력하세요."
} as const satisfies Record<PublishPolicyMetadataField, string>;

export function publishPolicyMetadataFieldLabel(field: PublishPolicyMetadataField, locale: Locale = DEFAULT_LOCALE): string {
  return translate(locale, `policy.field.${field}`);
}

export interface PublishPolicyMetadata {
  title: string;
  issuer: string;
  recipientName: string;
  documentNumber: string;
  displayExpiresAt: string;
  watermarkText: string;
}

export interface EffectivePublishPolicy {
  minimumPinLength: number;
  minimumKdfIterations: number;
  requiredMetadata: PublishPolicyMetadataField[];
  requireWatermark: boolean;
  profileLabels: string[];
}

export interface PublishPolicyEvaluationInput {
  metadata: PublishPolicyMetadata;
  pin: string;
  pinConfirm: string;
  iterations: number;
  contentText: string;
  policyProfiles: readonly ResolvedPluginPolicyProfileContribution[];
  locale?: Locale;
}

export interface PublishPolicyEvaluation {
  valid: boolean;
  messages: string[];
  pinMessage: string;
  requirements: EffectivePublishPolicy;
}

function isBlank(value: string): boolean {
  return !value.normalize("NFKC").trim();
}

function uniqueMetadataFields(fields: readonly PublishPolicyMetadataField[]): PublishPolicyMetadataField[] {
  return [...new Set(fields)];
}

export function getEffectivePublishPolicy(
  policyProfiles: readonly ResolvedPluginPolicyProfileContribution[]
): EffectivePublishPolicy {
  const requiredMetadata = [
    ...CORE_PUBLISH_POLICY_REQUIRED_METADATA_FIELDS,
    ...policyProfiles.flatMap((profile) => profile.requiredMetadata ?? [])
  ];

  return {
    minimumPinLength: Math.max(
      CORE_PUBLISH_POLICY_MINIMUM_PIN_LENGTH,
      ...policyProfiles.map((profile) => profile.minimumPinLength ?? CORE_PUBLISH_POLICY_MINIMUM_PIN_LENGTH)
    ),
    minimumKdfIterations: Math.max(
      CORE_PUBLISH_POLICY_MINIMUM_KDF_ITERATIONS,
      ...policyProfiles.map((profile) => profile.minimumKdfIterations ?? CORE_PUBLISH_POLICY_MINIMUM_KDF_ITERATIONS)
    ),
    requiredMetadata: uniqueMetadataFields(requiredMetadata),
    requireWatermark: CORE_PUBLISH_POLICY_REQUIRE_WATERMARK,
    profileLabels: policyProfiles.map((profile) => profile.label)
  };
}

export function evaluatePublishPolicy(input: PublishPolicyEvaluationInput): PublishPolicyEvaluation {
  const requirements = getEffectivePublishPolicy(input.policyProfiles);
  const locale = input.locale ?? DEFAULT_LOCALE;
  const pinResult = evaluatePinPolicy(input.pin, {
    minLength: requirements.minimumPinLength,
    maxLength: PIN_MAX_LENGTH,
    locale
  });
  const messages: string[] = [];

  if (isBlank(input.metadata.title)) {
    messages.push(translate(locale, "policy.error.titleRequired"));
  }
  if (isBlank(input.metadata.issuer)) {
    messages.push(translate(locale, "policy.error.issuerRequired"));
  }

  if (!pinResult.valid) {
    messages.push(pinResult.message);
  }
  if (pinResult.normalizedPin !== normalizePin(input.pinConfirm)) {
    messages.push(translate(locale, "policy.error.pinConfirmMismatch"));
  }

  if (input.iterations < requirements.minimumKdfIterations) {
    messages.push(translate(locale, "policy.error.kdfIterations", { count: requirements.minimumKdfIterations.toLocaleString() }));
  }

  for (const field of requirements.requiredMetadata) {
    if (isBlank(input.metadata[field])) {
      messages.push(translate(locale, `policy.error.${field}Required`));
    }
  }

  if (requirements.requireWatermark && isBlank(input.metadata.watermarkText)) {
    messages.push(translate(locale, "policy.error.watermarkRequired"));
  }

  if (!input.contentText.trim()) {
    messages.push(translate(locale, "policy.error.contentRequired"));
  }

  return {
    valid: messages.length === 0,
    messages,
    pinMessage: pinResult.message,
    requirements
  };
}
