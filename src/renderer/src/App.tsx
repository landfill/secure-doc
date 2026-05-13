import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
import { removeUnsupportedEditorCharacters, sanitizeHtml, stripHtml } from "./sanitizeHtml";

type EditorMode = "visual" | "html";
const documentTypes = ["보험증서", "계약서", "고지서", "안내문", "기타"] as const;
type DocumentType = (typeof documentTypes)[number];

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
  const programmaticEditorUpdateRef = useRef(false);

  const pinResult = useMemo(() => evaluatePinPolicy(pin), [pin]);
  const sanitizedPreview = useMemo(() => sanitizeHtml(editorHtml), [editorHtml]);
  const contentText = useMemo(() => stripHtml(sanitizedPreview), [sanitizedPreview]);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3]
        }
      })
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

  function isEditorActive(name: string, attributes?: Record<string, unknown>): boolean {
    return Boolean(editor?.isActive(name, attributes));
  }

  function handleGeneratePin(): void {
    const nextPin = generatePin();
    setPin(nextPin);
    setPinConfirm(nextPin);
    setStatus("새 PIN이 생성되었습니다. 표시 버튼으로 확인하거나 복사할 수 있습니다.");
    setError("");
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
      <header className="topbar">
        <div>
          <p className="eyebrow">WebCrypto Offline Secure Document</p>
          <h1>Secure Doc Admin</h1>
        </div>
        <div className="platforms" aria-label="배포 대상">
          <span>macOS universal</span>
          <span>Windows x64</span>
        </div>
      </header>

      <main className="workspace">
        <section className="panel metadata-panel" aria-labelledby="metadata-heading">
          <div className="section-heading">
            <h2 id="metadata-heading">문서 기본정보</h2>
          </div>
          <div className="form-grid">
            <label>
              문서 제목
              <input value={metadata.title} onChange={(event) => updateMetadata("title", event.target.value)} />
            </label>
            <label>
              갑/발행자
              <input value={metadata.issuer} onChange={(event) => updateMetadata("issuer", event.target.value)} />
            </label>
            <label>
              문서 유형
              <select value={metadata.docType} onChange={(event) => handleDocumentTypeChange(event.target.value as DocumentType)}>
                {documentTypes.map((docType) => (
                  <option key={docType} value={docType}>
                    {docType}
                  </option>
                ))}
              </select>
            </label>
            <label>
              표시용 만료일
              <input
                type="date"
                value={metadata.displayExpiresAt}
                onChange={(event) => updateMetadata("displayExpiresAt", event.target.value)}
              />
            </label>
            <label>
              을/수신자명
              <input value={metadata.recipientName} onChange={(event) => updateMetadata("recipientName", event.target.value)} />
            </label>
            <label>
              문서번호
              <input value={metadata.documentNumber} onChange={(event) => updateMetadata("documentNumber", event.target.value)} />
            </label>
            <label className="wide">
              문서 설명
              <input value={metadata.description} onChange={(event) => updateMetadata("description", event.target.value)} />
            </label>
            <label>
              워터마크 문구
              <input value={metadata.watermarkText} onChange={(event) => updateMetadata("watermarkText", event.target.value)} />
            </label>
            <label>
              발행 작업자
              <input value={metadata.createdBy} onChange={(event) => updateMetadata("createdBy", event.target.value)} />
            </label>
          </div>
        </section>

        <section className="panel editor-panel" aria-labelledby="editor-heading">
          <div className="section-heading">
            <h2 id="editor-heading">암호화 본문 작성</h2>
            <div className="editor-actions">
              <div className="mode-toggle" aria-label="본문 작성 모드">
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
            <div className="toolbar" aria-label="본문 서식">
              <button
                type="button"
                className={isEditorActive("heading", { level: 1 }) ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand(() => editor?.chain().focus().toggleHeading({ level: 1 }).run() ?? false)}
              >
                H1
              </button>
              <button
                type="button"
                className={isEditorActive("heading", { level: 2 }) ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand(() => editor?.chain().focus().toggleHeading({ level: 2 }).run() ?? false)}
              >
                H2
              </button>
              <button
                type="button"
                className={isEditorActive("bold") ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand(() => editor?.chain().focus().toggleBold().run() ?? false)}
              >
                B
              </button>
              <button
                type="button"
                className={isEditorActive("italic") ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand(() => editor?.chain().focus().toggleItalic().run() ?? false)}
              >
                I
              </button>
              <button
                type="button"
                className={isEditorActive("bulletList") ? "active" : ""}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => runEditorCommand(() => editor?.chain().focus().toggleBulletList().run() ?? false)}
              >
                List
              </button>
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
        </section>

        <section className="panel security-panel" aria-labelledby="security-heading">
          <div className="section-heading">
            <h2 id="security-heading">PIN 설정 및 발행</h2>
          </div>
          <p className="security-note">
            6자리 이상 15자리 이내 PIN은 문자와 기호를 함께 사용할 수 있는 편의형 암호입니다. 자동 생성 후 표시 버튼으로 확인하거나 복사할 수 있습니다.
          </p>
          <div className="form-grid">
            <label>
              문서 열람 PIN
              <input
                value={pin}
                onChange={(event) => setPin(normalizePinInput(event.target.value))}
                type={showPin ? "text" : "password"}
                autoComplete="one-time-code"
              />
            </label>
            <label>
              PIN 확인
              <input
                value={pinConfirm}
                onChange={(event) => setPinConfirm(normalizePinInput(event.target.value))}
                type={showPin ? "text" : "password"}
                autoComplete="one-time-code"
              />
            </label>
            <label>
              PBKDF2 반복 횟수
              <select value={iterations} onChange={(event) => setIterations(Number(event.target.value))}>
                <option value={DEFAULT_PIN_KDF_ITERATIONS}>1,000,000 기본</option>
                <option value={COMPAT_PIN_KDF_ITERATIONS}>600,000 저사양 호환</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={handleGeneratePin}>
              자동 생성
            </button>
            <button type="button" onClick={handleCopyPin} disabled={!pinResult.valid}>
              복사
            </button>
            <button type="button" onClick={() => setShowPin((value) => !value)}>
              {showPin ? "숨김" : "표시"}
            </button>
            <button type="button" className="primary" onClick={handlePublish} disabled={busy}>
              {busy ? "발행 중" : "HTML 파일 생성"}
            </button>
          </div>
          <div className={pinResult.valid ? "policy ok" : "policy"}>{pin ? pinResult.message : "PIN 정책 검사 대기 중"}</div>
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
      </main>
    </div>
  );
}
