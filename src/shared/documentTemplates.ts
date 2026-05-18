import type { ResolvedPluginTemplateContribution } from "./plugins.ts";

export const DOCUMENT_TEMPLATE_CATEGORIES = ["notice", "contract", "policy", "general"] as const;

export type DocumentTemplateCategory = (typeof DOCUMENT_TEMPLATE_CATEGORIES)[number];

export interface DocumentTemplateMetadata {
  title: string;
  issuer: string;
  description: string;
  docType: string;
  displayExpiresAt: string;
  watermarkText: string;
  recipientName: string;
  documentNumber: string;
  createdBy: string;
}

export interface DocumentTemplate {
  id: string;
  pluginId?: string;
  pluginName?: string;
  name: string;
  description: string;
  category: DocumentTemplateCategory;
  defaultMetadata: Partial<DocumentTemplateMetadata>;
  buildBodyHtml: (metadata: DocumentTemplateMetadata) => string;
}

export const DEFAULT_DOCUMENT_TEMPLATE_ID = "core.notice";

function escapeTemplateValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function templateText(value: string, fallback: string): string {
  return escapeTemplateValue((value || fallback).normalize("NFKC").trim() || fallback);
}

export const CORE_DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = [
  {
    id: "core.notice",
    name: "안내문/공지문",
    description: "수신자에게 보안 문서 열람 절차와 주의사항을 전달하는 기본 안내 템플릿입니다.",
    category: "notice",
    defaultMetadata: {
      title: "보안 문서 열람 안내문",
      description: "보안 문서 열람 절차 안내",
      docType: "안내문",
      watermarkText: "공지"
    },
    buildBodyHtml(metadata) {
      const title = templateText(metadata.title, "보안 문서 열람 안내문");
      const issuer = templateText(metadata.issuer, "문서 발행 기관");
      const recipient = templateText(metadata.recipientName, "수신자");

      return `<h1>${title}</h1>
<p>수신: ${recipient}</p>
<p>본 안내문은 암호화된 HTML 보안 문서를 안전하게 열람하고 관리하기 위한 기본 절차를 안내하기 위해 작성되었습니다.</p>
<h2>열람 준비</h2>
<ul>
  <li>문서 파일과 PIN은 서로 다른 경로로 전달받는 것을 권장합니다.</li>
  <li>문서 열람 전 파일 출처와 발행자를 확인해 주십시오.</li>
  <li>공용 PC 또는 신뢰할 수 없는 환경에서는 열람을 피하는 것이 좋습니다.</li>
</ul>
<h2>열람 절차</h2>
<ul>
  <li>발행자가 전달한 HTML 파일을 브라우저에서 엽니다.</li>
  <li>별도로 안내받은 6자리 이상 15자리 이내 PIN을 입력합니다.</li>
  <li>열람 후에는 브라우저 탭을 닫고 필요 시 다운로드 파일을 안전한 위치에 보관합니다.</li>
</ul>
<h2>보안 유의 사항</h2>
<ul>
  <li>PIN을 문서 파일명, 이메일 제목, 메신저 대화방 이름 등에 함께 남기지 마십시오.</li>
  <li>PIN이 외부에 노출되었다고 판단되면 발행자에게 재발행을 요청하십시오.</li>
  <li>문서 내용은 열람 권한이 있는 사람에게만 공유하십시오.</li>
</ul>
<p>[${issuer}]</p>`;
    }
  },
  {
    id: "core.contract",
    name: "계약/동의 문서",
    description: "갑/을 정보와 서명란이 필요한 계약서 또는 동의서 초안 템플릿입니다.",
    category: "contract",
    defaultMetadata: {
      title: "서비스 이용 및 협력 계약서",
      description: "계약 또는 동의 문서 초안",
      docType: "계약서",
      watermarkText: "계약서"
    },
    buildBodyHtml(metadata) {
      const title = templateText(metadata.title, "서비스 이용 및 협력 계약서");
      const firstParty = templateText(metadata.issuer, "갑");
      const secondParty = templateText(metadata.recipientName, "을");
      const contractDate = templateText(metadata.displayExpiresAt, "202X년 XX월 XX일");

      return `<h1>${title}</h1>
<p>본 계약은 <strong>${firstParty}</strong>(이하 갑)과 <strong>${secondParty}</strong>(이하 을) 간의 서비스 이용 및 협력 범위를 명확히 하기 위해 아래와 같이 체결한다.</p>
<h2>제1조 [목적]</h2>
<p>본 계약은 갑이 제공하는 서비스와 을의 이용 조건, 역할, 책임을 정하고 상호 신뢰에 기반한 업무 수행을 목적으로 한다.</p>
<h2>제2조 [효력 발생]</h2>
<p>본 계약은 계약 체결일로부터 효력이 발생하며, 별도의 종료 합의 또는 계약서에 정한 종료 사유가 발생할 때까지 유효하다.</p>
<h2>제3조 [을의 주요 의무]</h2>
<ul>
  <li>을은 계약 목적에 부합하도록 필요한 정보를 정확하게 제공한다.</li>
  <li>을은 서비스 이용 과정에서 관계 법령과 본 계약의 조건을 준수한다.</li>
  <li>을은 계정, PIN, 문서 등 접근 권한 정보를 안전하게 관리한다.</li>
  <li>을은 계약 이행에 필요한 협조 요청에 합리적인 기간 내 응답한다.</li>
</ul>
<h2>제4조 [갑의 주요 의무]</h2>
<ul>
  <li>갑은 계약 목적에 필요한 서비스를 안정적으로 제공하기 위해 노력한다.</li>
  <li>갑은 을의 정보를 계약 이행 범위 안에서만 사용한다.</li>
  <li>갑은 보안상 필요한 안내와 변경 사항을 을에게 고지한다.</li>
</ul>
<h2>제5조 [비밀 유지]</h2>
<p>갑과 을은 계약 과정에서 알게 된 상대방의 영업상, 기술상, 개인정보상 비밀을 제3자에게 공개하지 않는다.</p>
<h2>제6조 [계약 위반 시 조치]</h2>
<p>어느 일방이 본 계약을 위반한 경우 상대방은 상당한 기간을 정해 시정을 요구할 수 있으며, 시정되지 않을 경우 계약을 해지할 수 있다.</p>
<p>계약 체결일: ${contractDate}</p>
<p>${firstParty} (갑): ________________ (인)</p>
<p>${secondParty} (을): ________________ (인)</p>`;
    }
  },
  {
    id: "core.policy",
    name: "정책/규정 문서",
    description: "내부 정책, 보안 기준, 운영 규정을 공지할 때 쓰는 구조화된 템플릿입니다.",
    category: "policy",
    defaultMetadata: {
      title: "보안 운영 정책",
      description: "정책 또는 규정 문서 초안",
      docType: "정책/규정",
      watermarkText: "정책"
    },
    buildBodyHtml(metadata) {
      const title = templateText(metadata.title, "보안 운영 정책");
      const issuer = templateText(metadata.issuer, "정책 담당 부서");
      const documentNumber = templateText(metadata.documentNumber, "POLICY-2026-0001");
      const effectiveDate = templateText(metadata.displayExpiresAt, "시행일 별도 고지");

      return `<h1>${title}</h1>
<p><strong>문서번호:</strong> ${documentNumber}</p>
<p><strong>발행:</strong> ${issuer}</p>
<p><strong>시행 기준:</strong> ${effectiveDate}</p>
<h2>1. 목적</h2>
<p>본 정책은 조직의 보안 문서 발행, 전달, 열람 절차를 일관되게 관리하기 위한 기준을 정한다.</p>
<h2>2. 적용 범위</h2>
<ul>
  <li>보안 HTML 문서를 발행하거나 전달하는 모든 업무 절차에 적용한다.</li>
  <li>문서 수신자, 발행자, 검토자는 본 정책에서 정한 역할과 책임을 따른다.</li>
</ul>
<h2>3. 관리 기준</h2>
<ul>
  <li>문서 원문, PIN, 암호화 키는 승인된 흐름 밖에 저장하지 않는다.</li>
  <li>발행 이력과 패키지 해시는 문서 검증을 위해 보관한다.</li>
  <li>외부 공유가 필요한 경우 사전에 수신자와 전달 경로를 확인한다.</li>
</ul>
<h2>4. 예외 처리</h2>
<p>예외가 필요한 경우 ${issuer}의 검토와 승인을 받은 뒤 별도 기록으로 남긴다.</p>`;
    }
  },
  {
    id: "core.general",
    name: "일반 보안 문서",
    description: "정형화되지 않은 보안 본문을 빠르게 작성할 수 있는 빈 구조 템플릿입니다.",
    category: "general",
    defaultMetadata: {
      title: "보안문서",
      description: "자유 형식 보안 문서",
      docType: "기타",
      watermarkText: "SECURE"
    },
    buildBodyHtml(metadata) {
      const title = templateText(metadata.title, "보안문서");
      const issuer = templateText(metadata.issuer, "발행자");
      const recipient = templateText(metadata.recipientName, "수신자");

      return `<h1>${title}</h1>
<p><strong>발행:</strong> ${issuer}</p>
<p><strong>수신:</strong> ${recipient}</p>
<h2>본문</h2>
<p>이 문서는 자유 형식으로 작성되는 보안 문서입니다. 필요한 조항, 안내 사항, 서명란을 이곳에 정리합니다.</p>`;
    }
  },
  {
    id: "core.insurance-certificate",
    name: "보험증서",
    description: "보험증서 형식의 보안 문서 샘플입니다.",
    category: "general",
    defaultMetadata: {
      title: "디지털 안전 보장 보험증서",
      description: "보험증서 형식의 보안 문서 샘플",
      docType: "보험증서",
      watermarkText: "CONFIDENTIAL"
    },
    buildBodyHtml(metadata) {
      const title = templateText(metadata.title, "디지털 안전 보장 보험증서");
      const issuer = templateText(metadata.issuer, "보장 발행자");
      const recipient = templateText(metadata.recipientName, "피보험자");
      const documentNumber = templateText(metadata.documentNumber, "POL-2026-0001");
      const expiresAt = templateText(metadata.displayExpiresAt, "별도 안내일까지");

      return `<h1>${title}</h1>
<p><strong>증권번호:</strong> ${documentNumber}</p>
<p><strong>보험계약자:</strong> ${issuer}</p>
<p><strong>피보험자:</strong> ${recipient}</p>
<h2>제1조 [보장 목적]</h2>
<p>본 증서는 ${recipient}에게 전달되는 디지털 문서의 열람 권한과 보장 범위를 명확히 하기 위해 발행한다.</p>
<h2>제2조 [보장 내용]</h2>
<ul>
  <li>문서는 지정된 PIN으로만 열람할 수 있다.</li>
  <li>발행자는 문서 발행 이력과 암호화 프로필을 보관한다.</li>
  <li>만료 표시는 ${expiresAt} 기준으로 안내한다.</li>
</ul>
<h2>제3조 [유의 사항]</h2>
<p>PIN 분실 또는 외부 유출 시 즉시 ${issuer}에게 재발행을 요청해야 한다.</p>`;
    }
  },
  {
    id: "core.billing-notice",
    name: "고지서",
    description: "수신자와 발행자가 자동 반영되는 고지서 샘플입니다.",
    category: "notice",
    defaultMetadata: {
      title: "서비스 이용 고지서",
      description: "서비스 이용 고지서 샘플",
      docType: "고지서",
      watermarkText: "NOTICE"
    },
    buildBodyHtml(metadata) {
      const title = templateText(metadata.title, "서비스 이용 고지서");
      const issuer = templateText(metadata.issuer, "고지 발행자");
      const recipient = templateText(metadata.recipientName, "수신자");
      const documentNumber = templateText(metadata.documentNumber, "BILL-2026-0001");
      const expiresAt = templateText(metadata.displayExpiresAt, "지정 납부일까지");

      return `<h1>${title}</h1>
<p><strong>문서번호:</strong> ${documentNumber}</p>
<p><strong>수신:</strong> ${recipient}</p>
<p><strong>발행:</strong> ${issuer}</p>
<h2>고지 내용</h2>
<p>${recipient}님께 아래 서비스 이용 내역과 확인 요청 사항을 고지합니다.</p>
<ul>
  <li>확인 기한: ${expiresAt}</li>
  <li>문의처: ${issuer}</li>
  <li>본 문서는 암호화된 HTML 파일로 전달되며 지정 PIN으로만 열람할 수 있습니다.</li>
</ul>
<h2>안내 사항</h2>
<p>기한 내 확인이 어려운 경우 발행자에게 재안내 또는 재발행을 요청하시기 바랍니다.</p>`;
    }
  }
];

export const BASE_DOCUMENT_TEMPLATE_IDS = ["core.notice", "core.contract", "core.policy", "core.general"] as const;

export const BASE_DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = CORE_DOCUMENT_TEMPLATES.filter((template) =>
  (BASE_DOCUMENT_TEMPLATE_IDS as readonly string[]).includes(template.id)
);

export const TRUSTED_DOCUMENT_TEMPLATES: readonly DocumentTemplate[] = CORE_DOCUMENT_TEMPLATES;

export function getDocumentTemplateById(
  templateId: string,
  templates: readonly DocumentTemplate[] = CORE_DOCUMENT_TEMPLATES
): DocumentTemplate | undefined {
  return templates.find((template) => template.id === templateId);
}

export function resolveAvailableDocumentTemplates(
  pluginTemplates: readonly ResolvedPluginTemplateContribution[],
  baseTemplates: readonly DocumentTemplate[] = BASE_DOCUMENT_TEMPLATES,
  trustedTemplates: readonly DocumentTemplate[] = TRUSTED_DOCUMENT_TEMPLATES
): DocumentTemplate[] {
  const trustedTemplatesById = new Map(trustedTemplates.map((template) => [template.id, template]));
  const availableTemplates: DocumentTemplate[] = [];
  const availableIds = new Set<string>();

  function addTemplate(template: DocumentTemplate): void {
    if (availableIds.has(template.id)) {
      return;
    }
    availableTemplates.push(template);
    availableIds.add(template.id);
  }

  for (const template of baseTemplates) {
    addTemplate(template);
  }

  for (const pluginTemplate of pluginTemplates) {
    const trustedTemplate = trustedTemplatesById.get(pluginTemplate.id);
    if (!trustedTemplate) {
      continue;
    }

    addTemplate({
      ...trustedTemplate,
      pluginId: pluginTemplate.pluginId,
      pluginName: pluginTemplate.pluginName,
      name: pluginTemplate.label || trustedTemplate.name,
      description: pluginTemplate.description || trustedTemplate.description
    });
  }

  return availableTemplates;
}

export function applyDocumentTemplateDefaults(
  metadata: DocumentTemplateMetadata,
  template: DocumentTemplate
): DocumentTemplateMetadata {
  return {
    ...metadata,
    ...template.defaultMetadata
  };
}

export function buildDocumentTemplateBodyHtml(template: DocumentTemplate, metadata: DocumentTemplateMetadata): string {
  return template.buildBodyHtml(metadata);
}
