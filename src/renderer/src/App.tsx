import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Extension } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { PublishHistoryRecord } from "../../shared/desktopApi";
import {
  COMPAT_PIN_KDF_ITERATIONS,
  DEFAULT_PIN_KDF_ITERATIONS,
  evaluatePinPolicy,
  generatePin,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH
} from "../../shared/pinPolicy";
import { issueSecureDocument, type SecureDocPlainContent } from "../../shared/securePackage";
import { buildSecureHtmlDocument } from "../../shared/viewerHtml";
import { isAllowedLinkHref, removeUnsupportedEditorCharacters, sanitizeHtml, stripHtml } from "./sanitizeHtml";

type EditorMode = "visual" | "html";
type HeadingLevel = 1 | 2 | 3;
type BlockStyle = "paragraph" | `heading-${HeadingLevel}`;
type TextAlign = "left" | "center" | "right" | "justify";
const documentTypes = ["보험증서", "계약서", "고지서", "안내문", "기타"] as const;
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

type DocumentPreset = {
  title: string;
  description: string;
  watermarkText: string;
  buildHtml: (metadata: MetadataState) => string;
};

const textAlignments: TextAlign[] = ["left", "center", "right", "justify"];

function isTextAlign(value: unknown): value is TextAlign {
  return typeof value === "string" && textAlignments.includes(value as TextAlign);
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

function escapeTemplateValue(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function metadataText(value: string, fallback: string): string {
  return escapeTemplateValue(removeUnsupportedEditorCharacters(value).trim() || fallback);
}

const documentPresets: Record<DocumentType, DocumentPreset> = {
  보험증서: {
    title: "디지털 안전 보장 보험증서",
    description: "보험증서 형식의 보안 문서 샘플입니다.",
    watermarkText: "CONFIDENTIAL",
    buildHtml(metadata) {
      const title = metadataText(metadata.title, "디지털 안전 보장 보험증서");
      const issuer = metadataText(metadata.issuer, "보장 발행자");
      const recipient = metadataText(metadata.recipientName, "피보험자");
      const documentNumber = metadataText(metadata.documentNumber, "POL-2026-0001");
      const expiresAt = metadataText(metadata.displayExpiresAt, "별도 안내일까지");

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
  계약서: {
    title: "서비스 이용 및 협력 계약서",
    description: "갑/을 정보가 자동 반영되는 계약서 샘플입니다.",
    watermarkText: "계약서",
    buildHtml(metadata) {
      const title = metadataText(metadata.title, "서비스 이용 및 협력 계약서");
      const firstParty = metadataText(metadata.issuer, "갑");
      const secondParty = metadataText(metadata.recipientName, "을");
      const contractDate = metadataText(metadata.displayExpiresAt, "202X년 XX월 XX일");

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
  고지서: {
    title: "서비스 이용 고지서",
    description: "수신자와 발행자가 자동 반영되는 고지서 샘플입니다.",
    watermarkText: "NOTICE",
    buildHtml(metadata) {
      const title = metadataText(metadata.title, "서비스 이용 고지서");
      const issuer = metadataText(metadata.issuer, "고지 발행자");
      const recipient = metadataText(metadata.recipientName, "수신자");
      const documentNumber = metadataText(metadata.documentNumber, "BILL-2026-0001");
      const expiresAt = metadataText(metadata.displayExpiresAt, "지정 납부일까지");

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
  },
  안내문: {
    title: "보안 문서 열람 안내문",
    description: "한자 없이 정리된 안내문 샘플입니다.",
    watermarkText: "공지",
    buildHtml(metadata) {
      const title = metadataText(metadata.title, "보안 문서 열람 안내문");
      const issuer = metadataText(metadata.issuer, "문서 발행 기관");
      const recipient = metadataText(metadata.recipientName, "수신자");

      return `<h1>${title}</h1>
<p>수신: ${recipient}</p>
<p>본 안내문은 암호화된 HTML 보안 문서를 안전하게 열람하고 관리하기 위한 기본 절차를 안내하기 위해 작성되었습니다.</p>
<h2>제1조 [열람 준비]</h2>
<ul>
  <li>문서 파일과 PIN은 서로 다른 경로로 전달받는 것을 권장합니다.</li>
  <li>문서 열람 전 파일 출처와 발행자를 확인해 주십시오.</li>
  <li>공용 PC 또는 신뢰할 수 없는 환경에서는 열람을 피하는 것이 좋습니다.</li>
</ul>
<h2>제2조 [열람 절차]</h2>
<ul>
  <li>발행자가 전달한 HTML 파일을 브라우저에서 엽니다.</li>
  <li>별도로 안내받은 6자리 이상 15자리 이내 PIN을 입력합니다.</li>
  <li>열람 후에는 브라우저 탭을 닫고 필요 시 다운로드 파일을 안전한 위치에 보관합니다.</li>
</ul>
<h2>제3조 [보안 유의 사항]</h2>
<ul>
  <li>PIN을 문서 파일명, 이메일 제목, 메신저 대화방 이름 등에 함께 남기지 마십시오.</li>
  <li>PIN이 외부에 노출되었다고 판단되면 발행자에게 재발행을 요청하십시오.</li>
  <li>문서 내용은 열람 권한이 있는 사람에게만 공유하십시오.</li>
</ul>
<p>[${issuer}]</p>`;
    }
  },
  기타: {
    title: "보안문서",
    description: "자유 형식 보안 문서 샘플입니다.",
    watermarkText: "SECURE",
    buildHtml(metadata) {
      const title = metadataText(metadata.title, "보안문서");
      const issuer = metadataText(metadata.issuer, "발행자");
      const recipient = metadataText(metadata.recipientName, "수신자");

      return `<h1>${title}</h1>
<p><strong>발행:</strong> ${issuer}</p>
<p><strong>수신:</strong> ${recipient}</p>
<h2>본문</h2>
<p>이 문서는 자유 형식으로 작성되는 보안 문서입니다. 필요한 조항, 안내 사항, 서명란을 이곳에 정리합니다.</p>`;
    }
  }
};

const defaultMetadata: MetadataState = {
  title: documentPresets["안내문"].title,
  issuer: "",
  description: documentPresets["안내문"].description,
  docType: "안내문",
  displayExpiresAt: "",
  watermarkText: documentPresets["안내문"].watermarkText,
  recipientName: "",
  documentNumber: "",
  createdBy: "admin"
};

const initialEditorHtml = documentPresets[defaultMetadata.docType].buildHtml(defaultMetadata);
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
  const [syncPresetWithMetadata, setSyncPresetWithMetadata] = useState(true);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const programmaticEditorUpdateRef = useRef(false);

  const pinResult = useMemo(() => evaluatePinPolicy(pin), [pin]);
  const sanitizedPreview = useMemo(() => sanitizeHtml(editorHtml), [editorHtml]);
  const contentText = useMemo(() => stripHtml(sanitizedPreview), [sanitizedPreview]);
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

  useEffect(() => {
    window.secureDoc?.getHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  useEffect(() => {
    editor?.commands.setContent(editorHtml, { emitUpdate: false });
  }, [editor]);

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

  function replaceEditorHtml(nextHtml: string): void {
    const sanitizedHtml = sanitizeHtml(nextHtml);
    programmaticEditorUpdateRef.current = true;
    setEditorHtml(sanitizedHtml);
    editor?.commands.setContent(sanitizedHtml, { emitUpdate: false });
    queueMicrotask(() => {
      programmaticEditorUpdateRef.current = false;
    });
  }

  function buildPresetHtml(nextMetadata: MetadataState): string {
    return documentPresets[nextMetadata.docType].buildHtml(nextMetadata);
  }

  function updateMetadata<K extends keyof MetadataState>(key: K, value: MetadataState[K]): void {
    const nextMetadata = {
      ...metadata,
      [key]: value
    } as MetadataState;

    setMetadata(nextMetadata);
    if (syncPresetWithMetadata && presetBodyMetadataKeys.has(key)) {
      replaceEditorHtml(buildPresetHtml(nextMetadata));
    }
  }

  function handleDocumentTypeChange(docType: DocumentType): void {
    const preset = documentPresets[docType];
    const nextMetadata: MetadataState = {
      ...metadata,
      docType,
      title: preset.title,
      description: preset.description,
      watermarkText: preset.watermarkText
    };

    setMetadata(nextMetadata);
    setSyncPresetWithMetadata(true);
    replaceEditorHtml(buildPresetHtml(nextMetadata));
    setStatus(`${docType} 샘플을 본문에 적용했습니다.`);
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
    const nextPin = generatePin();
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
        throw new Error("Electron desktop bridge is not available.");
      }
      const publishMetadata = metadata;

      if (!publishMetadata.title.trim()) {
        throw new Error("문서 제목을 입력하세요.");
      }
      if (!publishMetadata.issuer.trim()) {
        throw new Error("발행자를 입력하세요.");
      }
      if (!pinResult.valid) {
        throw new Error(pinResult.message);
      }
      if (pinResult.normalizedPin !== pinConfirm.normalize("NFKC").trim()) {
        throw new Error("PIN 확인 입력이 일치하지 않습니다.");
      }
      if (!contentText) {
        throw new Error("암호화할 본문을 입력하세요.");
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
          <a href="#" className="active">문서 발행</a>
          <a href="#">발행 이력</a>
          <a href="#">보안 정책</a>
          <span className="group-label">배포 대상</span>
          <a href="#">macOS universal</a>
          <a href="#">Windows x64</a>
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

        <div className="workspace">
        <section className="panel metadata-panel" aria-labelledby="metadata-heading">
          <div className="section-heading">
            <h2 id="metadata-heading">문서 기본정보</h2>
          </div>
          <div className="form-grid">
            <label className="field-title">
              문서 제목
              <input value={metadata.title} onChange={(event) => updateMetadata("title", event.target.value)} />
            </label>
            <label className="field-issuer">
              갑/발행자
              <input value={metadata.issuer} onChange={(event) => updateMetadata("issuer", event.target.value)} />
            </label>
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
            <label className="field-date">
              표시용 만료일
              <input
                type="date"
                value={metadata.displayExpiresAt}
                onChange={(event) => updateMetadata("displayExpiresAt", event.target.value)}
              />
            </label>
            <label className="field-recipient">
              을/수신자명
              <input value={metadata.recipientName} onChange={(event) => updateMetadata("recipientName", event.target.value)} />
            </label>
            <label className="field-number">
              문서번호
              <input value={metadata.documentNumber} onChange={(event) => updateMetadata("documentNumber", event.target.value)} />
            </label>
            <label className="field-description">
              문서 설명
              <input value={metadata.description} onChange={(event) => updateMetadata("description", event.target.value)} />
            </label>
            <label className="field-watermark">
              워터마크 문구
              <input value={metadata.watermarkText} onChange={(event) => updateMetadata("watermarkText", event.target.value)} />
            </label>
            <label className="field-created">
              발행 작업자
              <input value={metadata.createdBy} onChange={(event) => updateMetadata("createdBy", event.target.value)} />
            </label>
          </div>
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

        <section className="panel history-panel" aria-labelledby="history-heading">
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
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5}>저장된 발행 이력이 없습니다.</td>
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
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
            {status && <div className="status">{status}</div>}
            {error && <div className="error">{error}</div>}
          </section>
        </div>
      )}
    </div>
  );
}
