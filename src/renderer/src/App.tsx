import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type {
  PackageIntegrityReport,
  PublishHistoryRecord,
  SaveSmtpSettingsRequest,
  SendSmtpEmailResult,
  SmtpSettingsView
} from "../../shared/desktopApi";
import {
  COMPANY_DEFAULT_BRANDING_PLUGIN_ID,
  EMPTY_PLUGIN_CONTRIBUTIONS,
  GENERIC_SMTP_HISTORY_SEND_ACTION_ID,
  GENERIC_SMTP_PLUGIN_ID,
  GENERIC_SMTP_SEND_ACTION_ID,
  GENERIC_SMTP_TEST_ACTION_ID,
  GMAIL_SMTP_HISTORY_SEND_ACTION_ID,
  GMAIL_SMTP_PLUGIN_ID,
  GMAIL_SMTP_SEND_ACTION_ID,
  GMAIL_SMTP_TEST_ACTION_ID,
  SMTP_DELIVERY_PLUGIN_IDS,
  isSmtpDeliveryPluginId,
  type PluginCategory,
  type PluginContributions,
  type PluginDescriptor,
  type PluginPermission,
  type ResolvedPluginBrandingPresetContribution,
  type SmtpDeliveryPluginId
} from "../../shared/plugins";
import { compactViewerTheme } from "../../shared/branding";
import type { SecureDocViewerTheme } from "../../shared/branding";
import {
  CORE_DOCUMENT_TEMPLATES,
  DEFAULT_DOCUMENT_TEMPLATE_ID,
  applyDocumentTemplateDefaults,
  buildDocumentTemplateBodyHtml,
  getDocumentTemplateById,
  resolveAvailableDocumentTemplates,
  type DocumentTemplate,
  type DocumentTemplateCategory,
  type DocumentTemplateMetadata
} from "../../shared/documentTemplates";
import {
  DEFAULT_PIN_KDF_ITERATIONS,
  evaluatePinPolicy,
  GENERATED_PIN_LENGTH,
  generatePin,
  PIN_MAX_LENGTH
} from "../../shared/pinPolicy";
import {
  evaluatePublishPolicy,
  getEffectivePublishPolicy,
  publishPolicyMetadataFieldLabel
} from "../../shared/publishPolicy";
import { issueSecureDocument, type SecureDocPlainContent } from "../../shared/securePackage";
import { buildSecureHtmlDocument } from "../../shared/viewerHtml";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveLocale,
  translate,
  translateOptional,
  type Locale,
  type TranslationKey
} from "../../shared/i18n";
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
  username: string;
  password: string;
  secure: boolean;
  requireTLS: boolean;
};

type PendingEmailPackage = {
  source: "publish";
  pluginId: SmtpDeliveryPluginId;
  actionId: string;
  documentId: string;
  attachmentFileName: string;
  filePath: string;
} | {
  source: "history";
  pluginId: SmtpDeliveryPluginId;
  actionId: string;
  documentId: string;
  attachmentFileName: string;
  filePath: string;
};

type EmailSendForm = {
  recipientEmail: string;
  subject: string;
  attachmentFileName: string;
};

type SmtpActionSelection = {
  pluginId: SmtpDeliveryPluginId;
  actionId: string;
};

type BrandingPresetSnapshot = {
  pluginId: string;
  presetId: string;
  label: string;
  viewerTheme?: ResolvedPluginBrandingPresetContribution["viewerTheme"];
};

const textAlignments: TextAlign[] = ["left", "center", "right", "justify"];

const defaultSmtpSettingsForms: Record<SmtpDeliveryPluginId, SmtpSettingsForm> = {
  [GMAIL_SMTP_PLUGIN_ID]: {
    host: "smtp.gmail.com",
    port: "587",
    senderEmail: "",
    username: "",
    password: "",
    secure: false,
    requireTLS: true
  },
  [GENERIC_SMTP_PLUGIN_ID]: {
    host: "",
    port: "587",
    senderEmail: "",
    username: "",
    password: "",
    secure: false,
    requireTLS: true
  }
};

const defaultEmailSendForm: EmailSendForm = {
  recipientEmail: "",
  subject: "",
  attachmentFileName: ""
};

const navigationTargets: readonly NavTarget[] = ["document", "history", "security", "plugins"];

const documentTypeTranslationKeys: Record<DocumentType, TranslationKey> = {
  "안내문": "template.category.notice",
  "계약서": "template.category.contract",
  "정책/규정": "template.category.policy",
  "기타": "template.category.general",
  "보험증서": "template.core.insurance-certificate.name",
  "고지서": "template.core.billing-notice.name"
};

function isTextAlign(value: unknown): value is TextAlign {
  return typeof value === "string" && textAlignments.includes(value as TextAlign);
}

function pluginCategoryLabel(category: PluginCategory, locale: Locale): string {
  return translate(locale, `plugin.category.${category}` as TranslationKey);
}

function pluginPermissionLabel(permission: PluginPermission, locale: Locale): string {
  return translate(locale, `plugin.permission.${permission}` as TranslationKey);
}

function documentTypeLabel(docType: DocumentType, locale: Locale): string {
  return translate(locale, documentTypeTranslationKeys[docType]);
}

function templateDisplayName(template: DocumentTemplate, locale: Locale): string {
  return translateOptional(locale, `template.${template.id}.name`, template.name);
}

function templateDisplayDescription(template: DocumentTemplate, locale: Locale): string {
  return translateOptional(locale, `template.${template.id}.description`, template.description);
}

function templateOptionLabel(template: DocumentTemplate, locale: Locale): string {
  const sourceLabel = template.pluginName ? `${template.pluginName} / ` : "";
  return `${sourceLabel}${translate(locale, `template.category.${template.category}` as TranslationKey)} · ${templateDisplayName(template, locale)}`;
}

function pluginDisplayName(plugin: PluginDescriptor, locale: Locale): string {
  if (plugin.id === GMAIL_SMTP_PLUGIN_ID) {
    return translate(locale, "plugin.gmail.name");
  }
  if (plugin.id === GENERIC_SMTP_PLUGIN_ID) {
    return translate(locale, "plugin.generic.name");
  }
  if (plugin.id === COMPANY_DEFAULT_BRANDING_PLUGIN_ID) {
    return translate(locale, "plugin.branding.name");
  }
  if (plugin.id === "template-pack.business-samples") {
    return translate(locale, "plugin.templatePack.name");
  }
  return plugin.name;
}

function pluginDisplayDescription(plugin: PluginDescriptor, locale: Locale): string {
  if (plugin.id === GMAIL_SMTP_PLUGIN_ID) {
    return translate(locale, "plugin.gmail.description");
  }
  if (plugin.id === GENERIC_SMTP_PLUGIN_ID) {
    return translate(locale, "plugin.generic.description");
  }
  if (plugin.id === COMPANY_DEFAULT_BRANDING_PLUGIN_ID) {
    return translate(locale, "plugin.branding.description");
  }
  if (plugin.id === "template-pack.business-samples") {
    return translate(locale, "plugin.templatePack.description");
  }
  return plugin.description;
}

function pluginFeatureDescriptions(plugin: PluginDescriptor, locale: Locale): string[] {
  if (plugin.id === GMAIL_SMTP_PLUGIN_ID) {
    return [
      translate(locale, "plugin.gmail.feature.settings"),
      translate(locale, "plugin.gmail.feature.publish"),
      translate(locale, "plugin.gmail.feature.history")
    ];
  }
  if (plugin.id === GENERIC_SMTP_PLUGIN_ID) {
    return [
      translate(locale, "plugin.generic.feature.settings"),
      translate(locale, "plugin.generic.feature.verify"),
      translate(locale, "plugin.generic.feature.mask")
    ];
  }
  if (plugin.id === COMPANY_DEFAULT_BRANDING_PLUGIN_ID) {
    return [
      translate(locale, "plugin.branding.feature.metadata"),
      translate(locale, "plugin.branding.feature.privateMeta"),
      translate(locale, "plugin.branding.feature.offline")
    ];
  }

  const descriptions: string[] = [];
  if (plugin.contributes.settingsPanel) {
    descriptions.push(translate(locale, "plugin.dynamic.settingsPanel"));
  }
  for (const action of plugin.contributes.publishActions ?? []) {
    descriptions.push(translate(locale, "plugin.dynamic.publishAction", { description: action.description }));
  }
  for (const action of plugin.contributes.historyActions ?? []) {
    descriptions.push(translate(locale, "plugin.dynamic.historyAction", { description: action.description }));
  }
  for (const template of plugin.contributes.templates ?? []) {
    descriptions.push(translate(locale, "plugin.dynamic.template", { description: template.description }));
  }
  for (const policyProfile of plugin.contributes.policyProfiles ?? []) {
    descriptions.push(translate(locale, "plugin.dynamic.policy", { description: policyProfile.description }));
  }
  for (const brandingPreset of plugin.contributes.brandingPresets ?? []) {
    descriptions.push(translate(locale, "plugin.dynamic.branding", { description: brandingPreset.description }));
  }
  return descriptions;
}

function pluginContributionLabels(plugin: PluginDescriptor, locale: Locale): string[] {
  const labels: string[] = [];
  if (plugin.contributes.settingsPanel) {
    labels.push(translate(locale, "plugin.contribution.settingsPanel"));
  }
  if (plugin.contributes.publishActions?.length) {
    labels.push(translate(locale, "plugin.contribution.publishActions"));
  }
  if (plugin.contributes.templates?.length) {
    labels.push(translate(locale, "plugin.contribution.templates"));
  }
  if (plugin.contributes.historyActions?.length) {
    labels.push(translate(locale, "plugin.contribution.historyActions"));
  }
  if (plugin.contributes.policyProfiles?.length) {
    labels.push(translate(locale, "plugin.contribution.policyProfiles"));
  }
  if (plugin.contributes.brandingPresets?.length) {
    labels.push(translate(locale, "plugin.contribution.brandingPresets"));
  }
  return labels;
}

function smtpSettingsToForm(settings: SmtpSettingsView): SmtpSettingsForm {
  return {
    host: settings.host,
    port: String(settings.port),
    senderEmail: settings.senderEmail,
    username: settings.username,
    password: "",
    secure: settings.secure,
    requireTLS: settings.requireTLS
  };
}

function defaultSmtpSettingsForm(pluginId: SmtpDeliveryPluginId): SmtpSettingsForm {
  return defaultSmtpSettingsForms[pluginId];
}

function smtpSettingsMapToForms(settingsById: Partial<Record<SmtpDeliveryPluginId, SmtpSettingsView>>): Record<SmtpDeliveryPluginId, SmtpSettingsForm> {
  return {
    [GMAIL_SMTP_PLUGIN_ID]: settingsById[GMAIL_SMTP_PLUGIN_ID]
      ? smtpSettingsToForm(settingsById[GMAIL_SMTP_PLUGIN_ID])
      : defaultSmtpSettingsForm(GMAIL_SMTP_PLUGIN_ID),
    [GENERIC_SMTP_PLUGIN_ID]: settingsById[GENERIC_SMTP_PLUGIN_ID]
      ? smtpSettingsToForm(settingsById[GENERIC_SMTP_PLUGIN_ID])
      : defaultSmtpSettingsForm(GENERIC_SMTP_PLUGIN_ID)
  };
}

function getActiveSmtpSendActions(contributions: PluginContributions): SmtpActionSelection[] {
  return contributions.publishActions.flatMap((candidate) =>
    isSmtpDeliveryPluginId(candidate.pluginId) &&
    (candidate.id === GMAIL_SMTP_SEND_ACTION_ID || candidate.id === GENERIC_SMTP_SEND_ACTION_ID)
      ? [{ pluginId: candidate.pluginId, actionId: candidate.id }]
      : []
  );
}

function getActiveSmtpHistorySendActions(contributions: PluginContributions): SmtpActionSelection[] {
  return contributions.historyActions.flatMap((candidate) =>
    isSmtpDeliveryPluginId(candidate.pluginId) &&
    (candidate.id === GMAIL_SMTP_HISTORY_SEND_ACTION_ID || candidate.id === GENERIC_SMTP_HISTORY_SEND_ACTION_ID)
      ? [{ pluginId: candidate.pluginId, actionId: candidate.id }]
      : []
  );
}

function chooseSmtpAction(
  actions: readonly SmtpActionSelection[],
  preferredPluginId: SmtpDeliveryPluginId
): SmtpActionSelection | null {
  return actions.find((action) => action.pluginId === preferredPluginId) ?? actions[0] ?? null;
}

function smtpPluginLabel(pluginId: SmtpDeliveryPluginId): string {
  return pluginId === GMAIL_SMTP_PLUGIN_ID ? "Gmail SMTP" : "Generic SMTP";
}

function smtpTestActionId(pluginId: SmtpDeliveryPluginId): string {
  return pluginId === GENERIC_SMTP_PLUGIN_ID ? GENERIC_SMTP_TEST_ACTION_ID : GMAIL_SMTP_TEST_ACTION_ID;
}

function smtpSecretSaved(settings: SmtpSettingsView | undefined): boolean {
  return Boolean(settings?.hasPassword || settings?.hasAppPassword);
}

function fileNameFromPath(filePath: string): string {
  const name = filePath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return name.endsWith(".html") ? name : "secure-document.html";
}

function normalizeEmailAddressInput(value: string, fieldLabel: string, locale: Locale): string {
  const email = value.normalize("NFKC").trim();
  if (!email || email.length > 254 || /\s/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    throw new Error(translate(locale, "email.recipientInvalid", { field: fieldLabel }));
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

function brandingPresetKey(preset: Pick<ResolvedPluginBrandingPresetContribution, "pluginId" | "id">): string {
  return `${preset.pluginId}:${preset.id}`;
}

function brandingSnapshot(preset: ResolvedPluginBrandingPresetContribution | null): BrandingPresetSnapshot | undefined {
  if (!preset) {
    return undefined;
  }

  const viewerTheme = compactViewerTheme(preset.viewerTheme);
  return {
    pluginId: preset.pluginId,
    presetId: preset.id,
    label: preset.label,
    viewerTheme
  };
}

function brandingPresetMetadataMatches(
  preset: ResolvedPluginBrandingPresetContribution,
  metadata: Pick<MetadataState, "issuer" | "watermarkText">
): boolean {
  const issuerMatches = preset.issuer === undefined || metadata.issuer === preset.issuer;
  const watermarkMatches = preset.watermarkText === undefined || metadata.watermarkText === preset.watermarkText;
  return issuerMatches && watermarkMatches;
}

function brandingPresetEffectItems(preset: ResolvedPluginBrandingPresetContribution, locale: Locale): string[] {
  const items: string[] = [];
  if (preset.issuer) {
    items.push(translate(locale, "branding.issuerItem", { issuer: preset.issuer }));
  }
  if (preset.watermarkText) {
    items.push(translate(locale, "branding.watermarkItem", { watermark: preset.watermarkText }));
  }
  if (compactViewerTheme(preset.viewerTheme)) {
    items.push(translate(locale, "branding.viewerThemeItem"));
  }
  return items;
}

function documentBrandingStyle(theme: SecureDocViewerTheme | undefined): CSSProperties | undefined {
  const compactTheme = compactViewerTheme(theme);
  if (!compactTheme) {
    return undefined;
  }

  return {
    "--document-accent": compactTheme.accentColor,
    "--document-accent-soft": compactTheme.accentSoftColor,
    "--document-bg": compactTheme.backgroundColor,
    "--document-surface": compactTheme.surfaceColor,
    "--document-text": compactTheme.textColor,
    "--document-muted": compactTheme.mutedTextColor,
    "--document-border": compactTheme.documentBorderColor ?? compactTheme.accentColor,
    "--document-line": compactTheme.borderColor
  } as CSSProperties;
}

function compactPrivateMeta(
  metadata: MetadataState,
  brandingPreset: ResolvedPluginBrandingPresetContribution | null
): SecureDocPlainContent["privateMeta"] {
  return {
    description: metadata.description || undefined,
    docType: metadata.docType || undefined,
    watermarkText: metadata.watermarkText || undefined,
    recipientName: metadata.recipientName || undefined,
    documentNumber: metadata.documentNumber || undefined,
    branding: brandingSnapshot(brandingPreset)
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
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [viewerLocale, setViewerLocale] = useState<Locale>(DEFAULT_LOCALE);
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
  const [smtpSettingsById, setSmtpSettingsById] = useState<Partial<Record<SmtpDeliveryPluginId, SmtpSettingsView>>>({});
  const [smtpSettingsForms, setSmtpSettingsForms] = useState<Record<SmtpDeliveryPluginId, SmtpSettingsForm>>(defaultSmtpSettingsForms);
  const [smtpBusyId, setSmtpBusyId] = useState<SmtpDeliveryPluginId | null>(null);
  const [smtpStatusById, setSmtpStatusById] = useState<Partial<Record<SmtpDeliveryPluginId, string>>>({});
  const [smtpErrorById, setSmtpErrorById] = useState<Partial<Record<SmtpDeliveryPluginId, string>>>({});
  const [syncPresetWithMetadata, setSyncPresetWithMetadata] = useState(true);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [pendingEmailPackage, setPendingEmailPackage] = useState<PendingEmailPackage | null>(null);
  const [emailSendForm, setEmailSendForm] = useState<EmailSendForm>(defaultEmailSendForm);
  const [emailBusy, setEmailBusy] = useState(false);
  const [preferredSmtpPluginId, setPreferredSmtpPluginId] = useState<SmtpDeliveryPluginId>(GMAIL_SMTP_PLUGIN_ID);
  const [auditBusyDocumentId, setAuditBusyDocumentId] = useState<string | null>(null);
  const [auditReport, setAuditReport] = useState<PackageIntegrityReport | null>(null);
  const [activeNavTarget, setActiveNavTarget] = useState<NavTarget>("document");
  const [selectedTemplateId, setSelectedTemplateId] = useState(DEFAULT_DOCUMENT_TEMPLATE_ID);
  const [activeTemplateId, setActiveTemplateId] = useState(DEFAULT_DOCUMENT_TEMPLATE_ID);
  const [selectedBrandingPresetKey, setSelectedBrandingPresetKey] = useState("");
  const [activeBrandingPresetKey, setActiveBrandingPresetKey] = useState("");
  const [pendingTemplateOverwriteId, setPendingTemplateOverwriteId] = useState("");
  const screenRootRef = useRef<HTMLDivElement | null>(null);
  const didMountScreenRef = useRef(false);
  const programmaticEditorUpdateRef = useRef(false);
  const t = (key: TranslationKey, params?: Record<string, string | number>): string => translate(locale, key, params);
  const navigationItems = useMemo(
    () => navigationTargets.map((id) => ({ id, label: t(`nav.${id}` as TranslationKey) })),
    [locale]
  );

  const activePolicyProfiles = pluginContributions.policyProfiles;
  const effectivePublishPolicy = useMemo(() => getEffectivePublishPolicy(activePolicyProfiles), [activePolicyProfiles]);
  const kdfIterationOptions = useMemo(
    () => [...new Set([DEFAULT_PIN_KDF_ITERATIONS, effectivePublishPolicy.minimumKdfIterations])].sort((left, right) => left - right),
    [effectivePublishPolicy.minimumKdfIterations]
  );
  const publishPolicyRequirementItems = useMemo(() => {
    const items = [
      translate(locale, "policy.pinLength", { min: effectivePublishPolicy.minimumPinLength, max: PIN_MAX_LENGTH }),
      translate(locale, "policy.kdfIterations", { count: effectivePublishPolicy.minimumKdfIterations.toLocaleString() })
    ];
    if (effectivePublishPolicy.requiredMetadata.length > 0) {
      items.push(
        translate(locale, "policy.requiredMetadata", {
          fields: effectivePublishPolicy.requiredMetadata.map((field) => publishPolicyMetadataFieldLabel(field, locale)).join(", ")
        })
      );
    }
    if (effectivePublishPolicy.requireWatermark) {
      items.push(translate(locale, "policy.watermarkRequired"));
    }
    return items;
  }, [effectivePublishPolicy, locale]);
  const availableDocumentTemplates = useMemo(
    () => resolveAvailableDocumentTemplates(pluginContributions.templates),
    [pluginContributions.templates]
  );
  const selectedTemplate = useMemo(
    () => getDocumentTemplateById(selectedTemplateId, availableDocumentTemplates) ?? defaultDocumentTemplate,
    [availableDocumentTemplates, selectedTemplateId]
  );
  const activeTemplate = useMemo(
    () => getDocumentTemplateById(activeTemplateId, availableDocumentTemplates) ?? defaultDocumentTemplate,
    [activeTemplateId, availableDocumentTemplates]
  );
  const pendingTemplateOverwrite = useMemo(
    () => (pendingTemplateOverwriteId ? getDocumentTemplateById(pendingTemplateOverwriteId, availableDocumentTemplates) ?? null : null),
    [availableDocumentTemplates, pendingTemplateOverwriteId]
  );
  const templateApplyPending = selectedTemplate.id !== activeTemplate.id;
  const templateBodyState = templateApplyPending ? "pending" : syncPresetWithMetadata ? "applied" : "custom";
  const templateBodyStateLabel =
    templateBodyState === "pending"
      ? t("template.bodyPending")
      : templateBodyState === "custom"
        ? t("template.bodyCustom")
        : t("template.bodyApplied");
  const selectedTemplateDocType = selectedTemplate.defaultMetadata.docType;
  const templateDocTypeMatches = selectedTemplateDocType === metadata.docType;
  const activeBrandingPresets = pluginContributions.brandingPresets;
  const selectedBrandingPreset =
    activeBrandingPresets.find((preset) => brandingPresetKey(preset) === selectedBrandingPresetKey) ?? null;
  const activeBrandingPreset =
    activeBrandingPresets.find((preset) => brandingPresetKey(preset) === activeBrandingPresetKey) ?? null;
  const selectedBrandingPresetResolvedKey = selectedBrandingPreset ? brandingPresetKey(selectedBrandingPreset) : "";
  const selectedBrandingPresetIsActive = Boolean(
    selectedBrandingPreset && selectedBrandingPresetResolvedKey === activeBrandingPresetKey
  );
  const selectedBrandingMetadataChanged = Boolean(
    selectedBrandingPreset &&
      selectedBrandingPresetIsActive &&
      !brandingPresetMetadataMatches(selectedBrandingPreset, metadata)
  );
  const brandingApplyPending = Boolean(
    selectedBrandingPreset && (!selectedBrandingPresetIsActive || selectedBrandingMetadataChanged)
  );
  const brandingBodyState = !selectedBrandingPreset
    ? "empty"
    : !selectedBrandingPresetIsActive
      ? "pending"
      : selectedBrandingMetadataChanged
        ? "custom"
        : "applied";
  const brandingBodyStateLabel =
    brandingBodyState === "pending"
      ? t("branding.pending")
      : brandingBodyState === "custom"
        ? t("branding.custom")
        : brandingBodyState === "applied"
          ? t("branding.applied")
          : t("branding.empty");
  const selectedBrandingEffectItems = selectedBrandingPreset ? brandingPresetEffectItems(selectedBrandingPreset, locale) : [];
  const activeDocumentBrandingStyle = useMemo(
    () => documentBrandingStyle(activeBrandingPreset?.viewerTheme),
    [activeBrandingPreset]
  );
  const pinResult = useMemo(
    () => evaluatePinPolicy(pin, { minLength: effectivePublishPolicy.minimumPinLength, locale }),
    [effectivePublishPolicy.minimumPinLength, locale, pin]
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
        policyProfiles: activePolicyProfiles,
        locale
      }),
    [activePolicyProfiles, contentText, iterations, locale, metadata, pin, pinConfirm]
  );
  const secondaryPublishPolicyMessages = useMemo(
    () => publishPolicyResult.messages.filter((message) => message !== pinResult.message),
    [pinResult.message, publishPolicyResult.messages]
  );
  const activeSmtpSendActions = getActiveSmtpSendActions(pluginContributions);
  const activeSmtpHistorySendActions = getActiveSmtpHistorySendActions(pluginContributions);
  const activeSmtpSendAction = chooseSmtpAction(activeSmtpSendActions, preferredSmtpPluginId);
  const activeSmtpHistorySendAction = chooseSmtpAction(activeSmtpHistorySendActions, preferredSmtpPluginId);
  const smtpHistorySendActionEnabled = activeSmtpHistorySendActions.length > 0;
  const activeContributionBadges = [
    ...pluginContributions.publishActions.map((action) => t("plugin.badge.publish", { label: action.label })),
    ...pluginContributions.templates.map((template) => t("plugin.badge.template", { label: template.label })),
    ...pluginContributions.policyProfiles.map((profile) => t("plugin.badge.policy", { label: profile.label })),
    ...pluginContributions.brandingPresets.map((preset) => t("plugin.badge.branding", { label: preset.label }))
  ];
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
      setSmtpSettingsById({});
      setSmtpSettingsForms(defaultSmtpSettingsForms);
      return;
    }

    const [nextPlugins, nextContributions, nextSmtpSettingsList] = await Promise.all([
      pluginApi.list(),
      pluginApi.getContributions(),
      Promise.all(SMTP_DELIVERY_PLUGIN_IDS.map((pluginId) => pluginApi.getSettings(pluginId)))
    ]);
    const nextSmtpSettingsById = Object.fromEntries(
      nextSmtpSettingsList.map((settings) => [(settings as SmtpSettingsView).pluginId, settings as SmtpSettingsView])
    ) as Partial<Record<SmtpDeliveryPluginId, SmtpSettingsView>>;
    setPlugins(nextPlugins);
    setPluginContributions(nextContributions);
    setSmtpSettingsById(nextSmtpSettingsById);
    setSmtpSettingsForms(smtpSettingsMapToForms(nextSmtpSettingsById));
  }

  function handleLocaleChange(nextValue: string): void {
    const nextLocale = resolveLocale(nextValue);
    const previousLocale = locale;
    setLocale(nextLocale);
    setViewerLocale((current) => (current === previousLocale ? nextLocale : current));
    window.secureDoc?.savePreferences({ language: nextLocale }).catch(() => {
      setError(translate(nextLocale, "main.preferencesSaveFailed"));
    });
  }

  async function handlePluginToggle(plugin: PluginDescriptor, enabled: boolean): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi) {
      setError(t("plugins.bridgeUnavailable"));
      return;
    }

    setPluginBusyId(plugin.id);
    setError("");
    try {
      const nextPlugins = await pluginApi.setEnabled(plugin.id, enabled);
      const nextContributions = await pluginApi.getContributions();
      setPlugins(nextPlugins);
      setPluginContributions(nextContributions);
      if (isSmtpDeliveryPluginId(plugin.id) && !enabled) {
        if (pendingEmailPackage?.pluginId === plugin.id) {
          setEmailDialogOpen(false);
          setPendingEmailPackage(null);
        }
        if (preferredSmtpPluginId === plugin.id) {
          const fallback = getActiveSmtpSendActions(nextContributions)[0]?.pluginId ?? GMAIL_SMTP_PLUGIN_ID;
          setPreferredSmtpPluginId(fallback);
        }
        setSmtpStatusById((current) => ({ ...current, [plugin.id]: "" }));
        setSmtpErrorById((current) => ({ ...current, [plugin.id]: "" }));
      } else if (isSmtpDeliveryPluginId(plugin.id) && enabled) {
        setPreferredSmtpPluginId(plugin.id);
      }
      setStatus(t("plugins.statusChanged", {
        plugin: pluginDisplayName(plugin, locale),
        state: enabled ? t("plugins.enabled") : t("plugins.disabled")
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("plugins.changeFailed"));
    } finally {
      setPluginBusyId(null);
    }
  }

  useEffect(() => {
    window.secureDoc?.getPreferences().then((preferences) => {
      const nextLocale = resolveLocale(preferences.language);
      setLocale(nextLocale);
      setViewerLocale(nextLocale);
    }).catch(() => undefined);
    window.secureDoc?.getHistory().then(setHistory).catch(() => setHistory([]));
    refreshPlugins().catch(() => {
      setPlugins([]);
      setPluginContributions(EMPTY_PLUGIN_CONTRIBUTIONS);
      setSmtpSettingsById({});
      setSmtpSettingsForms(defaultSmtpSettingsForms);
    });
  }, []);

  useEffect(() => {
    const presetKeys = new Set(activeBrandingPresets.map(brandingPresetKey));
    if (selectedBrandingPresetKey && !presetKeys.has(selectedBrandingPresetKey)) {
      setSelectedBrandingPresetKey(activeBrandingPresets[0] ? brandingPresetKey(activeBrandingPresets[0]) : "");
    } else if (!selectedBrandingPresetKey && activeBrandingPresets.length > 0) {
      setSelectedBrandingPresetKey(brandingPresetKey(activeBrandingPresets[0]));
    }
    if (activeBrandingPresetKey && !presetKeys.has(activeBrandingPresetKey)) {
      setActiveBrandingPresetKey("");
    }
  }, [activeBrandingPresetKey, activeBrandingPresets, selectedBrandingPresetKey]);

  useEffect(() => {
    const templateIds = new Set(availableDocumentTemplates.map((template) => template.id));
    if (selectedTemplateId && !templateIds.has(selectedTemplateId)) {
      setSelectedTemplateId(DEFAULT_DOCUMENT_TEMPLATE_ID);
    }
    if (pendingTemplateOverwriteId && !templateIds.has(pendingTemplateOverwriteId)) {
      setPendingTemplateOverwriteId("");
    }
    if (activeTemplateId && !templateIds.has(activeTemplateId)) {
      setActiveTemplateId(DEFAULT_DOCUMENT_TEMPLATE_ID);
      setSyncPresetWithMetadata(false);
    }
  }, [activeTemplateId, availableDocumentTemplates, pendingTemplateOverwriteId, selectedTemplateId]);

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
    if (selectedTemplateId === activeTemplateId && syncPresetWithMetadata) {
      return false;
    }

    const currentHtml = currentEditorHtmlSnapshot();
    return stripHtml(currentHtml).length > 0 && currentHtml !== sanitizeHtml(nextHtml);
  }

  function applyTemplate(template: DocumentTemplate, confirmOverwrite = true): void {
    const nextMetadata = coerceMetadataState(applyDocumentTemplateDefaults(metadata, template), metadata.docType);
    const nextHtml = buildTemplateHtml(template, nextMetadata);

    if (
      confirmOverwrite &&
      shouldConfirmTemplateOverwrite(nextHtml)
    ) {
      setPendingTemplateOverwriteId(template.id);
      setStatus("");
      setError("");
      return;
    }

    setMetadata(nextMetadata);
    setSelectedTemplateId(template.id);
    setActiveTemplateId(template.id);
    setPendingTemplateOverwriteId("");
    setSyncPresetWithMetadata(true);
    replaceEditorHtml(nextHtml);
    setStatus(t("template.appliedStatus", { template: templateDisplayName(template, locale) }));
    setError("");
  }

  function handleApplySelectedTemplate(): void {
    applyTemplate(selectedTemplate);
  }

  function closeTemplateOverwriteDialog(): void {
    setPendingTemplateOverwriteId("");
  }

  function confirmTemplateOverwrite(): void {
    if (pendingTemplateOverwrite) {
      applyTemplate(pendingTemplateOverwrite, false);
    }
  }

  function applyBrandingPreset(preset: ResolvedPluginBrandingPresetContribution | null): void {
    if (!preset) {
      setActiveBrandingPresetKey("");
      setStatus(t("branding.clearStatus"));
      setError("");
      return;
    }

    const nextMetadata = {
      ...metadata,
      issuer: preset.issuer ?? metadata.issuer,
      watermarkText: preset.watermarkText ?? metadata.watermarkText
    };

    setMetadata(nextMetadata);
    setSelectedBrandingPresetKey(brandingPresetKey(preset));
    setActiveBrandingPresetKey(brandingPresetKey(preset));
    if (syncPresetWithMetadata && preset.issuer !== undefined) {
      replaceEditorHtml(buildTemplateHtml(activeTemplate, nextMetadata));
    }
    const effectItems = brandingPresetEffectItems(preset, locale);
    setStatus(
      effectItems.length > 0
        ? t("branding.appliedWithItemsStatus", { preset: preset.label, items: effectItems.join(", ") })
        : t("branding.appliedStatus", { preset: preset.label })
    );
    setError("");
  }

  function handleApplySelectedBrandingPreset(): void {
    applyBrandingPreset(selectedBrandingPreset);
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
    updateMetadata("docType", docType);

    const matchingTemplate = availableDocumentTemplates.find((template) => template.defaultMetadata.docType === docType);
    if (matchingTemplate) {
      setSelectedTemplateId(matchingTemplate.id);
    }

    setStatus(
      matchingTemplate
        ? t("document.typeClassifiedWithTemplate", {
            docType: documentTypeLabel(docType, locale),
            template: templateDisplayName(matchingTemplate, locale)
          })
        : t("document.typeClassified", { docType: documentTypeLabel(docType, locale) })
    );
    setError("");
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
    const nextHref = window.prompt(t("editor.linkPrompt"), typeof currentHref === "string" ? currentHref : "");
    if (nextHref === null) {
      return;
    }

    const normalizedHref = normalizeLinkHref(nextHref);
    if (normalizedHref === null) {
      setError(t("editor.linkError"));
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
    setStatus(t("publish.generatedPin"));
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

  function updateSmtpSettingsForm<K extends keyof SmtpSettingsForm>(
    pluginId: SmtpDeliveryPluginId,
    key: K,
    value: SmtpSettingsForm[K]
  ): void {
    setSmtpSettingsForms((current) => ({
      ...current,
      [pluginId]: {
        ...current[pluginId],
        [key]: value
      }
    }));
  }

  async function saveSmtpSettingsFromForm(pluginId: SmtpDeliveryPluginId): Promise<SmtpSettingsView> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi) {
      throw new Error(t("plugins.bridgeUnavailable"));
    }

    const smtpSettingsForm = smtpSettingsForms[pluginId];
    const request: SaveSmtpSettingsRequest = {
      host: smtpSettingsForm.host,
      port: Number(smtpSettingsForm.port),
      senderEmail: smtpSettingsForm.senderEmail,
      username: smtpSettingsForm.username || undefined,
      secure: smtpSettingsForm.secure,
      requireTLS: smtpSettingsForm.requireTLS
    };
    const password = smtpSettingsForm.password;
    if (password.trim()) {
      request.password = password;
      if (pluginId === GMAIL_SMTP_PLUGIN_ID) {
        request.appPassword = password;
      }
      setSmtpSettingsForms((current) => ({
        ...current,
        [pluginId]: {
          ...current[pluginId],
          password: ""
        }
      }));
    }

    const nextSettings = (await pluginApi.saveSettings(pluginId, request)) as SmtpSettingsView;
    setSmtpSettingsById((current) => ({ ...current, [pluginId]: nextSettings }));
    setSmtpSettingsForms((current) => ({ ...current, [pluginId]: smtpSettingsToForm(nextSettings) }));
    return nextSettings;
  }

  async function handleSaveSmtpSettings(pluginId: SmtpDeliveryPluginId): Promise<void> {
    setSmtpBusyId(pluginId);
    setSmtpStatusById((current) => ({ ...current, [pluginId]: "" }));
    setSmtpErrorById((current) => ({ ...current, [pluginId]: "" }));
    const setSmtpStatus = (message: string) => setSmtpStatusById((current) => ({ ...current, [pluginId]: message }));
    const setSmtpError = (message: string) => setSmtpErrorById((current) => ({ ...current, [pluginId]: message }));
    const setSmtpBusy = (busy: boolean) => setSmtpBusyId(busy ? pluginId : null);
    try {
      await saveSmtpSettingsFromForm(pluginId);
      setSmtpStatus(t("smtp.savedStatus"));
    } catch (caught) {
      setSmtpError(caught instanceof Error ? caught.message : t("smtp.saveFailed"));
    } finally {
      setSmtpBusy(false);
    }
  }

  async function handleClearSmtpSettings(pluginId: SmtpDeliveryPluginId): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    const setSmtpStatus = (message: string) => setSmtpStatusById((current) => ({ ...current, [pluginId]: message }));
    const setSmtpError = (message: string) => setSmtpErrorById((current) => ({ ...current, [pluginId]: message }));
    const setSmtpBusy = (busy: boolean) => setSmtpBusyId(busy ? pluginId : null);
    if (!pluginApi) {
      setSmtpError(t("plugins.bridgeUnavailable"));
      return;
    }

    setSmtpBusy(true);
    setSmtpStatus("");
    setSmtpError("");
    try {
      const nextSettings = (await pluginApi.clearSettings(pluginId)) as SmtpSettingsView;
      setSmtpSettingsById((current) => ({ ...current, [pluginId]: nextSettings }));
      setSmtpSettingsForms((current) => ({ ...current, [pluginId]: smtpSettingsToForm(nextSettings) }));
      setSmtpStatus(t("smtp.clearedStatus"));
    } catch (caught) {
      setSmtpError(caught instanceof Error ? caught.message : t("smtp.clearFailed"));
    } finally {
      setSmtpBusy(false);
    }
  }

  async function handleTestSmtpSettings(pluginId: SmtpDeliveryPluginId): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    const setSmtpStatus = (message: string) => setSmtpStatusById((current) => ({ ...current, [pluginId]: message }));
    const setSmtpError = (message: string) => setSmtpErrorById((current) => ({ ...current, [pluginId]: message }));
    const setSmtpBusy = (busy: boolean) => setSmtpBusyId(busy ? pluginId : null);
    if (!pluginApi) {
      setSmtpError(t("plugins.bridgeUnavailable"));
      return;
    }

    setSmtpBusy(true);
    setSmtpStatus("");
    setSmtpError("");
    try {
      await saveSmtpSettingsFromForm(pluginId);
      await pluginApi.runAction(pluginId, smtpTestActionId(pluginId));
      setSmtpStatus(t("smtp.connectionOk"));
    } catch (caught) {
      setSmtpError(caught instanceof Error ? caught.message : t("smtp.connectionFailed"));
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

  function updatePendingEmailChannel(pluginId: SmtpDeliveryPluginId): void {
    if (!pendingEmailPackage) {
      return;
    }

    const actions = pendingEmailPackage.source === "history" ? activeSmtpHistorySendActions : activeSmtpSendActions;
    const nextAction = actions.find((action) => action.pluginId === pluginId);
    if (!nextAction) {
      return;
    }

    setPreferredSmtpPluginId(pluginId);
    setPendingEmailPackage({
      ...pendingEmailPackage,
      pluginId: nextAction.pluginId,
      actionId: nextAction.actionId
    });
  }

  function closeEmailDialog(): void {
    if (!emailBusy) {
      setEmailDialogOpen(false);
    }
  }

  function openHistoryEmailDialog(item: PublishHistoryRecord): void {
    if (!activeSmtpHistorySendAction) {
      setError(t("history.emailRequiresPlugin"));
      return;
    }

    const attachmentFileName = fileNameFromPath(item.outputPath);
    setPreferredSmtpPluginId(activeSmtpHistorySendAction.pluginId);
    setPendingEmailPackage({
      source: "history",
      pluginId: activeSmtpHistorySendAction.pluginId,
      actionId: activeSmtpHistorySendAction.actionId,
      documentId: item.documentId,
      attachmentFileName,
      filePath: item.outputPath
    });
    setEmailSendForm({
      recipientEmail: "",
      subject: t("email.subjectPrefix", { title: item.title }),
      attachmentFileName
    });
    setStatus("");
    setError("");
    setEmailDialogOpen(true);
  }

  function auditStatusLabel(report: PackageIntegrityReport): string {
    if (report.status === "verified") {
      return t("history.auditVerified");
    }
    if (report.status === "missing") {
      return t("history.auditMissing");
    }
    return t("history.auditTampered");
  }

  async function handleAuditIntegrityReport(item: PublishHistoryRecord): Promise<void> {
    const desktopApi = window.secureDoc;
    if (!desktopApi) {
      setError(t("history.auditUnavailable"));
      return;
    }

    setAuditBusyDocumentId(item.documentId);
    setStatus(t("history.auditRunning"));
    setError("");
    try {
      const report = await desktopApi.verifyPackageIntegrity({
        documentId: item.documentId,
        outputPath: item.outputPath,
        language: locale
      });
      setAuditReport(report);
      setStatus(report.message);
    } catch (caught) {
      setAuditReport(null);
      setError(caught instanceof Error ? caught.message : t("history.auditFailed"));
      setStatus("");
    } finally {
      setAuditBusyDocumentId(null);
    }
  }

  async function handleSendEmail(): Promise<void> {
    const pluginApi = window.secureDoc?.plugins;
    if (!pluginApi || !pendingEmailPackage) {
      setError(t("email.unavailable"));
      return;
    }

    let recipientEmail: string;
    let subject: string;
    let attachmentFileName: string;
    try {
      recipientEmail = normalizeEmailAddressInput(emailSendForm.recipientEmail, t("email.recipient"), locale);
      subject = emailSendForm.subject.normalize("NFKC").trim();
      attachmentFileName = emailSendForm.attachmentFileName.normalize("NFKC").trim();
      if (!subject) {
        throw new Error(t("email.subjectRequired"));
      }
      if (!attachmentFileName.endsWith(".html")) {
        throw new Error(t("email.attachmentHtmlRequired"));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("email.infoInvalid"));
      setStatus("");
      return;
    }

    setEmailBusy(true);
    setError("");
    setStatus(t("email.sendingStatus"));
    try {
      const result = (await pluginApi.runAction(
        pendingEmailPackage.pluginId,
        pendingEmailPackage.actionId,
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
      setStatus(t("email.sent", { suffix: messageSuffix }));
      setEmailDialogOpen(false);
      setPendingEmailPackage(null);
      setEmailSendForm(defaultEmailSendForm);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("email.failed"));
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
    setStatus(t("publish.copiedPin"));
    setError("");
  }

  async function handlePublish(): Promise<void> {
    setBusy(true);
    setError("");
    setStatus(t("publish.validating"));

    try {
      if (!window.secureDoc) {
        throw new Error(t("publish.desktopBridgeUnavailable"));
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
        privateMeta: compactPrivateMeta(publishMetadata, activeBrandingPreset)
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
        iterations,
        viewerLocale
      });

      const html = buildSecureHtmlDocument(securePackage);
      const suggestedFileName = `${securePackage.doc.id}-${safeFileNamePart(publishMetadata.title)}.html`;
      const saveResult = await window.secureDoc.savePackage({
        suggestedFileName,
        html,
        language: locale,
        history: {
          documentId: securePackage.doc.id,
          title: securePackage.doc.title,
          issuer: securePackage.doc.issuer,
          issuedAt: securePackage.doc.issuedAt,
          displayExpiresAt: securePackage.doc.displayExpiresAt,
          kdf: "PBKDF2-HMAC-SHA-256",
          iterations,
          contentAlg: "AES-256-GCM",
          createdBy: publishMetadata.createdBy.trim() || "admin",
          viewerLanguage: viewerLocale
        }
      });

      if (saveResult.canceled) {
        setStatus(t("publish.saveCanceled"));
        return;
      }

      setStatus(t("publish.completed", { path: saveResult.filePath ?? "" }));
      setPublishDialogOpen(false);
      setPin("");
      setPinConfirm("");
      if (activeSmtpSendAction && saveResult.filePath) {
        setPreferredSmtpPluginId(activeSmtpSendAction.pluginId);
        setPendingEmailPackage({
          source: "publish",
          pluginId: activeSmtpSendAction.pluginId,
          actionId: activeSmtpSendAction.actionId,
          documentId: securePackage.doc.id,
          attachmentFileName: suggestedFileName,
          filePath: saveResult.filePath
        });
        setEmailSendForm({
          recipientEmail: "",
          subject: t("email.subjectPrefix", { title: securePackage.doc.title }),
          attachmentFileName: suggestedFileName
        });
        setEmailDialogOpen(true);
      }
      const nextHistory = await window.secureDoc.getHistory();
      setHistory(nextHistory);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("publish.failed"));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label={t("app.adminMenu")}>
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
          <span className="group-label">{t("nav.distributionTargets")}</span>
          <span className="nav-note">macOS universal</span>
          <span className="nav-note">Windows x64</span>
        </nav>
        <div className="sidebar-utility">
          <label className="language-switcher">
            {t("app.language")}
            <select value={locale} onChange={(event) => handleLocaleChange(event.target.value)}>
              {SUPPORTED_LOCALES.map((item) => (
                <option key={item} value={item}>
                  {translate(item, `locale.${item}` as TranslationKey)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </aside>

      <main className="main-column">
        <header className="topbar">
          <div>
            <p className="eyebrow">WebCrypto Offline Secure Document</p>
            <h1>Secure Doc Admin</h1>
          </div>
          <div className="platforms" aria-label={t("app.statusLabel")}>
            <span>{t("app.offlineStatus")}</span>
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
            <h2 id="metadata-heading">{t("section.metadata")}</h2>
          </div>
          <div className="form-grid document-meta-grid">
            <label className="field-type">
              {t("field.docType")}
              <select value={metadata.docType} onChange={(event) => handleDocumentTypeChange(event.target.value as DocumentType)}>
                {documentTypes.map((docType) => (
                  <option key={docType} value={docType}>
                    {documentTypeLabel(docType, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-title">
              {t("field.title")}
              <input value={metadata.title} onChange={(event) => updateMetadata("title", event.target.value)} />
            </label>
            <label className="field-issuer">
              {t("field.issuer")}
              <input value={metadata.issuer} onChange={(event) => updateMetadata("issuer", event.target.value)} />
            </label>
            <label className="field-recipient">
              {t("field.recipient")}
              <input value={metadata.recipientName} onChange={(event) => updateMetadata("recipientName", event.target.value)} />
            </label>
            <label className="field-number">
              {t("field.documentNumber")}
              <input value={metadata.documentNumber} onChange={(event) => updateMetadata("documentNumber", event.target.value)} />
            </label>
            <label className="field-date">
              {t("field.expiresAt")}
              <input
                type="date"
                value={metadata.displayExpiresAt}
                onChange={(event) => updateMetadata("displayExpiresAt", event.target.value)}
              />
            </label>
            <label className="field-watermark">
              {t("field.watermark")}
              <input value={metadata.watermarkText} onChange={(event) => updateMetadata("watermarkText", event.target.value)} />
            </label>
          </div>
          <div className="template-picker">
            <label>
              {t("field.template")}
              <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)}>
                {availableDocumentTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {templateOptionLabel(template, locale)}
                  </option>
                ))}
              </select>
            </label>
            <div className="template-summary">
              <strong>{templateDisplayName(selectedTemplate, locale)}</strong>
              <span>{templateDisplayDescription(selectedTemplate, locale)}</span>
              <div className="template-state-row" aria-label={t("template.stateLabel")}>
                <span className={["template-state-badge", templateBodyState].join(" ")}>
                  {templateBodyStateLabel}
                </span>
                <span className="template-state-note">
                  {templateDocTypeMatches
                    ? t("template.typeMatches")
                    : t("template.typeName", {
                        type: selectedTemplateDocType && isDocumentType(selectedTemplateDocType)
                          ? documentTypeLabel(selectedTemplateDocType, locale)
                          : t("template.noType")
                      })}
                </span>
              </div>
            </div>
            <button
              type="button"
              className={["template-apply-button", templateApplyPending ? "pending" : ""].filter(Boolean).join(" ")}
              onClick={handleApplySelectedTemplate}
            >
              {t("template.apply")}
            </button>
          </div>
          {activeBrandingPresets.length > 0 && (
            <div className="branding-picker">
              <label>
                {t("field.branding")}
                <select
                  value={selectedBrandingPresetKey}
                  onChange={(event) => setSelectedBrandingPresetKey(event.target.value)}
                >
                  {activeBrandingPresets.map((preset) => (
                    <option key={brandingPresetKey(preset)} value={brandingPresetKey(preset)}>
                      {preset.pluginName} · {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="branding-summary">
                {selectedBrandingPreset ? (
                  <>
                    <strong>{selectedBrandingPreset.label}</strong>
                    <span>{selectedBrandingPreset.description}</span>
                    <div className="branding-state-row" aria-label={t("branding.stateLabel")}>
                      <span className={["branding-state-badge", brandingBodyState].join(" ")}>
                        {brandingBodyStateLabel}
                      </span>
                      <span className="branding-state-note">
                        {selectedBrandingEffectItems.length > 0
                          ? selectedBrandingEffectItems.join(" · ")
                          : t("branding.noDefaults")}
                      </span>
                    </div>
                    {selectedBrandingPreset.viewerTheme && (
                      <div className="branding-swatch-row" aria-hidden="true">
                        {Object.entries(compactViewerTheme(selectedBrandingPreset.viewerTheme) ?? {}).map(([key, value]) => (
                          <span className="branding-swatch" key={key} style={{ backgroundColor: String(value) }} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <span>{t("branding.noActive")}</span>
                )}
              </div>
              <button
                type="button"
                className={["branding-apply-button", brandingApplyPending ? "pending" : ""].filter(Boolean).join(" ")}
                onClick={handleApplySelectedBrandingPreset}
                disabled={!selectedBrandingPreset}
              >
                {selectedBrandingMetadataChanged ? t("branding.reapply") : t("branding.apply")}
              </button>
            </div>
          )}
          <details className="admin-meta-details">
            <summary>{t("field.adminInfo")}</summary>
            <div className="admin-meta-grid">
              <label className="field-description">
                {t("field.description")}
                <input value={metadata.description} onChange={(event) => updateMetadata("description", event.target.value)} />
              </label>
              <label className="field-created">
                {t("field.createdBy")}
                <input value={metadata.createdBy} onChange={(event) => updateMetadata("createdBy", event.target.value)} />
              </label>
            </div>
          </details>
        </section>

        <section
          className={["panel editor-panel", activeDocumentBrandingStyle ? "document-branded" : ""].filter(Boolean).join(" ")}
          aria-labelledby="editor-heading"
          style={activeDocumentBrandingStyle}
        >
          <div className="section-heading">
            <h2 id="editor-heading">{t("section.editor")}</h2>
            <div className="mode-toggle editor-mode-toggle" aria-label={t("editor.modeLabel")}>
                <button
                  type="button"
                  className={editorMode === "visual" ? "active" : ""}
                  onClick={() => switchEditorMode("visual")}
                >
                  {t("editor.editMode")}
                </button>
                <button
                  type="button"
                  className={editorMode === "html" ? "active" : ""}
                  onClick={() => switchEditorMode("html")}
                >
                  {t("editor.htmlMode")}
                </button>
              </div>
          </div>
          <div className="editor-toolbar-row">
            <div className="editor-actions">
            <div className="toolbar" aria-label={t("editor.toolbarLabel")}>
              <div className="toolbar-section">
                <ToolbarButton
                  label="↶"
                  title={t("editor.undo")}
                  disabled={!canRunEditorCommand(() => editor!.can().undo())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().undo().run() ?? false)}
                />
                <ToolbarButton
                  label="↷"
                  title={t("editor.redo")}
                  disabled={!canRunEditorCommand(() => editor!.can().redo())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().redo().run() ?? false)}
                />
              </div>
              <div className="toolbar-section">
                <select
                  className="block-style-select"
                  title={t("editor.blockStyle")}
                  aria-label={t("editor.blockStyle")}
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
                  title={t("editor.alignLeft")}
                  format="align-left"
                  active={currentTextAlign() === "left"}
                  disabled={!canSetTextAlign()}
                  onClick={() => setTextAlign("left")}
                />
                <ToolbarButton
                  label=""
                  title={t("editor.alignCenter")}
                  format="align-center"
                  active={currentTextAlign() === "center"}
                  disabled={!canSetTextAlign()}
                  onClick={() => setTextAlign("center")}
                />
                <ToolbarButton
                  label=""
                  title={t("editor.alignRight")}
                  format="align-right"
                  active={currentTextAlign() === "right"}
                  disabled={!canSetTextAlign()}
                  onClick={() => setTextAlign("right")}
                />
                <ToolbarButton
                  label=""
                  title={t("editor.alignJustify")}
                  format="align-justify"
                  active={currentTextAlign() === "justify"}
                  disabled={!canSetTextAlign()}
                  onClick={() => setTextAlign("justify")}
                />
              </div>
              <div className="toolbar-section">
                <ToolbarButton
                  label="B"
                  title={t("editor.bold")}
                  active={isEditorActive("bold")}
                  format="bold"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleBold().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleBold().run() ?? false)}
                />
                <ToolbarButton
                  label="I"
                  title={t("editor.italic")}
                  active={isEditorActive("italic")}
                  format="italic"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleItalic().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleItalic().run() ?? false)}
                />
                <ToolbarButton
                  label="U"
                  title={t("editor.underline")}
                  active={isEditorActive("underline")}
                  format="underline"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleUnderline().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleUnderline().run() ?? false)}
                />
                <ToolbarButton
                  label="S"
                  title={t("editor.strike")}
                  active={isEditorActive("strike")}
                  format="strike"
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleStrike().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleStrike().run() ?? false)}
                />
                <ToolbarButton
                  label="&lt;/&gt;"
                  title={t("editor.inlineCode")}
                  active={isEditorActive("code")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleCode().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleCode().run() ?? false)}
                />
                <ToolbarButton
                  label="Tx"
                  title={t("editor.clearFormatting")}
                  disabled={!editor}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().unsetAllMarks().clearNodes().run() ?? false)}
                />
              </div>
              <div className="toolbar-section">
                <ToolbarButton
                  label="☷"
                  title={t("editor.bulletList")}
                  active={isEditorActive("bulletList")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleBulletList().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleBulletList().run() ?? false)}
                />
                <ToolbarButton
                  label="1."
                  title={t("editor.orderedList")}
                  active={isEditorActive("orderedList")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleOrderedList().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleOrderedList().run() ?? false)}
                />
                <ToolbarButton
                  label="❝"
                  title={t("editor.blockquote")}
                  active={isEditorActive("blockquote")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleBlockquote().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleBlockquote().run() ?? false)}
                />
                <ToolbarButton
                  label="{ }"
                  title={t("editor.codeBlock")}
                  active={isEditorActive("codeBlock")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().toggleCodeBlock().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().toggleCodeBlock().run() ?? false)}
                />
                <ToolbarButton
                  label="―"
                  title={t("editor.horizontalRule")}
                  disabled={!canRunEditorCommand(() => editor!.can().chain().focus().setHorizontalRule().run())}
                  onClick={() => runEditorCommand(() => editor?.chain().focus().setHorizontalRule().run() ?? false)}
                />
              </div>
              <div className="toolbar-section">
                <ToolbarButton
                  label="↗"
                  title={t("editor.link")}
                  active={isEditorActive("link")}
                  disabled={!editor}
                  onClick={handleSetLink}
                />
                <ToolbarButton
                  label="↛"
                  title={t("editor.unlink")}
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
            <h3>{t("editor.preview")}</h3>
            <div className="preview" dangerouslySetInnerHTML={{ __html: sanitizedPreview }} />
          </div>
          <div className="editor-publish-row">
            <button type="button" className="primary" onClick={openPublishDialog}>
              {t("action.createHtml")}
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
            <h2 id="security-heading">{t("section.security")}</h2>
          </div>
          <div className="security-policy-grid">
            <div className="security-policy-item">
              <strong>{t("security.pinTitle")}</strong>
              <span>{t("security.pinText")}</span>
            </div>
            <div className="security-policy-item">
              <strong>{t("security.cryptoTitle")}</strong>
              <span>{t("security.cryptoText")}</span>
            </div>
            <div className="security-policy-item">
              <strong>{t("security.viewerTitle")}</strong>
              <span>{t("security.viewerText")}</span>
            </div>
            <div className="security-policy-item">
              <strong>{t("security.noStoreTitle")}</strong>
              <span>{t("security.noStoreText")}</span>
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
            <h2 id="history-heading">{t("section.history")}</h2>
          </div>
          <div className="history-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("history.columnDocument")}</th>
                  <th>{t("history.columnIssuer")}</th>
                  <th>{t("history.columnIterations")}</th>
                  <th>SHA-256</th>
                  <th>{t("history.columnFile")}</th>
                  <th>{t("history.columnEmail")}</th>
                  <th>{t("history.columnAudit")}</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={7}>{t("history.empty")}</td>
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
                          {t("action.view")}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => openHistoryEmailDialog(item)}
                          disabled={!smtpHistorySendActionEnabled}
                        >
                          {t("action.send")}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => void handleAuditIntegrityReport(item)}
                          disabled={auditBusyDocumentId === item.documentId}
                        >
                          {auditBusyDocumentId === item.documentId ? t("action.verifying") : t("action.verify")}
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
                <strong>{t("history.auditReport")}</strong>
                <span>{auditStatusLabel(auditReport)}</span>
              </div>
              <dl>
                <div>
                  <dt>{t("history.auditDocument")}</dt>
                  <dd>{auditReport.title}</dd>
                </div>
                <div>
                  <dt>{t("history.auditDocumentId")}</dt>
                  <dd>{auditReport.documentId}</dd>
                </div>
                <div>
                  <dt>{t("history.auditCheckedAt")}</dt>
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
            <h2 id="plugins-heading">{t("section.plugins")}</h2>
          </div>
          <p className="security-note">
            {t("plugins.coreNote")}
          </p>
          <div className="plugin-list">
            {plugins.length === 0 ? (
              <div className="plugin-empty">{t("plugins.empty")}</div>
            ) : (
              plugins.map((plugin) => {
                const contributionLabels = pluginContributionLabels(plugin, locale);
                const featureDescriptions = pluginFeatureDescriptions(plugin, locale);
                const displayName = pluginDisplayName(plugin, locale);
                const smtpPluginId = isSmtpDeliveryPluginId(plugin.id) ? plugin.id : null;
                const smtpSettings = smtpPluginId ? smtpSettingsById[smtpPluginId] : undefined;
                const smtpSettingsForm = smtpPluginId ? smtpSettingsForms[smtpPluginId] : defaultSmtpSettingsForms[GMAIL_SMTP_PLUGIN_ID];
                const smtpBusy = smtpPluginId ? smtpBusyId === smtpPluginId : false;
                const smtpStatus = smtpPluginId ? smtpStatusById[smtpPluginId] ?? "" : "";
                const smtpError = smtpPluginId ? smtpErrorById[smtpPluginId] ?? "" : "";
                return (
                  <article className="plugin-item" key={plugin.id}>
                    <div className="plugin-item-main">
                      <div>
                        <div className="plugin-title-row">
                          <h3>{displayName}</h3>
                        </div>
                        <p className="plugin-description">{pluginDisplayDescription(plugin, locale)}</p>
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
                        aria-label={t("plugins.toggleAria", {
                          plugin: displayName,
                          action: plugin.enabled ? t("plugins.disable") : t("plugins.enable")
                        })}
                        disabled={pluginBusyId === plugin.id}
                        onClick={() => void handlePluginToggle(plugin, !plugin.enabled)}
                      >
                        <span className="plugin-toggle-track" aria-hidden="true">
                          <span className="plugin-toggle-thumb" />
                        </span>
                        <span className="plugin-toggle-text">{plugin.enabled ? t("plugins.enabled") : t("plugins.disabled")}</span>
                      </button>
                    </div>
                    {featureDescriptions.length > 0 && (
                      <div className="plugin-feature-list" aria-label={t("plugins.featuresLabel", { plugin: displayName })}>
                        <strong>{t("plugins.whenEnabled")}</strong>
                        <ul>
                          {featureDescriptions.map((description) => (
                            <li key={description}>{description}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="plugin-badge-grid" aria-label={t("plugins.attributesLabel", { plugin: displayName })}>
                      <div className="plugin-badge-section">
                        <strong className="plugin-badge-heading">{t("plugins.category")}</strong>
                        <div className="plugin-chip-row">
                          <span className="plugin-chip category">{pluginCategoryLabel(plugin.category, locale)}</span>
                        </div>
                      </div>
                      <div className="plugin-badge-section">
                        <strong className="plugin-badge-heading">{t("plugins.permissions")}</strong>
                        <div className="plugin-chip-row">
                          {plugin.permissions.length === 0 ? (
                            <span className="plugin-chip muted">{t("plugins.noPermissions")}</span>
                          ) : (
                            plugin.permissions.map((permission) => (
                              <span className="plugin-chip" key={permission}>
                                {pluginPermissionLabel(permission, locale)}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                      <div className="plugin-badge-section">
                        <strong className="plugin-badge-heading">{t("plugins.contributions")}</strong>
                        <div className="plugin-chip-row">
                          {contributionLabels.length === 0 ? (
                            <span className="plugin-chip muted">{t("plugins.noContributions")}</span>
                          ) : (
                            contributionLabels.map((label) => (
                              <span className="plugin-chip contribution" key={label}>
                                {label}
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                    {smtpPluginId && plugin.enabled && (
                      <div className="smtp-settings-panel">
                        <div className="smtp-settings-heading">
                          <strong>{smtpPluginId === GMAIL_SMTP_PLUGIN_ID ? t("smtp.settingsTitle.gmail") : t("smtp.settingsTitle.generic")}</strong>
                          <span className={smtpSecretSaved(smtpSettings) ? "smtp-secret-badge saved" : "smtp-secret-badge"}>
                            {smtpSecretSaved(smtpSettings) ? t("smtp.secretSaved") : t("smtp.secretRequired")}
                          </span>
                        </div>
                        <div className="smtp-settings-grid">
                          <label className="smtp-field smtp-field-host">
                            {t("smtp.host")}
                            <input
                              value={smtpSettingsForm.host}
                              onChange={(event) => updateSmtpSettingsForm(smtpPluginId, "host", event.target.value)}
                              placeholder="smtp.gmail.com"
                            />
                          </label>
                          <label className="smtp-field smtp-field-port">
                            {t("smtp.port")}
                            <input
                              value={smtpSettingsForm.port}
                              onChange={(event) => updateSmtpSettingsForm(smtpPluginId, "port", event.target.value)}
                              inputMode="numeric"
                              placeholder="587"
                            />
                          </label>
                          <label className="smtp-field smtp-field-account">
                            {smtpPluginId === GMAIL_SMTP_PLUGIN_ID ? t("smtp.gmailAccount") : t("smtp.senderEmail")}
                            <input
                              value={smtpSettingsForm.senderEmail}
                              onChange={(event) => updateSmtpSettingsForm(smtpPluginId, "senderEmail", event.target.value)}
                              placeholder="user@gmail.com"
                              autoComplete="username"
                            />
                          </label>
                          {smtpPluginId === GENERIC_SMTP_PLUGIN_ID && (
                            <label className="smtp-field">
                              {t("smtp.username")}
                              <input
                                value={smtpSettingsForm.username}
                                onChange={(event) => updateSmtpSettingsForm(smtpPluginId, "username", event.target.value)}
                                placeholder={t("smtp.usernamePlaceholder")}
                                autoComplete="username"
                              />
                            </label>
                          )}
                          {smtpPluginId === GENERIC_SMTP_PLUGIN_ID && (
                            <div className="smtp-field smtp-option-field">
                              {t("smtp.security")}
                              <label className="smtp-option-row">
                                <input
                                  type="checkbox"
                                  checked={smtpSettingsForm.requireTLS}
                                  onChange={(event) => updateSmtpSettingsForm(smtpPluginId, "requireTLS", event.target.checked)}
                                />
                                {t("smtp.requireTls")}
                              </label>
                              <label className="smtp-option-row">
                                <input
                                  type="checkbox"
                                  checked={smtpSettingsForm.secure}
                                  onChange={(event) => updateSmtpSettingsForm(smtpPluginId, "secure", event.target.checked)}
                                />
                                {t("smtp.implicitTls")}
                              </label>
                            </div>
                          )}
                          <label className="smtp-field smtp-field-secret">
                            {smtpSecretSaved(smtpSettings) ? t("smtp.replacePassword") : t("smtp.password")}
                            <input
                              value={smtpSettingsForm.password}
                              onChange={(event) => updateSmtpSettingsForm(smtpPluginId, "password", event.target.value)}
                              type="password"
                              placeholder={smtpPluginId === GMAIL_SMTP_PLUGIN_ID ? "•••• •••• •••• ••••" : "••••••••"}
                              autoComplete="off"
                              spellCheck={false}
                            />
                            <span className="field-hint">
                              {smtpSecretSaved(smtpSettings)
                                ? t("smtp.savedPasswordHint")
                                : smtpPluginId === GMAIL_SMTP_PLUGIN_ID
                                  ? t("smtp.gmailPasswordHint")
                                  : t("smtp.genericPasswordHint")}
                            </span>
                          </label>
                        </div>
                        <div className="button-row smtp-settings-actions">
                          <button
                            type="button"
                            className="smtp-command primary-command"
                            onClick={() => void handleSaveSmtpSettings(smtpPluginId)}
                            disabled={smtpBusy}
                          >
                            {t("action.saveSettings")}
                          </button>
                          <button
                            type="button"
                            className="smtp-command"
                            onClick={() => void handleTestSmtpSettings(smtpPluginId)}
                            disabled={smtpBusy}
                          >
                            {t("action.testConnection")}
                          </button>
                          <button
                            type="button"
                            className="smtp-command danger-command"
                            onClick={() => void handleClearSmtpSettings(smtpPluginId)}
                            disabled={smtpBusy}
                          >
                            {t("action.clearSettings")}
                          </button>
                        </div>
                        {(smtpStatus || smtpError) && (
                          <div className={smtpError ? "smtp-feedback error" : "smtp-feedback success"} role={smtpError ? "alert" : "status"}>
                            <span className="smtp-feedback-dot" aria-hidden="true" />
                            <span>{smtpError || smtpStatus}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
          {activeContributionBadges.length > 0 && (
            <div className="plugin-active-summary" aria-label={t("plugins.activeSummaryLabel")}>
              <span className="plugin-active-label">{t("plugins.active")}</span>
              {activeContributionBadges.map((badge) => (
                <span className="plugin-active-chip" key={badge}>
                  {badge}
                </span>
              ))}
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
              <h2 id="publish-dialog-heading">{t("publish.title")}</h2>
              <button type="button" className="dialog-close" onClick={closePublishDialog} disabled={busy}>
                {t("action.close")}
              </button>
            </div>
            <p className="security-note publish-note">
              {t("publish.note")}
            </p>
            <div className="publish-policy-summary">
              <strong>
                {activePolicyProfiles.length > 0
                  ? t("publish.activePolicy", { profiles: activePolicyProfiles.map((profile) => profile.label).join(", ") })
                  : t("publish.defaultPolicy")}
              </strong>
              <ul>
                {publishPolicyRequirementItems.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="publish-branding-summary">
              <strong>{t("publish.branding")}</strong>
              {activeBrandingPreset ? (
                <span>
                  {activeBrandingPreset.pluginName} · {activeBrandingPreset.label}
                  {` · ${t("publish.currentWatermark", { watermark: metadata.watermarkText || t("publish.noWatermark") })}`}
                </span>
              ) : (
                <span>{t("publish.defaultViewerStyle")}</span>
              )}
            </div>
            <label className="publish-viewer-language">
              {t("field.viewerLanguage")}
              <select value={viewerLocale} onChange={(event) => setViewerLocale(resolveLocale(event.target.value))}>
                {SUPPORTED_LOCALES.map((item) => (
                  <option key={item} value={item}>
                    {translate(item, `locale.${item}` as TranslationKey)}
                  </option>
                ))}
              </select>
              <span className="field-hint">{t("field.viewerLanguagePolicy")}</span>
            </label>
            <div className="publish-dialog-grid">
              <label className="field-pin">
                {t("publish.pinLabel")}
                <input
                  value={pin}
                  onChange={(event) => setPin(normalizePinInput(event.target.value))}
                  type={showPin ? "text" : "password"}
                  autoComplete="one-time-code"
                />
              </label>
              <label className="field-pin">
                {t("publish.pinConfirm")}
                <input
                  value={pinConfirm}
                  onChange={(event) => setPinConfirm(normalizePinInput(event.target.value))}
                  type={showPin ? "text" : "password"}
                  autoComplete="one-time-code"
                />
              </label>
              <label className="field-iterations">
                {t("publish.iterations")}
                <select value={iterations} onChange={(event) => setIterations(Number(event.target.value))}>
                  {kdfIterationOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.toLocaleString()}
                      {option === DEFAULT_PIN_KDF_ITERATIONS ? t("publish.defaultOption") : t("publish.policyOption")}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="button-row publish-dialog-actions">
              <button type="button" onClick={handleGeneratePin}>
                {t("action.generate")}
              </button>
              <button type="button" onClick={handleCopyPin} disabled={!pinResult.valid}>
                {t("action.copy")}
              </button>
              <button type="button" onClick={() => setShowPin((value) => !value)}>
                {showPin ? t("action.hide") : t("action.show")}
              </button>
              <button type="button" onClick={closePublishDialog} disabled={busy}>
                {t("action.cancel")}
              </button>
              <button type="button" className="primary" onClick={handlePublish} disabled={busy}>
                {busy ? t("publish.busy") : t("action.createHtml")}
              </button>
            </div>
            <div className={pinResult.valid ? "policy ok" : "policy"}>{pin ? pinResult.message : t("publish.pinPolicyWaiting")}</div>
            {activePolicyProfiles.length > 0 && secondaryPublishPolicyMessages.length > 0 && (pin || pinConfirm) && (
              <ul className="publish-policy-errors">
                {secondaryPublishPolicyMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
            {status && <div className="status">{status}</div>}
            {error && <div className="error">{error}</div>}
          </section>
        </div>
      )}
      {pendingTemplateOverwrite && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeTemplateOverwriteDialog();
            }
          }}
        >
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="template-overwrite-heading">
            <div className="publish-dialog-header">
              <h2 id="template-overwrite-heading">{t("template.overwriteTitle")}</h2>
              <button type="button" className="dialog-close" onClick={closeTemplateOverwriteDialog}>
                {t("action.close")}
              </button>
            </div>
            <p className="security-note publish-note">
              {t("template.overwriteMessage", { template: templateDisplayName(pendingTemplateOverwrite, locale) })}
            </p>
            <div className="button-row publish-dialog-actions">
              <button type="button" onClick={closeTemplateOverwriteDialog}>
                {t("action.cancel")}
              </button>
              <button type="button" className="primary" onClick={confirmTemplateOverwrite}>
                {t("template.apply")}
              </button>
            </div>
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
              <h2 id="email-dialog-heading">{t("email.title")}</h2>
              <button type="button" className="dialog-close" onClick={closeEmailDialog} disabled={emailBusy}>
                {t("action.close")}
              </button>
            </div>
            <p className="security-note publish-note">
              {t("email.note")}
            </p>
            <div className="publish-dialog-grid email-dialog-grid">
              {(pendingEmailPackage.source === "history" ? activeSmtpHistorySendActions : activeSmtpSendActions).length > 1 && (
                <label>
                  {t("email.channel")}
                  <select
                    value={pendingEmailPackage.pluginId}
                    onChange={(event) => {
                      if (isSmtpDeliveryPluginId(event.target.value)) {
                        updatePendingEmailChannel(event.target.value);
                      }
                    }}
                    disabled={emailBusy}
                  >
                    {(pendingEmailPackage.source === "history" ? activeSmtpHistorySendActions : activeSmtpSendActions).map((action) => (
                      <option value={action.pluginId} key={action.pluginId}>
                        {smtpPluginLabel(action.pluginId)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                {t("email.recipient")}
                <input
                  value={emailSendForm.recipientEmail}
                  onChange={(event) => updateEmailSendForm("recipientEmail", event.target.value)}
                  placeholder="recipient@example.com"
                  type="email"
                  autoComplete="email"
                />
              </label>
              <label>
                {t("email.subject")}
                <input
                  value={emailSendForm.subject}
                  onChange={(event) => updateEmailSendForm("subject", event.target.value)}
                />
              </label>
              <label>
                {t("email.attachmentFileName")}
                <input
                  value={emailSendForm.attachmentFileName}
                  onChange={(event) => updateEmailSendForm("attachmentFileName", event.target.value)}
                />
              </label>
            </div>
            <div className="attachment-confirm">
              <span>{t("email.savedPath")}</span>
              <strong>{pendingEmailPackage.filePath}</strong>
            </div>
            <div className="button-row publish-dialog-actions">
              <button type="button" onClick={closeEmailDialog} disabled={emailBusy}>
                {t("action.cancel")}
              </button>
              <button type="button" className="primary" onClick={handleSendEmail} disabled={emailBusy}>
                {emailBusy ? t("email.sending") : t("email.send")}
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
