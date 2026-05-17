import {
  COMPAT_PIN_KDF_ITERATIONS,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  evaluatePinPolicy,
  normalizePin
} from "./pinPolicy.ts";
import type { ResolvedPluginPolicyProfileContribution } from "./plugins.ts";

export const PUBLISH_POLICY_METADATA_FIELDS = [
  "recipientName",
  "documentNumber",
  "displayExpiresAt"
] as const;

export type PublishPolicyMetadataField = (typeof PUBLISH_POLICY_METADATA_FIELDS)[number];

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
  const requiredMetadata = policyProfiles.flatMap((profile) => profile.requiredMetadata ?? []);

  return {
    minimumPinLength: Math.max(PIN_MIN_LENGTH, ...policyProfiles.map((profile) => profile.minimumPinLength ?? PIN_MIN_LENGTH)),
    minimumKdfIterations: Math.max(
      COMPAT_PIN_KDF_ITERATIONS,
      ...policyProfiles.map((profile) => profile.minimumKdfIterations ?? COMPAT_PIN_KDF_ITERATIONS)
    ),
    requiredMetadata: uniqueMetadataFields(requiredMetadata),
    requireWatermark: policyProfiles.some((profile) => profile.requireWatermark === true),
    profileLabels: policyProfiles.map((profile) => profile.label)
  };
}

export function evaluatePublishPolicy(input: PublishPolicyEvaluationInput): PublishPolicyEvaluation {
  const requirements = getEffectivePublishPolicy(input.policyProfiles);
  const pinResult = evaluatePinPolicy(input.pin, {
    minLength: requirements.minimumPinLength,
    maxLength: PIN_MAX_LENGTH
  });
  const messages: string[] = [];

  if (isBlank(input.metadata.title)) {
    messages.push("문서 제목을 입력하세요.");
  }
  if (isBlank(input.metadata.issuer)) {
    messages.push("발행자를 입력하세요.");
  }

  if (!pinResult.valid) {
    messages.push(pinResult.message);
  }
  if (pinResult.normalizedPin !== normalizePin(input.pinConfirm)) {
    messages.push("PIN 확인 입력이 일치하지 않습니다.");
  }

  if (input.iterations < requirements.minimumKdfIterations) {
    messages.push(`PBKDF2 반복 횟수는 현재 정책에 따라 ${requirements.minimumKdfIterations.toLocaleString()}회 이상이어야 합니다.`);
  }

  for (const field of requirements.requiredMetadata) {
    if (isBlank(input.metadata[field])) {
      messages.push(PUBLISH_POLICY_METADATA_FIELD_REQUIRED_MESSAGES[field]);
    }
  }

  if (requirements.requireWatermark && isBlank(input.metadata.watermarkText)) {
    messages.push("워터마크 문구를 입력하세요.");
  }

  if (!input.contentText.trim()) {
    messages.push("암호화할 본문을 입력하세요.");
  }

  return {
    valid: messages.length === 0,
    messages,
    pinMessage: pinResult.message,
    requirements
  };
}
