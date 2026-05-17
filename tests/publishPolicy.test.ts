import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PIN_KDF_ITERATIONS } from "../src/shared/pinPolicy.ts";
import { evaluatePublishPolicy, getEffectivePublishPolicy } from "../src/shared/publishPolicy.ts";
import type { ResolvedPluginPolicyProfileContribution } from "../src/shared/plugins.ts";

const strictProfile: ResolvedPluginPolicyProfileContribution = {
  id: "strict-pin",
  label: "엄격 발행 정책",
  description: "Requires stronger publish settings.",
  pluginId: "policy.strict-pin",
  pluginName: "엄격 발행 정책",
  minimumPinLength: 10,
  minimumKdfIterations: DEFAULT_PIN_KDF_ITERATIONS,
  requiredMetadata: ["recipientName", "documentNumber", "displayExpiresAt"],
  requireWatermark: true
};

const validMetadata = {
  title: "보안 정책 문서",
  issuer: "보안팀",
  recipientName: "수신자",
  documentNumber: "DOC-2026-0001",
  displayExpiresAt: "2026-12-31",
  watermarkText: "CONFIDENTIAL"
};

test("effective publish policy merges active policy profiles conservatively", () => {
  const requirements = getEffectivePublishPolicy([
    strictProfile,
    {
      ...strictProfile,
      id: "metadata-only",
      label: "메타데이터 필수",
      minimumPinLength: 8,
      minimumKdfIterations: 600_000,
      requiredMetadata: ["recipientName"],
      requireWatermark: false
    }
  ]);

  assert.equal(requirements.minimumPinLength, 10);
  assert.equal(requirements.minimumKdfIterations, DEFAULT_PIN_KDF_ITERATIONS);
  assert.deepEqual(requirements.requiredMetadata, ["recipientName", "documentNumber", "displayExpiresAt"]);
  assert.equal(requirements.requireWatermark, true);
  assert.deepEqual(requirements.profileLabels, ["엄격 발행 정책", "메타데이터 필수"]);
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
    policyProfiles: [strictProfile]
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.messages, [
    "PIN은 숫자, 문자, 기호를 포함해 10자리 이상 15자리 이내여야 합니다.",
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
    policyProfiles: [strictProfile]
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.messages, []);
  assert.equal(JSON.stringify(result).includes("Abc123!890"), false);
});
