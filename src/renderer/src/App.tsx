import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { PublishHistoryRecord } from "../../shared/desktopApi";
import {
  COMPAT_PIN_KDF_ITERATIONS,
  DEFAULT_PIN_KDF_ITERATIONS,
  evaluatePinPolicy,
  generateNumericPin
} from "../../shared/pinPolicy";
import { issueSecureDocument, type SecureDocPlainContent } from "../../shared/securePackage";
import { buildSecureHtmlDocument } from "../../shared/viewerHtml";
import { sanitizeHtml, stripHtml } from "./sanitizeHtml";

type MetadataState = {
  title: string;
  issuer: string;
  description: string;
  docType: string;
  displayExpiresAt: string;
  watermarkText: string;
  recipientName: string;
  documentNumber: string;
  createdBy: string;
};

const initialEditorHtml = `<article><h1>보안문서</h1><p>본문 내용을 입력하세요.</p></article>`;

const defaultMetadata: MetadataState = {
  title: "보안문서",
  issuer: "",
  description: "",
  docType: "안내문",
  displayExpiresAt: "",
  watermarkText: "",
  recipientName: "",
  documentNumber: "",
  createdBy: "admin"
};

function normalizeNumericInput(value: string): string {
  return value.normalize("NFKC").replace(/[^0-9]/g, "").slice(0, 6);
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
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [metadata, setMetadata] = useState<MetadataState>(defaultMetadata);
  const [editorHtml, setEditorHtml] = useState(initialEditorHtml);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [iterations, setIterations] = useState(DEFAULT_PIN_KDF_ITERATIONS);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<PublishHistoryRecord[]>([]);

  const pinResult = useMemo(() => evaluatePinPolicy(pin), [pin]);
  const sanitizedPreview = useMemo(() => sanitizeHtml(editorHtml), [editorHtml]);
  const contentText = useMemo(() => stripHtml(sanitizedPreview), [sanitizedPreview]);

  useEffect(() => {
    window.secureDoc?.getHistory().then(setHistory).catch(() => setHistory([]));
  }, []);

  function updateMetadata<K extends keyof MetadataState>(key: K, value: MetadataState[K]): void {
    setMetadata((current) => ({
      ...current,
      [key]: value
    }));
  }

  function replaceEditorSelection(buildReplacement: (selected: string) => string): void {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editorHtml.slice(start, end);
    const replacement = buildReplacement(selected || "본문");
    const nextHtml = `${editorHtml.slice(0, start)}${replacement}${editorHtml.slice(end)}`;
    setEditorHtml(nextHtml);

    requestAnimationFrame(() => {
      editor.focus();
      editor.setSelectionRange(start, start + replacement.length);
    });
  }

  function wrapBlock(tagName: "h1" | "h2" | "p"): void {
    replaceEditorSelection((selected) => `<${tagName}>${selected}</${tagName}>`);
  }

  function wrapInline(tagName: "strong" | "em"): void {
    replaceEditorSelection((selected) => `<${tagName}>${selected}</${tagName}>`);
  }

  function insertList(): void {
    replaceEditorSelection((selected) => {
      const items = selected
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const normalizedItems = items.length > 0 ? items : ["항목"];
      return `<ul>${normalizedItems.map((item) => `<li>${item}</li>`).join("")}</ul>`;
    });
  }

  function handleGeneratePin(): void {
    const nextPin = generateNumericPin();
    setPin(nextPin);
    setPinConfirm(nextPin);
    setStatus("새 6자리 PIN이 생성되었습니다. 발행 후에는 다시 조회할 수 없습니다.");
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
      if (!metadata.title.trim()) {
        throw new Error("문서 제목을 입력하세요.");
      }
      if (!metadata.issuer.trim()) {
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
        privateMeta: compactPrivateMeta(metadata)
      };

      const securePackage = await issueSecureDocument({
        content,
        pin: pinResult.normalizedPin,
        metadata: {
          title: metadata.title.trim(),
          issuer: metadata.issuer.trim(),
          issuedAt,
          displayExpiresAt: metadata.displayExpiresAt || undefined
        },
        iterations
      });

      const html = buildSecureHtmlDocument(securePackage);
      const suggestedFileName = `${securePackage.doc.id}-${safeFileNamePart(metadata.title)}.html`;
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
          createdBy: metadata.createdBy.trim() || "admin"
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
              발행자
              <input value={metadata.issuer} onChange={(event) => updateMetadata("issuer", event.target.value)} />
            </label>
            <label>
              문서 유형
              <select value={metadata.docType} onChange={(event) => updateMetadata("docType", event.target.value)}>
                <option>보험증서</option>
                <option>계약서</option>
                <option>고지서</option>
                <option>안내문</option>
                <option>기타</option>
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
              수신자명
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
            <div className="toolbar" aria-label="본문 서식">
              <button type="button" onClick={() => wrapBlock("h1")}>
                H1
              </button>
              <button type="button" onClick={() => wrapBlock("h2")}>
                H2
              </button>
              <button type="button" onClick={() => wrapInline("strong")}>
                B
              </button>
              <button type="button" onClick={() => wrapInline("em")}>
                I
              </button>
              <button type="button" onClick={insertList}>
                List
              </button>
            </div>
          </div>
          <textarea
            ref={editorRef}
            className="editor"
            value={editorHtml}
            spellCheck={false}
            onChange={(event) => setEditorHtml(event.target.value)}
          />
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
            6자리 PIN은 편의형 암호입니다. 고보안 문서는 서버 인증, 전자서명, 신뢰된 로컬 뷰어 앱을 함께 사용해야 합니다.
          </p>
          <div className="form-grid">
            <label>
              문서 열람 PIN
              <input
                value={pin}
                onChange={(event) => setPin(normalizeNumericInput(event.target.value))}
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                autoComplete="one-time-code"
              />
            </label>
            <label>
              PIN 확인
              <input
                value={pinConfirm}
                onChange={(event) => setPinConfirm(normalizeNumericInput(event.target.value))}
                type={showPin ? "text" : "password"}
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
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
