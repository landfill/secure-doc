import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PIN_KDF_ITERATIONS } from "../src/shared/pinPolicy.ts";
import {
  CORE_PUBLISH_POLICY_MINIMUM_KDF_ITERATIONS,
  CORE_PUBLISH_POLICY_MINIMUM_PIN_LENGTH,
  evaluatePublishPolicy,
  getEffectivePublishPolicy
} from "../src/shared/publishPolicy.ts";
import type { ResolvedPluginPolicyProfileContribution } from "../src/shared/plugins.ts";

const extraStrictProfile: ResolvedPluginPolicyProfileContribution = {
  id: "extra-strict",
  label: "추가 엄격 정책",
  description: "Requires stronger publish settings.",
  pluginId: "policy.extra-strict",
  pluginName: "추가 엄격 정책",
  minimumPinLength: 12,
  minimumKdfIterations: 1_200_000,
  requiredMetadata: ["recipientName"],
  requireWatermark: false
};

const validMetadata = {
  title: "보안 정책 문서",
  issuer: "보안팀",
  recipientName: "수신자",
  documentNumber: "DOC-2026-0001",
  displayExpiresAt: "2026-12-31",
  watermarkText: "CONFIDENTIAL"
};

test("effective publish policy applies strict core requirements without plugins", () => {
  const requirements = getEffectivePublishPolicy([]);

  assert.equal(requirements.minimumPinLength, CORE_PUBLISH_POLICY_MINIMUM_PIN_LENGTH);
  assert.equal(requirements.minimumKdfIterations, CORE_PUBLISH_POLICY_MINIMUM_KDF_ITERATIONS);
  assert.deepEqual(requirements.requiredMetadata, ["recipientName", "documentNumber", "displayExpiresAt"]);
  assert.equal(requirements.requireWatermark, true);
  assert.deepEqual(requirements.profileLabels, []);
});

test("effective publish policy merges stronger active policy profiles conservatively", () => {
  const requirements = getEffectivePublishPolicy([
    extraStrictProfile,
    {
      ...extraStrictProfile,
      id: "maximum-pin",
      label: "최대 PIN 정책",
      minimumPinLength: 15,
      minimumKdfIterations: DEFAULT_PIN_KDF_ITERATIONS,
      requiredMetadata: ["documentNumber"],
      requireWatermark: false
    }
  ]);

  assert.equal(requirements.minimumPinLength, 15);
  assert.equal(requirements.minimumKdfIterations, 1_200_000);
  assert.deepEqual(requirements.requiredMetadata, ["recipientName", "documentNumber", "displayExpiresAt"]);
  assert.equal(requirements.requireWatermark, true);
  assert.deepEqual(requirements.profileLabels, ["추가 엄격 정책", "최대 PIN 정책"]);
});

test("publish policy blocks weak PIN, weak KDF, and missing required metadata", () => {
  const result = evaluatePublishPolicy({
    metadata: {
      ...validMetadata,
      recipientName: "",
      documentNumber: "",
      displayExpiresAt: "",
      watermarkText: ""
    },
    pin: "Abc123!",
    pinConfirm: "Abc123!",
    iterations: 600_000,
    contentText: "본문",
    policyProfiles: []
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.messages, [
    "PBKDF2 반복 횟수는 현재 정책에 따라 1,000,000회 이상이어야 합니다.",
    "수신자를 입력하세요.",
    "문서번호를 입력하세요.",
    "만료일을 입력하세요.",
    "워터마크 문구를 입력하세요."
  ]);
});

test("publish policy accepts valid documents without storing sensitive values", () => {
  const result = evaluatePublishPolicy({
    metadata: validMetadata,
    pin: "Abc123!890",
    pinConfirm: "Abc123!890",
    iterations: DEFAULT_PIN_KDF_ITERATIONS,
    contentText: "본문",
    policyProfiles: []
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.messages, []);
  assert.equal(JSON.stringify(result).includes("Abc123!890"), false);
});
