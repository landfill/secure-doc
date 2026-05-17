import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type {
  AuditPackageIntegrityReport,
  PublishHistoryRecord,
  SaveSmtpSettingsRequest,
  SendSmtpEmailResult,
  SmtpSettingsView
} from "../../shared/desktopApi";
import {
  AUDIT_INTEGRITY_HISTORY_ACTION_ID,
  AUDIT_INTEGRITY_PLUGIN_ID,
  EMPTY_PLUGIN_CONTRIBUTIONS,
  GMAIL_SMTP_HISTORY_SEND_ACTION_ID,
  GMAIL_SMTP_PLUGIN_ID,
  GMAIL_SMTP_SEND_ACTION_ID,
  GMAIL_SMTP_TEST_ACTION_ID,
  STRICT_PIN_POLICY_PLUGIN_ID,
  type PluginCategory,
  type PluginContributions,
  type PluginDescriptor,
  type PluginPermission
} from "../../shared/plugins";
import {
  CORE_DOCUMENT_TEMPLATES,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  applyDocumentTemplateDefaults,
  buildDocumentTemplateBodyHtml,
  getDocumentTemplateById,
  type DocumentTemplate,
  type DocumentTemplateCategory,
  type DocumentTemplateMetadata
} from "../../shared/documentTemplates";
import {
  COMPAT_PIN_KDF_ITERATIONS,
  DEFAULT_PIN_KDF_ITERATIONS,
  evaluatePinPolicy,
  GENERATED_PIN_LENGTH,
  generatePin,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH
} from "../../shared/pinPolicy";
import {
  PUBLISH_POLICY_METADATA_FIELD_LABELS,
  evaluatePublishPolicy,
  getEffectivePublishPolicy
} from "../../shared/publishPolicy";
import { issueSecureDocument, type SecureDocPlainContent } from "../../shared/securePackage";
import { buildSecureHtmlDocument } from "../../shared/viewerHtml";
import { isAllowedLinkHref, removeUnsupportedEditorCharacters, sanitizeHtml, stripHtml } from "./sanitizeHtml";

type EditorMode = "visual" | "html";
type HeadingLevel = 1 | 2 | 3;
type BlockStyle = "paragraph" | `heading-${HeadingLevel}`;
type TextAlign = "left" | "center" | "right" | "justify";
type NavTarget = "document" | "security" | "history" | "plugins";
const documentTypes = ["안내문", "계약서", "정책/규정", "기타", "보험증서", "고지서"] as const;
type DocumentType = (typeof documentTypes)[number];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    secureDocTextAlign: {
      setTextAlign: (alignment: TextAlign) => ReturnType;
      unsetTextAlign: () => ReturnType;
    };
  }
}

type MetadataState = {
  title: string;
  issuer: string;
  description: string;
  docType: DocumentType;
  displayExpiresAt: string;
  watermarkText: string;
  recipientName: string;
  documentNumber: string;
  createdBy: string;
};

type SmtpSettingsForm = {
  host: string;
  port: string;
  senderEmail: string;
  appPassword: string;
};

type PendingEmailPackage = {
  source: "publish";
  documentId: string;
  attachmentFileName: string;
  filePath: string;
} | {
  source: "history";
  documentId: string;
  attachmentFileName: string;
  filePath: string;
};

type EmailSendForm = {
  recipientEmail: string;
  subject: string;
  attachmentFileName: string;
};

const textAlignments: TextAlign[] = ["left", "center", "right", "justify"];

const defaultSmtpSettingsForm: SmtpSettingsForm = {
  host: "smtp.gmail.com",
  port: "587",
  senderEmail: "",
  appPassword: ""
};

const defaultEmailSendForm: EmailSendForm = {
  recipientEmail: "",
  subject: "",
  attachmentFileName: ""
};

const navigationItems: { id: NavTarget; label: string }[] = [
  { id: "document", label: "문서 발행" },
  { id: "history", label: "발행 이력" },
  { id: "security", label: "보안 정책" },
  { id: "plugins", label: "플러그인" }
];

const pluginPermissionLabels: Record<PluginPermission, string> = {
  "network:smtp": "SMTP 네트워크",
  "secret:safeStorage": "보안 저장소",
  "package:read": "발행 파일 읽기",
  "history:read": "이력 읽기",
  "history:write": "이력 쓰기",
  "ui:settings": "설정 화면",
  "ui:publish-action": "발행 액션"
};

const pluginCategoryLabels: Record<PluginCategory, string> = {
  delivery: "전달",
  template: "템플릿",
  audit: "감사",
  branding: "브랜딩",
  policy: "정책"
};

const templateCategoryLabels: Record<DocumentTemplateCategory, string> = {
  notice: "안내",
  contract: "계약",
  policy: "정책",
  general: "일반"
};

function isTextAlign(value: unknown): value is TextAlign {
  return typeof value === "string" && textAlignments.includes(value as TextAlign);
}

function pluginCategoryLabel(category: PluginCategory): string {
  return pluginCategoryLabels[category];
}

function pluginPermissionLabel(permission: PluginPermission): string {
  return pluginPermissionLabels[permission];
}

function templateOptionLabel(template: DocumentTemplate): string {
  return `${templateCategoryLabels[template.category]} · ${template.name}`;
}

function pluginDisplayName(plugin: PluginDescriptor): string {
  if (plugin.id === GMAIL_SMTP_PLUGIN_ID) {
    return "Gmail SMTP 발송";
  }
  if (plugin.id === AUDIT_INTEGRITY_PLUGIN_ID) {
    return "패키지 무결성 감사";
  }
  if (plugin.id === STRICT_PIN_POLICY_PLUGIN_ID) {
    return "엄격 발행 정책";
  }
  return plugin.name;
}

function pluginDisplayDescription(plugin: PluginDescriptor): string {
  if (plugin.id === GMAIL_SMTP_PLUGIN_ID) {
    return "보안 HTML 파일을 Gmail SMTP 메일에 첨부해 외부 수신자에게 보냅니다.";
  }
  if (plugin.id === AUDIT_INTEGRITY_PLUGIN_ID) {
    return "저장된 보안 HTML 파일이 발행 당시 기록된 SHA-256 해시와 일치하는지 검사합니다.";
  }
  if (plugin.id === STRICT_PIN_POLICY_PLUGIN_ID) {
    return "문서 발행 전 더 긴 PIN, 강한 KDF, 필수 메타데이터 입력을 요구합니다.";
  }
  return plugin.description;
}

function pluginFeatureDescriptions(plugin: PluginDescriptor): string[] {
  if (plugin.id === GMAIL_SMTP_PLUGIN_ID) {
    return [
      "플러그인 화면에 Gmail SMTP 계정과 앱 비밀번호 설정 패널이 표시됩니다.",
      "문서 발행 직후 보안 HTML 파일을 이메일 첨부로 보낼 수 있습니다.",
      "발행 이력에 저장된 보안 HTML 파일을 다시 이메일로 보낼 수 있습니다."
    ];
  }
  if (plugin.id === AUDIT_INTEGRITY_PLUGIN_ID) {
    return [
      "발행 이력에서 저장된 HTML 파일의 SHA-256 해시를 다시 계산합니다.",
      "발행 당시 기록된 해시와 비교해 정상, 파일 없음, 변조 의심 상태를 보여줍니다.",
      "PIN, 평문 본문, 암호화 키를 리포트에 포함하지 않습니다."
    ];
  }
  if (plugin.id === STRICT_PIN_POLICY_PLUGIN_ID) {
    return [
      "발행 전 PIN 10자리 이상과 PBKDF2 1,000,000회 이상을 요구합니다.",
      "수신자, 문서번호, 만료일, 워터마크 문구 누락을 발행 전에 차단합니다.",
      "PIN, PIN hash, 평문 본문, 암호화 키를 저장하지 않는 선언형 정책입니다."
    ];
  }

  const descriptions: string[] = [];
  if (plugin.contributes.settingsPanel) {
    descriptions.push("설정 화면에서 이 플러그인의 계정, 비밀번호, 옵션을 관리합니다.");
  }
  for (const action of plugin.contributes.publishActions ?? []) {
    descriptions.push(`문서 발행 직후: ${action.description}`);
  }
  for (const action of plugin.contributes.historyActions ?? []) {
    descriptions.push(`발행 이력에서: ${action.description}`);
  }
  for (const template of plugin.contributes.templates ?? []) {
    descriptions.push(`문서 작성에서: ${template.description}`);
  }
  for (const policyProfile of plugin.contributes.policyProfiles ?? []) {
    descriptions.push(`발행 정책: ${policyProfile.description}`);
  }
  return descriptions;
}

function pluginContributionLabels(plugin: PluginDescriptor): string[] {
  const labels: string[] = [];
  if (plugin.contributes.settingsPanel) {
    labels.push("설정 패널");
  }
  if (plugin.contributes.publishActions?.length) {
    labels.push("발행 액션");
  }
  if (plugin.contributes.templates?.length) {
    labels.push("템플릿");
  }
  if (plugin.contributes.historyActions?.length) {
    labels.push("이력 액션");
  }
  if (plugin.contributes.policyProfiles?.length) {
    labels.push("정책 preset");
  }
  return labels;
}

function smtpSettingsToForm(settings: SmtpSettingsView): SmtpSettingsForm {
  return {
    host: settings.host,
    port: String(settings.port),
    senderEmail: settings.senderEmail,
    appPassword: ""
  };
}

function hasActiveSmtpSendAction(contributions: PluginContributions): boolean {
  return contributions.publishActions.some(
    (action) => action.pluginId === GMAIL_SMTP_PLUGIN_ID && action.id === GMAIL_SMTP_SEND_ACTION_ID
  );
}

function hasActiveSmtpHistorySendAction(contributions: PluginContributions): boolean {
  return contributions.historyActions.some(
    (action) => action.pluginId === GMAIL_SMTP_PLUGIN_ID && action.id === GMAIL_SMTP_HISTORY_SEND_ACTION_ID
  );
}

function hasActiveAuditIntegrityHistoryAction(contributions: PluginContributions): boolean {
  return contributions.historyActions.some(
    (action) => action.pluginId === AUDIT_INTEGRITY_PLUGIN_ID && action.id === AUDIT_INTEGRITY_HISTORY_ACTION_ID
  );
}

function isSmtpPluginEnabled(plugins: readonly PluginDescriptor[]): boolean {
  return plugins.some((plugin) => plugin.id === GMAIL_SMTP_PLUGIN_ID && plugin.enabled);
}

function fileNameFromPath(filePath: string): string {
  const name = filePath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return name.endsWith(".html") ? name : "secure-document.html";
}

function normalizeEmailAddressInput(value: string, fieldLabel: string): string {
  const email = value.normalize("NFKC").trim();
  if (!email || email.length > 254 || /\s/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    throw new Error(`${fieldLabel}을 올바른 이메일 주소로 입력하세요.`);
  }
  return email;
}

const SecureDocTextAlign = Extension.create({
  name: "secureDocTextAlign",

  addGlobalAttributes() {
    return [
      {
        types: ["heading", "paragraph"],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element) => {
              const value = element.getAttribute("data-align");
              return isTextAlign(value) && value !== "left" ? value : null;
            },
            renderHTML: (attributes) => {
              const value = attributes.textAlign;
              return isTextAlign(value) && value !== "left" ? { "data-align": value } : {};
            }
          }
        }
      }
    ];
  },

  addCommands() {
    return {
      setTextAlign:
        (alignment: TextAlign) =>
        ({ commands }) => {
          if (!isTextAlign(alignment)) {
            return false;
          }
          if (alignment === "left") {
            return commands.unsetTextAlign();
          }

          const results = ["paragraph", "heading"].map((type) => commands.updateAttributes(type, { textAlign: alignment }));
          return results.some(Boolean);
        },
      unsetTextAlign:
        () =>
        ({ commands }) => {
          const results = ["paragraph", "heading"].map((type) => commands.resetAttributes(type, "textAlign"));
          return results.some(Boolean);
        }
    };
  }
});

type ToolbarButtonProps = {
  label: string;
  title: string;
  active?: boolean;
  className?: string;
  disabled?: boolean;
  format?: string;
  onClick: () => void;
};

function ToolbarButton({
  label,
  title,
  active = false,
  className = "",
  disabled = false,
  format,
  onClick
}: ToolbarButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={["toolbar-button", active ? "active" : "", className].filter(Boolean).join(" ")}
      data-format={format}
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {format?.startsWith("align-") ? (
        <span className="toolbar-align-icon" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
      ) : (
        <span className="toolbar-icon">{label}</span>
      )}
    </button>
  );
}

function isDocumentType(value: string | undefined): value is DocumentType {
  return Boolean(value && (documentTypes as readonly string[]).includes(value));
}

function coerceMetadataState(metadata: DocumentTemplateMetadata, fallbackDocType: DocumentType = "안내문"): MetadataState {
  return {
    ...metadata,
    docType: isDocumentType(metadata.docType) ? metadata.docType : fallbackDocType
  };
}

const baseMetadata: MetadataState = {
  title: "",
  issuer: "",
  description: "",
  docType: "안내문",
  displayExpiresAt: "",
  watermarkText: "",
  recipientName: "",
  documentNumber: "",
  createdBy: "admin"
};

const defaultDocumentTemplate = getDocumentTemplateById(DEFAULT_DOCUMENT_TEMPLATE_ID) ?? CORE_DOCUMENT_TEMPLATES[0];
const defaultMetadata = coerceMetadataState(applyDocumentTemplateDefaults(baseMetadata, defaultDocumentTemplate));
const initialEditorHtml = buildDocumentTemplateBodyHtml(defaultDocumentTemplate, defaultMetadata);
const presetBodyMetadataKeys = new Set<keyof MetadataState>([
  "title",
  "issuer",
  "displayExpiresAt",
  "recipientName",
  "documentNumber"
]);

function normalizePinInput(value: string): string {
  return [...value].slice(0, PIN_MAX_LENGTH).join("");
}

function safeFileNamePart(value: string): string {
  return value.normalize("NFKC").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "secure-document";
}

function compactPrivateMeta(metadata: MetadataState): SecureDocPlainContent["privateMeta"] {
  return {
    description: metadata.description || undefined,
    docType: metadata.docType || undefined,
    watermarkText: metadata.watermarkText || undefined,
    recipientName: metadata.recipientName || undefined,
    documentNumber: metadata.documentNumber || undefined
  };
}

function normalizeLinkHref(value: string): string | null {
  const trimmed = removeUnsupportedEditorCharacters(value).trim();
  if (!trimmed) {
    return "";
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const href = hasScheme ? trimmed : `https://${trimmed}`;
  return isAllowedLinkHref(href) ? href : null;
}

export function App(): ReactElement {
  const [metadata, setMetadata] = useState<MetadataState>(defaultMetadata);
  const [editorHtml, setEditorHtml] = useState(initialEditorHtml);
  const [editorMode, setEditorMode] = useState<EditorMode>("visual");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [iterations, setIterations] = useState(DEFAULT_PIN_KDF_ITERATIONS);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<PublishHistoryRecord[]>([]);
  const [plugins, setPlugins] = useState<PluginDescriptor[]>([]);
  const [pluginContributions, setPluginContributions] = useState<PluginContributions>(EMPTY_PLUGIN_CONTRIBUTIONS);
  const [pluginBusyId, setPluginBusyId] = useState<string | null>(null);
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettingsView | null>(null);
  const [smtpSettingsForm, setSmtpSettingsForm] = useState<SmtpSettingsForm>(defaultSmtpSettingsForm);
  const [smtpBusy, setSmtpBusy] = useState(false);
  const [smtpStatus, setSmtpStatus] = useState("");
  const [smtpError, setSmtpError] = useState("");
  const [syncPresetWithMetadata, setSyncPresetWithMetadata] = useState(true);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [pendingEmailPackage, setPendingEmailPackage] = useState<PendingEmailPackage | null>(null);
  const [emailSendForm, setEmailSendForm] = useState<EmailSendForm>(defaultEmailSendForm);
  const [emailBusy, setEmailBusy] = useState(false);
  const [auditBusyDocumentId, setAuditBusyDocumentId] = useState<string | null>(null);
  const [auditReport, setAuditReport] = useState<AuditPackageIntegrityReport | null>(null);
  const [activeNavTarget, setActiveNavTarget] = useState<NavTarget>("document");
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_DOCUMENT_TEMPLATE_ID);
  const [activeTemplateId, setActiveTemplateId] = useState(DEFAULT_DOCUMENT_TEMPLATE_ID);
  const screenRootRef = useRef<HTMLDivElement | null>(null);
  const didMountScreenRef = useRef(false);
  const programmaticEditorUpdateRef = useRef(false);

  const activePolicyProfiles = pluginContributions.policyProfiles;
  const effectivePublishPolicy = useMemo(() => getEffectivePublishPolicy(activePolicyProfiles), [activePolicyProfiles]);
  const publishPolicyRequirementItems = useMemo(() => {
    const items = [
      `PIN ${effectivePublishPolicy.minimumPinLength}-${PIN_MAX_LENGTH}자리`,
      `PBKDF2 ${effectivePublishPolicy.minimumKdfIterations.toLocaleString()}회 이상`
    ];
    if (effectivePublishPolicy.requiredMetadata.length > 0) {
      items.push(
        `필수 정보: ${effectivePublishPolicy.requiredMetadata.map((field) => PUBLISH_POLICY_METADATA_FIELD_LABELS[field]).join(", ")}`
      );
    }
    if (effectivePublishPolicy.requireWatermark) {
      items.push("워터마크 문구 필수");
    }
    return items;
  }, [effectivePublishPolicy]);
  const selectedTemplate = useMemo(
    () => getDocumentTemplateById(selectedTemplateId) ?? defaultDocumentTemplate,
    [selectedTemplateId]
  );
  const activeTemplate = useMemo(
    () => getDocumentTemplateById(activeTemplateId) ?? defaultDocumentTemplate,
    [activeTemplateId]
  );
  const pinResult = useMemo(
    () => evaluatePinPolicy(pin, { minLength: effectivePublishPolicy.minimumPinLength }),
    [effectivePublishPolicy.minimumPinLength, pin]
  );
  const sanitizedPreview = useMemo(() => sanitizeHtml(editorHtml), [editorHtml]);
  const contentText = useMemo(() => stripHtml(sanitizedPreview), [sanitizedPreview]);
  const publishPolicyResult = useMemo(
    () =>
      evaluatePublishPolicy({
        metadata,
        pin,
        pinConfirm,
        iterations,
        contentText,
        policyProfiles: activePolicyProfiles
      }),
    [activePolicyProfiles, contentText, iterations, metadata, pin, pinConfirm]
  );
  const smtpSendActionEnabled = hasActiveSmtpSendAction(pluginContributions);
  const smtpPluginEnabled = isSmtpPluginEnabled(plugins);
  const smtpHistorySendActionEnabled = hasActiveSmtpHistorySendAction(pluginContributions);
  const auditHistoryActionEnabled = hasActiveAuditIntegrityHistoryAction(pluginContributions);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        },
        link: {
          autolink: false,
          linkOnPaste: false,
          openOnClick: false,
          defaultProtocol: "https",
          HTMLAttributes: {
            target: null,
            rel: null,
            class: null
          },
          isAllowedUri: (url) => isAllowedLinkHref(url)
        }
      }),
      SecureDocTextAlign
    ],
    content: initialEditorHtml,
    immediatelyRender: false,
    onUpdate({ editor: currentEditor }) {
      setEditorHtml(currentEditor.getHTML());
      if (!programmaticEditorUpdateRef.current) {
        setSyncPresetWithMetadata(false);
      }
    }
  });

  async function refreshPlugins(): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi) {
      setPlugins([]);
      setPluginContributions(EMPTY_PLUGIN_CONTRIBUTIONS);
      setSmtpSettings(null);
      setSmtpSettingsForm(defaultSmtpSettingsForm);
      return;
    }

    const [nextPlugins, nextContributions, nextSmtpSettings] = await Promise.all([
      pluginApi.list(),
      pluginApi.getContributions(),
      pluginApi.getSettings(GMAIL_SMTP_PLUGIN_ID)
    ]);
    setPlugins(nextPlugins);
    setPluginContributions(nextContributions);
    setSmtpSettings(nextSmtpSettings as SmtpSettingsView);
    setSmtpSettingsForm(smtpSettingsToForm(nextSmtpSettings as SmtpSettingsView));
  }

  async function handlePluginToggle(plugin: PluginDescriptor, enabled: boolean): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi) {
      setError("플러그인 브리지를 사용할 수 없습니다.");
      return;
    }

    setPluginBusyId(plugin.id);
    setError("");
    try {
      const nextPlugins = await pluginApi.setEnabled(plugin.id, enabled);
      const nextContributions = await pluginApi.getContributions();
      setPlugins(nextPlugins);
      setPluginContributions(nextContributions);
      if (plugin.id === GMAIL_SMTP_PLUGIN_ID && !enabled) {
        setEmailDialogOpen(false);
        setPendingEmailPackage(null);
        setSmtpStatus("");
        setSmtpError("");
      }
      if (plugin.id === AUDIT_INTEGRITY_PLUGIN_ID && !enabled) {
        setAuditReport(null);
        setAuditBusyDocumentId(null);
      }
      setStatus(`${pluginDisplayName(plugin)} 플러그인을 ${enabled ? "활성화" : "비활성화"}했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "플러그인 상태를 변경하지 못했습니다.");
    } finally {
      setPluginBusyId(null);
    }
  }

  useEffect(() => {
    window.secureDoc?.getHistory().then(setHistory).catch(() => setHistory([]));
    refreshPlugins().catch(() => {
      setPlugins([]);
      setPluginContributions(EMPTY_PLUGIN_CONTRIBUTIONS);
      setSmtpSettings(null);
      setSmtpSettingsForm(defaultSmtpSettingsForm);
    });
  }, []);

  useEffect(() => {
    editor?.commands.setContent(editorHtml, { emitUpdate: false });
  }, [editor]);

  useEffect(() => {
    if (!didMountScreenRef.current) {
      didMountScreenRef.current = true;
      return;
    }

    screenRootRef.current?.focus({ preventScroll: true });
  }, [activeNavTarget]);

  useEffect(() => {
    if (!publishDialogOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !busy) {
        setPublishDialogOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, publishDialogOpen]);

  useEffect(() => {
    if (!emailDialogOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape" && !emailBusy) {
        setEmailDialogOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [emailBusy, emailDialogOpen]);

  function replaceEditorHtml(nextHtml: string): void {
    const sanitizedHtml = sanitizeHtml(nextHtml);
    programmaticEditorUpdateRef.current = true;
    setEditorHtml(sanitizedHtml);
    editor?.commands.setContent(sanitizedHtml, { emitUpdate: false });
    queueMicrotask(() => {
      programmaticEditorUpdateRef.current = false;
    });
  }

  function switchScreen(item: (typeof navigationItems)[number]): void {
    setActiveNavTarget(item.id);
  }

  function buildTemplateHtml(template: DocumentTemplate, nextMetadata: MetadataState): string {
    return buildDocumentTemplateBodyHtml(template, nextMetadata);
  }

  function currentEditorHtmlSnapshot(): string {
    return sanitizeHtml(editorMode === "visual" ? editor?.getHTML() ?? editorHtml : editorHtml);
  }

  function shouldConfirmTemplateOverwrite(nextHtml: string): boolean {
    const currentHtml = currentEditorHtmlSnapshot();
    return stripHtml(currentHtml).length > 0 && currentHtml !== sanitizeHtml(nextHtml);
  }

  function applyTemplate(template: DocumentTemplate, confirmOverwrite = true): void {
    const nextMetadata = coerceMetadataState(applyDocumentTemplateDefaults(metadata, template), metadata.docType);
    const nextHtml = buildTemplateHtml(template, nextMetadata);

    if (
      confirmOverwrite &&
      shouldConfirmTemplateOverwrite(nextHtml) &&
      !window.confirm("현재 본문을 선택한 템플릿으로 덮어씁니다. 계속할까요?")
    ) {
      return;
    }

    setMetadata(nextMetadata);
    setSelectedTemplateId(template.id);
    setActiveTemplateId(template.id);
    setSyncPresetWithMetadata(true);
    replaceEditorHtml(nextHtml);
    setStatus(`${template.name} 템플릿을 본문에 적용했습니다.`);
    setError("");
  }

  function handleApplySelectedTemplate(): void {
    applyTemplate(selectedTemplate);
  }

  function updateMetadata<K extends keyof MetadataState>(key: K, value: MetadataState[K]): void {
    const nextMetadata = {
      ...metadata,
      [key]: value
    } as MetadataState;

    setMetadata(nextMetadata);
    if (syncPresetWithMetadata && presetBodyMetadataKeys.has(key)) {
      replaceEditorHtml(buildTemplateHtml(activeTemplate, nextMetadata));
    }
  }

  function handleDocumentTypeChange(docType: DocumentType): void {
    const matchingTemplate = CORE_DOCUMENT_TEMPLATES.find((template) => template.defaultMetadata.docType === docType);
    if (matchingTemplate) {
      applyTemplate(matchingTemplate);
      return;
    }

    updateMetadata("docType", docType);
  }

  function switchEditorMode(nextMode: EditorMode): void {
    if (nextMode === "html") {
      replaceEditorHtml(sanitizeHtml(editor?.getHTML() ?? editorHtml));
      setEditorMode("html");
      return;
    }

    const sanitizedHtml = sanitizeHtml(editorHtml);
    replaceEditorHtml(sanitizedHtml);
    setEditorMode("visual");
  }

  function runEditorCommand(action: () => boolean): void {
    if (editorMode !== "visual") {
      switchEditorMode("visual");
      return;
    }
    action();
  }

  function canRunEditorCommand(action: () => boolean): boolean {
    return Boolean(editor && action());
  }

  function isEditorActive(name: string, attributes?: Record<string, unknown>): boolean {
    return Boolean(editor?.isActive(name, attributes));
  }

  function currentBlockStyle(): BlockStyle {
    if (isEditorActive("heading", { level: 1 })) {
      return "heading-1";
    }
    if (isEditorActive("heading", { level: 2 })) {
      return "heading-2";
    }
    if (isEditorActive("heading", { level: 3 })) {
      return "heading-3";
    }
    return "paragraph";
  }

  function currentTextAlign(): TextAlign {
    const paragraphAlign = editor?.getAttributes("paragraph").textAlign;
    const headingAlign = editor?.getAttributes("heading").textAlign;
    if (isTextAlign(paragraphAlign)) {
      return paragraphAlign;
    }
    if (isTextAlign(headingAlign)) {
      return headingAlign;
    }
    return "left";
  }

  function canSetTextAlign(): boolean {
    return Boolean(editor && (editor.isActive("paragraph") || editor.isActive("heading")));
  }

  function setBlockStyle(value: BlockStyle): void {
    if (value === "paragraph") {
      runEditorCommand(() => editor?.chain().focus().setParagraph().run() ?? false);
      return;
    }

    const level = Number(value.replace("heading-", "")) as HeadingLevel;
    runEditorCommand(() => editor?.chain().focus().setHeading({ level }).run() ?? false);
  }

  function setTextAlign(alignment: TextAlign): void {
    runEditorCommand(() => editor?.chain().focus().setTextAlign(alignment).run() ?? false);
  }

  function handleSetLink(): void {
    if (!editor) {
      return;
    }

    const currentHref = editor.getAttributes("link").href;
    const nextHref = window.prompt("링크 URL", typeof currentHref === "string" ? currentHref : "");
    if (nextHref === null) {
      return;
    }

    const normalizedHref = normalizeLinkHref(nextHref);
    if (normalizedHref === null) {
      setError("링크는 https, mailto, tel 형식만 사용할 수 있습니다.");
      return;
    }
    if (!normalizedHref) {
      runEditorCommand(() => editor.chain().focus().extendMarkRange("link").unsetLink().run());
      return;
    }

    setError("");
    runEditorCommand(() => editor.chain().focus().extendMarkRange("link").setLink({ href: normalizedHref }).run());
  }

  function handleGeneratePin(): void {
    const nextPinLength = Math.max(GENERATED_PIN_LENGTH, effectivePublishPolicy.minimumPinLength);
    const nextPin = generatePin(undefined, nextPinLength);
    setPin(nextPin);
    setPinConfirm(nextPin);
    setStatus("새 PIN이 생성되었습니다. 표시 버튼으로 확인하거나 복사할 수 있습니다.");
    setError("");
  }

  function openPublishDialog(): void {
    setPublishDialogOpen(true);
    setError("");
  }

  function closePublishDialog(): void {
    if (!busy) {
      setPublishDialogOpen(false);
    }
  }

  function updateSmtpSettingsForm<K extends keyof SmtpSettingsForm>(key: K, value: SmtpSettingsForm[K]): void {
    setSmtpSettingsForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  async function saveSmtpSettingsFromForm(): Promise<SmtpSettingsView> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi) {
      throw new Error("플러그인 브리지를 사용할 수 없습니다.");
    }

    const request: SaveSmtpSettingsRequest = {
      host: smtpSettingsForm.host,
      port: Number(smtpSettingsForm.port),
      senderEmail: smtpSettingsForm.senderEmail
    };
    if (smtpSettingsForm.appPassword.trim()) {
      request.appPassword = smtpSettingsForm.appPassword;
    }

    const nextSettings = (await pluginApi.saveSettings(GMAIL_SMTP_PLUGIN_ID, request)) as SmtpSettingsView;
    setSmtpSettings(nextSettings);
    setSmtpSettingsForm(smtpSettingsToForm(nextSettings));
    return nextSettings;
  }

  async function handleSaveSmtpSettings(): Promise<void> {
    setSmtpBusy(true);
    setSmtpStatus("");
    setSmtpError("");
    try {
      await saveSmtpSettingsFromForm();
      setSmtpStatus("SMTP 설정을 저장했습니다.");
    } catch (caught) {
      setSmtpError(caught instanceof Error ? caught.message : "SMTP 설정을 저장하지 못했습니다.");
    } finally {
      setSmtpBusy(false);
    }
  }

  async function handleClearSmtpSettings(): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi) {
      setSmtpError("플러그인 브리지를 사용할 수 없습니다.");
      return;
    }

    setSmtpBusy(true);
    setSmtpStatus("");
    setSmtpError("");
    try {
      const nextSettings = (await pluginApi.clearSettings(GMAIL_SMTP_PLUGIN_ID)) as SmtpSettingsView;
      setSmtpSettings(nextSettings);
      setSmtpSettingsForm(smtpSettingsToForm(nextSettings));
      setSmtpStatus("SMTP 설정을 삭제했습니다.");
    } catch (caught) {
      setSmtpError(caught instanceof Error ? caught.message : "SMTP 설정을 삭제하지 못했습니다.");
    } finally {
      setSmtpBusy(false);
    }
  }

  async function handleTestSmtpSettings(): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi) {
      setSmtpError("플러그인 브리지를 사용할 수 없습니다.");
      return;
    }

    setSmtpBusy(true);
    setSmtpStatus("");
    setSmtpError("");
    try {
      await saveSmtpSettingsFromForm();
      await pluginApi.runAction(GMAIL_SMTP_PLUGIN_ID, GMAIL_SMTP_TEST_ACTION_ID);
      setSmtpStatus("SMTP 연결 테스트에 성공했습니다.");
    } catch (caught) {
      setSmtpError(caught instanceof Error ? caught.message : "SMTP 연결 테스트에 실패했습니다.");
    } finally {
      setSmtpBusy(false);
    }
  }

  function updateEmailSendForm<K extends keyof EmailSendForm>(key: K, value: EmailSendForm[K]): void {
    setEmailSendForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function closeEmailDialog(): void {
    if (!emailBusy) {
      setEmailDialogOpen(false);
    }
  }

  function openHistoryEmailDialog(item: PublishHistoryRecord): void {
    if (!smtpHistorySendActionEnabled) {
      setError("SMTP 플러그인을 활성화해야 발행 이력에서 이메일을 보낼 수 있습니다.");
      return;
    }

    const attachmentFileName = fileNameFromPath(item.outputPath);
    setPendingEmailPackage({
      source: "history",
      documentId: item.documentId,
      attachmentFileName,
      filePath: item.outputPath
    });
    setEmailSendForm({
      recipientEmail: "",
      subject: `Secure document: ${item.title}`,
      attachmentFileName
    });
    setStatus("");
    setError("");
    setEmailDialogOpen(true);
  }

  function auditStatusLabel(report: AuditPackageIntegrityReport): string {
    if (report.status === "verified") {
      return "정상";
    }
    if (report.status === "missing") {
      return "파일 없음";
    }
    return "변조 의심";
  }

  async function handleAuditIntegrityReport(item: PublishHistoryRecord): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi || !auditHistoryActionEnabled) {
      setError("감사 플러그인을 사용할 수 없습니다.");
      return;
    }

    setAuditBusyDocumentId(item.documentId);
    setStatus("감사 리포트를 생성 중입니다.");
    setError("");
    try {
      const report = (await pluginApi.runAction(AUDIT_INTEGRITY_PLUGIN_ID, AUDIT_INTEGRITY_HISTORY_ACTION_ID, {
        documentId: item.documentId,
        outputPath: item.outputPath
      })) as AuditPackageIntegrityReport;
      setAuditReport(report);
      setStatus(report.message);
    } catch (caught) {
      setAuditReport(null);
      setError(caught instanceof Error ? caught.message : "감사 리포트를 생성하지 못했습니다.");
      setStatus("");
    } finally {
      setAuditBusyDocumentId(null);
    }
  }

  async function handleSendEmail(): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi || !pendingEmailPackage) {
      setError("이메일 발송을 사용할 수 없습니다.");
      return;
    }

    let recipientEmail: string;
    let subject: string;
    let attachmentFileName: string;
    try {
      recipientEmail = normalizeEmailAddressInput(emailSendForm.recipientEmail, "수신자 이메일");
      subject = emailSendForm.subject.normalize("NFKC").trim();
      attachmentFileName = emailSendForm.attachmentFileName.normalize("NFKC").trim();
      if (!subject) {
        throw new Error("이메일 제목을 입력하세요.");
      }
      if (!attachmentFileName.endsWith(".html")) {
        throw new Error("첨부 파일명은 .html로 끝나야 합니다.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "이메일 발송 정보를 확인하세요.");
      setStatus("");
      return;
    }

    setEmailBusy(true);
    setError("");
    setStatus("이메일 발송 중입니다.");
    try {
      const result = (await pluginApi.runAction(
        GMAIL_SMTP_PLUGIN_ID,
        pendingEmailPackage.source === "history" ? GMAIL_SMTP_HISTORY_SEND_ACTION_ID : GMAIL_SMTP_SEND_ACTION_ID,
        pendingEmailPackage.source === "history"
          ? {
              documentId: pendingEmailPackage.documentId,
              outputPath: pendingEmailPackage.filePath,
              recipientEmail,
              subject,
              attachmentFileName
            }
          : {
              documentId: pendingEmailPackage.documentId,
              outputPath: pendingEmailPackage.filePath,
              recipientEmail,
              subject,
              attachmentFileName
            }
      )) as SendSmtpEmailResult;
      const messageSuffix = result.messageId ? ` (${result.messageId})` : "";
      setStatus(`이메일 발송 완료${messageSuffix}`);
      setEmailDialogOpen(false);
      setPendingEmailPackage(null);
      setEmailSendForm(defaultEmailSendForm);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "이메일 발송 중 오류가 발생했습니다.");
      setStatus("");
    } finally {
      setEmailBusy(false);
    }
  }

  async function handleCopyPin(): Promise<void> {
    if (!pinResult.valid) {
      setError(pinResult.message);
      return;
    }
    await navigator.clipboard.writeText(pinResult.normalizedPin);
    setStatus("PIN을 클립보드에 복사했습니다.");
    setError("");
  }

  async function handlePublish(): Promise<void> {
    setBusy(true);
    setError("");
    setStatus("발행 전 검증을 수행하는 중입니다.");

    try {
      if (!window.secureDoc) {
        throw new Error("데스크톱 브리지를 사용할 수 없습니다.");
      }
      const publishMetadata = metadata;

      if (!publishPolicyResult.valid) {
        throw new Error(publishPolicyResult.messages[0]);
      }

      const issuedAt = new Date().toISOString();
      const content: SecureDocPlainContent = {
        type: "secure-doc-content",
        version: "1.0",
        format: "html",
        html: sanitizedPreview,
        assets: [],
        privateMeta: compactPrivateMeta(publishMetadata)
      };

      const securePackage = await issueSecureDocument({
        content,
        pin: pinResult.normalizedPin,
        metadata: {
          title: publishMetadata.title.trim(),
          issuer: publishMetadata.issuer.trim(),
          issuedAt,
          displayExpiresAt: publishMetadata.displayExpiresAt || undefined
        },
        iterations
      });

      const html = buildSecureHtmlDocument(securePackage);
      const suggestedFileName = `${securePackage.doc.id}-${safeFileNamePart(publishMetadata.title)}.html`;
      const saveResult = await window.secureDoc.savePackage({
        suggestedFileName,
        html,
        history: {
          documentId: securePackage.doc.id,
          title: securePackage.doc.title,
          issuer: securePackage.doc.issuer,
          issuedAt: securePackage.doc.issuedAt,
          displayExpiresAt: securePackage.doc.displayExpiresAt,
          kdf: "PBKDF2-HMAC-SHA-256",
          iterations,
          contentAlg: "AES-256-GCM",
          createdBy: publishMetadata.createdBy.trim() || "admin"
        }
      });

      if (saveResult.canceled) {
        setStatus("파일 저장을 취소했습니다.");
        return;
      }

      setStatus(`발행 완료: ${saveResult.filePath}`);
      setPublishDialogOpen(false);
      setPin("");
      setPinConfirm("");
      if (smtpSendActionEnabled && saveResult.filePath) {
        setPendingEmailPackage({
          source: "publish",
          documentId: securePackage.doc.id,
          attachmentFileName: suggestedFileName,
          filePath: saveResult.filePath
        });
        setEmailSendForm({
          recipientEmail: "",
          subject: `Secure document: ${securePackage.doc.title}`,
          attachmentFileName: suggestedFileName
        });
        setEmailDialogOpen(true);
      }
      const nextHistory = await window.secureDoc.getHistory();
      setHistory(nextHistory);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "발행 중 오류가 발생했습니다.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="관리 메뉴">
        <div className="brand">Secure Doc</div>
        <nav className="nav">
          {navigationItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={activeNavTarget === item.id ? "active" : ""}
              aria-current={activeNavTarget === item.id ? "page" : undefined}
              onClick={() => switchScreen(item)}
            >
              {item.label}
            </button>
          ))}
          <span className="group-label">배포 대상</span>
          <span className="nav-note">macOS universal</span>
          <span className="nav-note">Windows x64</span>
        </nav>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div>
            <p className="eyebrow">WebCrypto Offline Secure Document</p>
            <h1>Secure Doc Admin</h1>
          </div>
          <div className="platforms" aria-label="작업 상태">
            <span>Offline</span>
            <span>AES-256-GCM</span>
          </div>
        </header>

        <div className="workspace" ref={screenRootRef} tabIndex={-1}>
        {activeNavTarget === "document" && (
          <>
        <section
          className="panel metadata-panel"
          aria-labelledby="metadata-heading"
        >
          <div className="section-heading">
            <h2 id="metadata-heading">문서 기본정보</h2>
          </div>
          <div className="form-grid document-meta-grid">
            <label className="field-type">
              문서 유형
              <select value={metadata.docType} onChange={(event) => handleDocumentTypeChange(event.target.value as DocumentType)}>
                {documentTypes.map((docType) => (
                  <option key={docType} value={docType}>
                    {docType}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-title">
              문서 제목
              <input value={metadata.title} onChange={(event) => updateMetadata("title", event.target.value)} />
            </label>
            <label className="field-issuer">
              발행자
              <input value={metadata.issuer} onChange={(event) => updateMetadata("issuer", event.target.value)} />
            </label>
            <label className="field-recipient">
              수신자
              <input value={metadata.recipientName} onChange={(event) => updateMetadata("recipientName", event.target.value)} />
            </label>
            <label className="field-number">
              문서번호
              <input value={metadata.documentNumber} onChange={(event) => updateMetadata("documentNumber", event.target.value)} />
            </label>
            <label className="field-date">
              만료일
              <input
                type="date"
                value={metadata.displayExpiresAt}
                onChange={(event) => updateMetadata("displayExpiresAt", event.target.value)}
              />
            </label>
            <label className="field-watermark">
              워터마크 문구
              <input value={metadata.watermarkText} onChange={(event) => updateMetadata("watermarkText", event.target.value)} />
            </label>
          </div>
          <div className="template-picker">
            <label>
              템플릿
              <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                {CORE_DOCUMENT_TEMPLATES.map((template) => (
                  <option key={template.id} value={template.id}>
                    {templateOptionLabel(template)}
                  </option>
                ))}
              </select>
            </label>
            <div className="template-summary">
              <strong>{selectedTemplate.name}</strong>
              <span>{selectedTemplate.description}</span>
            </div>
            <button type="button" className="template-apply-button" onClick={handleApplySelectedTemplate}>
              템플릿 적용
            </button>
          </div>
          <details className="admin-meta-details">
            <summary>관리용 정보</summary>
            <div className="admin-meta-grid">
              <label className="field-description">
                관리 메모
                <input value={metadata.description} onChange={(event) => updateMetadata("description", event.target.value)} />
              </label>
              <label className="field-created">
                발행 작업자
                <input value={metadata.createdBy} onChange={(event) => updateMetadata("createdBy", event.target.value)} />
              </label>
            </div>
          </details>
        </section>

        <section className="panel editor-panel" aria-labelledby="editor-heading">
          <div className="section-heading">
            <h2 id="editor-heading">암호화 본문 작성</h2>
            <div className="mode-toggle editor-mode-toggle" aria-label="본문 작성 모드">
                <button
                  type="button"
                  className={editorMode === "visual" ? "active" : ""}
                  onClick={() => switchEditorMode("visual")}
                >
                  편집
                </button>
                <button
                  type="button"
                  className={editorMode === "html" ? "active" : ""}
                  onClick={() => switchEditorMode("html")}
                >
                  HTML 보기
                </button>
              </div>
          </div>
          <div className="editor-toolbar-row">
            <div className="editor-actions">
            <div className="toolbar" aria-label="본문 서식">
              <div className="toolbar-section">
                <ToolbarButton
                  label="↶"
                  title="실행 취소"
                  disabled={!canRunEditorCommand(() => editor!.can().undo())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().undo().run() ?? false)}
                />
                <ToolbarButton
                  label="↷"
                  title="다시 실행"
                  disabled={!canRunEditorCommand(() => editor!.can().redo())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().redo().run() ?? false)}
                />
              </div>
              <div className="toolbar-section">
                <select
                  className="block-style-select"
                  title="문단 스타일"
                  aria-label="문단 스타일"
                  value={currentBlockStyle()}
                  disabled={!editor}
                  onChange={(event) => setBlockStyle(event.target.value as BlockStyle)}
                >
                  <option value="paragraph">P</option>
                  <option value="heading-1">H1</option>
                  <option value="heading-2">H2</option>
                  <option value="heading-3">H3</option>
                </select>
              </div>
              <div className="toolbar-section">
                <ToolbarButton
                  label=""
                  title="왼쪽 정렬"
                  format="align-left"
                  active={currentTextAlign() === "left"}
                  disabled={!canSetTextAlign()}
                  onClick={() => setTextAlign("left")}
                />
                <ToolbarButton
                  label=""
                  title="가운데 정렬"
                  format="align-center"
                  active={currentTextAlign() === "center"}
                  disabled={!canSetTextAlign()}
                  onClick={() => setTextAlign("center")}
                />
                <ToolbarButton
                  label=""
                  title="오른쪽 정렬"
                  format="align-right"
                  active={currentTextAlign() === "right"}
                  disabled={!canSetTextAlign()}
                  onClick={() => setTextAlign("right")}
                />
                <ToolbarButton
                  label=""
                  title="양쪽 정렬"
                  format="align-justify"
                  active={currentTextAlign() === "justify"}
                  disabled={!canSetTextAlign()}
                  onClick={() => setTextAlign("justify")}
                />
              </div>
              <div className="toolbar-section">
                <ToolbarButton
                  label="B"
                  title="굵게"
                  active={isEditorActive("bold")}
                  format="bold"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleBold().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleBold().run() ?? false)}
                />
                <ToolbarButton
                  label="I"
                  title="기울임"
                  active={isEditorActive("italic")}
                  format="italic"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleItalic().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleItalic().run() ?? false)}
                />
                <ToolbarButton
                  label="U"
                  title="밑줄"
                  active={isEditorActive("underline")}
                  format="underline"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleUnderline().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleUnderline().run() ?? false)}
                />
                <ToolbarButton
                  label="S"
                  title="취소선"
                  active={isEditorActive("strike")}
                  format="strike"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleStrike().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleStrike().run() ?? false)}
                />
                <ToolbarButton
                  label="&lt;/&gt;"
                  title="인라인 코드"
                  active={isEditorActive("code")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleCode().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleCode().run() ?? false)}
                />
                <ToolbarButton
                  label="Tx"
                  title="서식 지우기"
                  disabled={!editor}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().unsetAllMarks().clearNodes().run() ?? false)}
                />
              </div>
              <div className="toolbar-section">
                <ToolbarButton
                  label="☷"
                  title="글머리 목록"
                  active={isEditorActive("bulletList")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleBulletList().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleBulletList().run() ?? false)}
                />
                <ToolbarButton
                  label="1."
                  title="번호 목록"
                  active={isEditorActive("orderedList")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleOrderedList().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleOrderedList().run() ?? false)}
                />
                <ToolbarButton
                  label="❝"
                  title="인용 블록"
                  active={isEditorActive("blockquote")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleBlockquote().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleBlockquote().run() ?? false)}
                />
                <ToolbarButton
                  label="{ }"
                  title="코드 블록"
                  active={isEditorActive("codeBlock")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleCodeBlock().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleCodeBlock().run() ?? false)}
                />
                <ToolbarButton
                  label="―"
                  title="구분선"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().setHorizontalRule().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().setHorizontalRule().run() ?? false)}
                />
              </div>
              <div className="toolbar-section">
                <ToolbarButton
                  label="↗"
                  title="링크 삽입 또는 수정"
                  active={isEditorActive("link")}
                  disabled={!editor}
                  onClick={handleSetLink}
                />
                <ToolbarButton
                  label="↛"
                  title="링크 해제"
                  disabled={!isEditorActive("link")}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().extendMarkRange("link").unsetLink().run() ?? false)}
                />
              </div>
              </div>
            </div>
          </div>
          {editorMode === "visual" ? (
            <EditorContent editor={editor} className="editor rich-editor" />
          ) : (
            <textarea
              className="editor source-editor"
              value={editorHtml}
              spellCheck={false}
              onChange={(event) => {
                setEditorHtml(event.target.value);
                setSyncPresetWithMetadata(false);
              }}
            />
          )}
          <div className="preview-band">
            <h3>미리보기</h3>
            <div className="preview" dangerouslySetInnerHTML={{ __html: sanitizedPreview }} />
          </div>
          <div className="editor-publish-row">
            <button type="button" className="primary" onClick={openPublishDialog}>
              HTML 파일 생성
            </button>
          </div>
          {status && <div className="status">{status}</div>}
          {error && <div className="error">{error}</div>}
        </section>
          </>
        )}

        {activeNavTarget === "security" && (
        <section
          className="panel security-panel"
          aria-labelledby="security-heading"
        >
          <div className="section-heading">
            <h2 id="security-heading">보안 정책</h2>
          </div>
          <div className="security-policy-grid">
            <div className="security-policy-item">
              <strong>PIN</strong>
              <span>6-15자 편의형 암호, 원문/해시 저장 금지</span>
            </div>
            <div className="security-policy-item">
              <strong>암호화</strong>
              <span>PBKDF2-HMAC-SHA-256, AES-256-GCM, DEK/KEK 분리</span>
            </div>
            <div className="security-policy-item">
              <strong>뷰어</strong>
              <span>오프라인 single HTML, 외부 연결 차단 CSP 유지</span>
            </div>
            <div className="security-policy-item">
              <strong>저장 금지</strong>
              <span>평문 본문, PIN, PIN hash, DEK, KEK</span>
            </div>
          </div>
        </section>
        )}

        {activeNavTarget === "history" && (
        <section
          className="panel history-panel"
          aria-labelledby="history-heading"
        >
          <div className="section-heading">
            <h2 id="history-heading">발행 이력</h2>
          </div>
          <div className="history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>문서</th>
                  <th>발행자</th>
                  <th>반복</th>
                  <th>SHA-256</th>
                  <th>파일</th>
                  <th>이메일</th>
                  <th>감사</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={7}>저장된 발행 이력이 없습니다.</td>
                  </tr>
                ) : (
                  history.map((item) => (
                    <tr key={item.documentId}>
                      <td>
                        <strong>{item.title}</strong>
                        <span>{item.documentId}</span>
                      </td>
                      <td>{item.issuer}</td>
                      <td>{item.iterations.toLocaleString()}</td>
                      <td className="hash">{item.packageSha256}</td>
                      <td>
                        <button type="button" onClick={() => window.secureDoc?.showItemInFolder(item.outputPath)}>
                          보기
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => openHistoryEmailDialog(item)}
                          disabled={!smtpHistorySendActionEnabled}
                        >
                          발송
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void handleAuditIntegrityReport(item)}
                          disabled={!auditHistoryActionEnabled || auditBusyDocumentId === item.documentId}
                        >
                          {auditBusyDocumentId === item.documentId ? "검증 중" : "검증"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {auditReport && (
            <div className={`audit-report ${auditReport.status}`}>
              <div className="audit-report-header">
                <strong>감사 리포트</strong>
                <span>{auditStatusLabel(auditReport)}</span>
              </div>
              <dl>
                <div>
                  <dt>문서</dt>
                  <dd>{auditReport.title}</dd>
                </div>
                <div>
                  <dt>문서 ID</dt>
                  <dd>{auditReport.documentId}</dd>
                </div>
                <div>
                  <dt>검증 시각</dt>
                  <dd>{new Date(auditReport.checkedAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>SHA-256</dt>
                  <dd className="hash">{auditReport.packageSha256}</dd>
                </div>
              </dl>
              <p>{auditReport.message}</p>
            </div>
          )}
        </section>
        )}

        {activeNavTarget === "plugins" && (
        <section
          className="panel plugins-panel"
          aria-labelledby="plugins-heading"
        >
          <div className="section-heading">
            <h2 id="plugins-heading">플러그인</h2>
          </div>
          <div className="plugin-list">
            {plugins.length === 0 ? (
              <div className="plugin-empty">등록된 built-in 플러그인이 없습니다.</div>
            ) : (
              plugins.map((plugin) => {
                const contributionLabels = pluginContributionLabels(plugin);
                const featureDescriptions = pluginFeatureDescriptions(plugin);
                const displayName = pluginDisplayName(plugin);
                return (
                  <article className="plugin-item" key={plugin.id}>
                    <div className="plugin-item-main">
                      <div>
                        <div className="plugin-title-row">
                          <h3>{displayName}</h3>
                          <span className="plugin-category">{pluginCategoryLabel(plugin.category)}</span>
                        </div>
                        <p className="plugin-description">{pluginDisplayDescription(plugin)}</p>
                        <div className="plugin-meta">
                          <span>{plugin.id}</span>
                          <span>v{plugin.version}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className={["plugin-toggle-button", plugin.enabled ? "enabled" : ""].filter(Boolean).join(" ")}
                        role="switch"
                        aria-checked={plugin.enabled}
                        aria-label={`${displayName} 플러그인 ${plugin.enabled ? "비활성화" : "활성화"}`}
                        disabled={pluginBusyId === plugin.id}
                        onClick={() => void handlePluginToggle(plugin, !plugin.enabled)}
                      >
                        <span className="plugin-toggle-track" aria-hidden="true">
                          <span className="plugin-toggle-thumb" />
                        </span>
                        <span className="plugin-toggle-text">{plugin.enabled ? "활성" : "비활성"}</span>
                      </button>
                    </div>
                    {featureDescriptions.length > 0 && (
                      <div className="plugin-feature-list" aria-label={`${displayName} 기능 설명`}>
                        <strong>활성화하면</strong>
                        <ul>
                          {featureDescriptions.map((description) => (
                            <li key={description}>{description}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="plugin-chip-row" aria-label={`${displayName} 권한`}>
                      {plugin.permissions.length === 0 ? (
                        <span className="plugin-chip muted">권한 없음</span>
                      ) : (
                        plugin.permissions.map((permission) => (
                          <span className="plugin-chip" key={permission}>
                            {pluginPermissionLabel(permission)}
                          </span>
                        ))
                      )}
                    </div>
                    <div className="plugin-chip-row" aria-label={`${displayName} 확장 지점`}>
                      {contributionLabels.map((label) => (
                        <span className="plugin-chip contribution" key={label}>
                          {label}
                        </span>
                      ))}
                    </div>
                    {plugin.id === GMAIL_SMTP_PLUGIN_ID && plugin.enabled && (
                      <div className="smtp-settings-panel">
                        <div className="smtp-settings-heading">
                          <strong>Gmail SMTP 설정</strong>
                          <span className={smtpSettings?.hasAppPassword ? "smtp-secret-badge saved" : "smtp-secret-badge"}>
                            {smtpSettings?.hasAppPassword ? "비밀번호 저장됨" : "비밀번호 필요"}
                          </span>
                        </div>
                        <div className="smtp-settings-grid">
                          <label className="smtp-field smtp-field-host">
                            SMTP host
                            <input
                              value={smtpSettingsForm.host}
                              onChange={(event) => updateSmtpSettingsForm("host", event.target.value)}
                              placeholder="smtp.gmail.com"
                            />
                          </label>
                          <label className="smtp-field smtp-field-port">
                            SMTP port
                            <input
                              value={smtpSettingsForm.port}
                              onChange={(event) => updateSmtpSettingsForm("port", event.target.value)}
                              inputMode="numeric"
                              placeholder="587"
                            />
                          </label>
                          <label className="smtp-field smtp-field-account">
                            Gmail 계정
                            <input
                              value={smtpSettingsForm.senderEmail}
                              onChange={(event) => updateSmtpSettingsForm("senderEmail", event.target.value)}
                              placeholder="user@gmail.com"
                              autoComplete="username"
                            />
                          </label>
                          <label className="smtp-field smtp-field-secret">
                            {smtpSettings?.hasAppPassword ? "앱 비밀번호 교체" : "앱 비밀번호"}
                            <input
                              value={smtpSettingsForm.appPassword}
                              onChange={(event) => updateSmtpSettingsForm("appPassword", event.target.value)}
                              type="password"
                              placeholder={smtpSettings?.hasAppPassword ? "새 비밀번호 입력 시 교체" : "abcd efgh ijkl mnop"}
                              autoComplete="new-password"
                            />
                            <span className="field-hint">
                              {smtpSettings?.hasAppPassword
                                ? "기존 비밀번호는 저장되어 있으며 표시하지 않습니다. 새 값을 입력하면 저장 시 교체됩니다."
                                : "Google 앱 비밀번호 16자리를 입력하세요. 공백은 자동 제거됩니다."}
                            </span>
                          </label>
                        </div>
                        <div className="button-row smtp-settings-actions">
                          <button
                            type="button"
                            className="smtp-command primary-command"
                            onClick={handleSaveSmtpSettings}
                            disabled={smtpBusy}
                          >
                            설정 저장
                          </button>
                          <button
                            type="button"
                            className="smtp-command"
                            onClick={handleTestSmtpSettings}
                            disabled={smtpBusy}
                          >
                            연결 테스트
                          </button>
                          <button
                            type="button"
                            className="smtp-command danger-command"
                            onClick={handleClearSmtpSettings}
                            disabled={smtpBusy}
                          >
                            설정 삭제
                          </button>
                        </div>
                        {smtpStatus && <div className="status">{smtpStatus}</div>}
                        {smtpError && <div className="error">{smtpError}</div>}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
          {pluginContributions.publishActions.length > 0 && (
            <div className="plugin-contribution-summary">
              활성 발행 액션: {pluginContributions.publishActions.map((action) => action.label).join(", ")}
            </div>
          )}
          {pluginContributions.policyProfiles.length > 0 && (
            <div className="plugin-contribution-summary">
              활성 발행 정책: {pluginContributions.policyProfiles.map((profile) => profile.label).join(", ")}
            </div>
          )}
        </section>
        )}
        </div>
      </main>
      {publishDialogOpen && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePublishDialog();
            }
          }}
        >
          <section className="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-dialog-heading">
            <div className="publish-dialog-header">
              <h2 id="publish-dialog-heading">PIN 설정 및 발행</h2>
              <button type="button" className="dialog-close" onClick={closePublishDialog} disabled={busy}>
                닫기
              </button>
            </div>
            <p className="security-note publish-note">
              6자리 이상 15자리 이내 PIN은 문자와 기호를 함께 사용할 수 있는 편의형 암호입니다. 자동 생성 후 표시 버튼으로 확인하거나 복사할 수 있습니다.
            </p>
            <div className="publish-policy-summary">
              <strong>
                {activePolicyProfiles.length > 0
                  ? `활성 정책: ${activePolicyProfiles.map((profile) => profile.label).join(", ")}`
                  : "기본 발행 정책"}
              </strong>
              <ul>
                {publishPolicyRequirementItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="publish-dialog-grid">
              <label className="field-pin">
                문서 열람 PIN
                <input
                  value={pin}
                  onChange={(event) => setPin(normalizePinInput(event.target.value))}
                  type={showPin ? "text" : "password"}
                  autoComplete="one-time-code"
                />
              </label>
              <label className="field-pin">
                PIN 확인
                <input
                  value={pinConfirm}
                  onChange={(event) => setPinConfirm(normalizePinInput(event.target.value))}
                  type={showPin ? "text" : "password"}
                  autoComplete="one-time-code"
                />
              </label>
              <label className="field-iterations">
                PBKDF2 반복 횟수
                <select value={iterations} onChange={(event) => setIterations(Number(event.target.value))}>
                  <option value={DEFAULT_PIN_KDF_ITERATIONS}>1,000,000 기본</option>
                  <option value={COMPAT_PIN_KDF_ITERATIONS}>600,000 저사양 호환</option>
                </select>
              </label>
            </div>
            <div className="button-row publish-dialog-actions">
              <button type="button" onClick={handleGeneratePin}>
                자동 생성
              </button>
              <button type="button" onClick={handleCopyPin} disabled={!pinResult.valid}>
                복사
              </button>
              <button type="button" onClick={() => setShowPin((value) => !value)}>
                {showPin ? "숨김" : "표시"}
              </button>
              <button type="button" onClick={closePublishDialog} disabled={busy}>
                취소
              </button>
              <button type="button" className="primary" onClick={handlePublish} disabled={busy}>
                {busy ? "발행 중" : "HTML 파일 생성"}
              </button>
            </div>
            <div className={pinResult.valid ? "policy ok" : "policy"}>{pin ? pinResult.message : "PIN 정책 검사 대기 중"}</div>
            {activePolicyProfiles.length > 0 && publishPolicyResult.messages.length > 0 && (pin || pinConfirm) && (
              <ul className="publish-policy-errors">
                {publishPolicyResult.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
            {status && <div className="status">{status}</div>}
            {error && <div className="error">{error}</div>}
          </section>
        </div>
      )}
      {emailDialogOpen && pendingEmailPackage && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEmailDialog();
            }
          }}
        >
          <section className="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="email-dialog-heading">
            <div className="publish-dialog-header">
              <h2 id="email-dialog-heading">이메일로 발송</h2>
              <button type="button" className="dialog-close" onClick={closeEmailDialog} disabled={emailBusy}>
                닫기
              </button>
            </div>
            <p className="security-note publish-note">
              저장된 보안 HTML 문서만 첨부합니다. 문서 본문 평문과 PIN은 이메일에 포함하지 않습니다.
            </p>
            <div className="publish-dialog-grid email-dialog-grid">
              <label>
                수신자 이메일
                <input
                  value={emailSendForm.recipientEmail}
                  onChange={(event) => updateEmailSendForm("recipientEmail", event.target.value)}
                  placeholder="recipient@example.com"
                  type="email"
                  autoComplete="email"
                />
              </label>
              <label>
                제목
                <input
                  value={emailSendForm.subject}
                  onChange={(event) => updateEmailSendForm("subject", event.target.value)}
                />
              </label>
              <label>
                첨부 파일명
                <input
                  value={emailSendForm.attachmentFileName}
                  onChange={(event) => updateEmailSendForm("attachmentFileName", event.target.value)}
                />
              </label>
            </div>
            <div className="attachment-confirm">
              <span>저장 위치</span>
              <strong>{pendingEmailPackage.filePath}</strong>
            </div>
            <div className="button-row publish-dialog-actions">
              <button type="button" onClick={closeEmailDialog} disabled={emailBusy}>
                취소
              </button>
              <button type="button" className="primary" onClick={handleSendEmail} disabled={emailBusy}>
                {emailBusy ? "발송 중" : "이메일 발송"}
              </button>
            </div>
            {status && <div className="status">{status}</div>}
            {error && <div className="error">{error}</div>}
          </section>
        </div>
      )}
    </div>
  );
}
