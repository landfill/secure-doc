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
  return escapeTemplateValue(value.trim() || fallback);
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
    title: "영혼 귀속 및 일상 점유 계약서",
    description: "갑/을 정보가 자동 반영되는 계약서 샘플입니다.",
    watermarkText: "계약서",
    buildHtml(metadata) {
      const title = metadataText(metadata.title, "영혼 귀속 및 일상 점유 계약서");
      const firstParty = metadataText(metadata.issuer, "절대 갑");
      const secondParty = metadataText(metadata.recipientName, "영원한 을");
      const contractDate = metadataText(metadata.displayExpiresAt, "202X년 XX월 XX일");

      return `<h1>${title}</h1>
<p>본 계약은 <strong>${firstParty}</strong>(이하 주인님)과 <strong>${secondParty}</strong>(이하 노예) 간의 원만한, 사실은 일방적인 관계 유지를 위해 아래와 같이 체결한다.</p>
<h2>제1조 [목적]</h2>
<p>본 계약은 노예가 주인님에게 자신의 시간, 영혼, 그리고 지갑의 일부를 자발적을 가장한 강압으로 봉헌함으로써 주인님의 삶의 질을 향상시키는 데 그 목적이 있다.</p>
<h2>제2조 [효력 발생]</h2>
<p>본 계약서는 작성된 순간부터 효력이 발생하며, 주인님이 질렸다고 선언하거나 노예가 로또 1등에 당첨되어 주인님을 매수하기 전까지 유효하다.</p>
<h2>제3조 [노예의 5대 의무]</h2>
<ul>
  <li>즉시 응답의 의무: 주인님의 카톡이나 전화는 3분 이내에 응답해야 한다.</li>
  <li>무조건 공감의 의무: 주인님의 농담이 썰렁해도 노예는 최선을 다해 웃어야 한다.</li>
  <li>메뉴 결정의 의무: 뭐 먹을까라는 질문에는 최소 3가지 이상의 후보군을 제시해야 한다.</li>
  <li>찬양의 의무: 노예는 매일 1회 이상 주인님의 미모, 지성, 패션 센스 중 하나를 찬양해야 한다.</li>
  <li>보디가드의 의무: 주인님이 밤늦게 배가 고프다고 할 때 간식 조달 작전에 협조해야 한다.</li>
</ul>
<h2>제4조 [금지 사항]</h2>
<ul>
  <li>주인님의 허락 없이 먼저 잠들거나 연락을 두절하는 행위</li>
  <li>주인님보다 맛있는 것을 혼자 먹으러 가는 행위</li>
  <li>주인님 앞에서 다른 사람의 외모를 과도하게 칭찬하는 행위</li>
</ul>
<h2>제5조 [보상 및 복리후생]</h2>
<p>주인님은 기분이 좋을 때 노예에게 쓰다듬기 1회 또는 간식 한 입을 하사할 수 있다.</p>
<h2>제6조 [계약 위반 시 조치]</h2>
<p>노예가 위 조항을 어길 시 주인님이 지정하는 배달 음식을 결제하고, 1시간 동안 개인 사진사가 되어 인생샷이 나올 때까지 셔터를 눌러야 한다.</p>
<p>계약 체결일: ${contractDate}</p>
<p>${firstParty} (주인님): ________________ (인)</p>
<p>${secondParty} (노예): ________________ (인)</p>
<p><strong>주의:</strong> 본 계약서는 법적 효력이 전혀 없으며, 오로지 두 사람의 재미와 우정을 위해 작성되었습니다.</p>`;
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
    title: "[긴급 공고] 인류 문명 수호를 위한 영역 표시 제한 지침",
    description: "한자 없이 정리된 안내문 샘플입니다.",
    watermarkText: "공지",
    buildHtml(metadata) {
      const title = metadataText(metadata.title, "[긴급 공고] 인류 문명 수호를 위한 영역 표시 제한 지침");
      const issuer = metadataText(metadata.issuer, "전국 골목길 평화 유지 위원회");
      const recipient = metadataText(metadata.recipientName, "노상 방출 행위자");

      return `<h1>${title}</h1>
<p>수신: ${recipient}</p>
<p>본 공고문은 현대 문명 사회의 품격을 유지하고, 인류가 직립 보행을 시작한 이래 쌓아온 도덕적 가치를 보존하기 위해 작성되었습니다. 특정 구역에서 발생하는 자연의 부름에 대한 무단 응답 행위를 엄격히 규제하오니 적극 협조 바랍니다.</p>
<h2>제1조 [목적]</h2>
<p>본 지침은 특정 골목 및 담벼락을 야생 동물의 영역 표시 구역으로 오인하는 일부 보행자들의 착각을 바로잡고, 인근 주민들의 후각적 생존권을 보장하는 데 목적이 있다.</p>
<h2>제2조 [대상 정의]</h2>
<p>노상 방출 행위자라 함은 화장실이라는 인류 최고의 발명품을 뒤로한 채, 차가운 콘크리트 벽면이나 전신주를 상대로 자신의 생체 에너지를 쏟아붓는 자를 말한다.</p>
<h2>제3조 [방출 행위의 과학적 고찰]</h2>
<ul>
  <li>화학적 테러: 배출 액체 속 암모니아 NH3 수치는 벽면의 페인트를 부식시키며 건물 노후화의 주범이 된다.</li>
  <li>영역 표시의 오해: 본 구역은 귀하의 사유지가 아니며, 배설물을 뿌린다고 해서 부동산 소유권이 이전되지 않는다.</li>
</ul>
<h2>제4조 [방출자 수칙 및 경고]</h2>
<ul>
  <li>CCTV의 눈: 본 구역의 CCTV는 4K 초고화질로 귀하의 표정 변화를 기록하고 있다.</li>
  <li>생물학적 역습: 방수 코팅 및 반사 기술로 인해 액체가 신발이나 바지로 100% 되돌아갈 수 있다.</li>
  <li>조상님의 감시: 지퍼를 내리는 순간 하늘의 조상님들이 이번 달 운세를 대흉으로 수정할 가능성이 높다.</li>
</ul>
<h2>제5조 [권장 사항]</h2>
<p>급박한 사정이 있을 경우 괄약근의 힘을 1.5배 강화하여 인근 개방 화장실까지 경보로 이동할 것을 권장한다. 이동 중 참을 인 자를 세 번 외치면 인내심 수치가 5% 상승한다는 통계가 있다.</p>
<h2>제6조 [위반 시 조치]</h2>
<ul>
  <li>해당 구역 암모니아 향수, 일명 Scent of Regret을 1분간 깊게 들이마시기</li>
  <li>청소 도구를 지참하여 본인의 흔적을 120% 제거하고 광택 작업 실시</li>
  <li>지나가는 행인 10명에게 저는 아직 문명인이 되지 못했습니다라고 고해성사하기</li>
</ul>
<p>귀하의 방광은 소중하지만, 우리의 코는 더 소중합니다.</p>
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
  return [...value.normalize("NFKC")].slice(0, PIN_MAX_LENGTH).join("");
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
      const currentHtml = currentEditor.getHTML();
      const sanitizedHtml = sanitizeHtml(currentHtml);
      if (sanitizedHtml !== currentHtml) {
        currentEditor.commands.setContent(sanitizedHtml, { emitUpdate: false });
      }
      setEditorHtml(sanitizedHtml);
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
    const normalizedValue = typeof value === "string" ? removeUnsupportedEditorCharacters(value) : value;
    const nextMetadata = {
      ...metadata,
      [key]: normalizedValue
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
                setEditorHtml(removeUnsupportedEditorCharacters(event.target.value));
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
                minLength={PIN_MIN_LENGTH}
                maxLength={PIN_MAX_LENGTH}
                autoComplete="one-time-code"
              />
            </label>
            <label>
              PIN 확인
              <input
                value={pinConfirm}
                onChange={(event) => setPinConfirm(normalizePinInput(event.target.value))}
                type={showPin ? "text" : "password"}
                minLength={PIN_MIN_LENGTH}
                maxLength={PIN_MAX_LENGTH}
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
