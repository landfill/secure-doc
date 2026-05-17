# Secure Doc Admin

Secure Doc Admin은 Electron + React/TypeScript 기반의 오프라인 보안 문서 발행 도구입니다. 관리자는 문서를 작성한 뒤 PIN으로 보호된 단일 HTML 패키지를 발행하고, 수신자는 별도로 전달받은 PIN으로 브라우저에서 문서를 열람합니다.

## 주요 기능

- Tiptap 기반 WYSIWYG 본문 편집과 HTML 보기 모드
- 6~15자 PIN 정책, 취약 PIN 차단, `crypto.getRandomValues()` 기반 PIN 생성
- PBKDF2-HMAC-SHA-256 기반 KEK 파생
- AES-256-GCM 기반 본문 암호화와 DEK/KEK 분리 구조
- 외부 리소스 없는 단일 HTML 뷰어 생성
- CSP `connect-src 'none'` 적용
- 발행 이력 저장, 패키지 SHA-256 기록
- Gmail SMTP 플러그인을 통한 보안 HTML 첨부 발송
- 발행 직후와 발행 이력에서 이메일 발송 지원
- PIN 원문, PIN 해시, 평문 본문, DEK, KEK 저장 금지

## Gmail SMTP 플러그인

내장 플러그인 `delivery.smtp.gmail`은 명시적으로 활성화한 뒤 사용할 수 있습니다.

설정 항목:

- SMTP host: 기본값 `smtp.gmail.com`
- SMTP port: Gmail STARTTLS 전용 `587`
- Gmail 계정
- Gmail 앱 비밀번호

앱 비밀번호는 저장 전에 NFKC 정규화와 공백 제거를 거친 뒤 16자만 허용합니다. 원문은 renderer로 반환하지 않으며, Electron `safeStorage.encryptString()` 결과를 base64로 저장합니다. 설정 파일 위치는 Electron `userData/plugin-settings/delivery.smtp.gmail.json`입니다.

권한:

- `network:smtp`: Gmail SMTP 연결과 메일 발송
- `secret:safeStorage`: 앱 비밀번호 암호화 저장
- `package:read`: 발행된 보안 HTML 첨부 읽기
- `history:read`: 발행 이력에서 재발송 대상 확인
- `ui:settings`: 플러그인 설정 UI 표시
- `ui:publish-action`: 발행 직후 발송 액션 표시

발송 동작:

- `test-smtp`: 저장된 설정으로 Nodemailer `transporter.verify()`를 실행합니다.
- `send-email`: 발행 직후 저장된 보안 HTML을 첨부해 단일 수신자에게 발송합니다.
- `send-email-from-history`: 발행 이력의 저장 파일을 첨부해 단일 수신자에게 발송합니다.

메일 본문은 고정 안내문만 포함합니다. 문서 평문, PIN, PIN 해시, DEK, KEK는 메일 본문에 넣지 않습니다. 발송 전 main process가 발행 이력의 `documentId`, `outputPath`, `packageSha256`를 확인하고, 현재 파일 내용의 SHA-256이 이력의 해시와 일치할 때만 첨부합니다.

## 보안 모델

문서는 발행 시 무작위 DEK로 본문을 암호화하고, 사용자가 정한 PIN에서 파생한 KEK로 DEK를 감싸는 구조를 사용합니다.

```text
PIN -> PBKDF2-HMAC-SHA-256 -> KEK
문서 본문 -> AES-256-GCM with DEK
DEK -> wrapped by KEK
```

잘못된 PIN, 메타데이터 변조, 암호문 변조는 동일한 공개 실패 메시지로 처리합니다. 발행 이력은 패키지 SHA-256을 보관해 저장 후 파일 변조를 감지합니다.

저장하지 않는 항목:

- PIN 원문
- PIN 해시
- 평문 본문
- 평문 DEK
- 평문 KEK
- 앱 비밀번호 원문

## 발행 이력

발행 이력은 Electron userData 경로에 저장됩니다. Node 런타임에서 `node:sqlite`를 사용할 수 있으면 SQLite를 사용하고, 사용할 수 없으면 JSONL fallback을 사용합니다.

저장 항목:

- 문서 ID, 제목, 발행자, 발행 시각
- 표시용 만료일
- 패키지 SHA-256
- KDF 알고리즘과 반복 횟수
- 본문 암호화 알고리즘
- 발행 작업자
- 저장 파일 경로
- 플랫폼

## 요구사항

- Node.js 22 이상
- npm 10 이상

## 설치

```bash
npm install
```

Electron 런타임 다운로드가 누락되어 `Electron failed to install correctly` 오류가 발생하면 다음 명령으로 복구합니다.

```bash
npm run fix:electron
```

## 개발 실행

```bash
npm run dev
```

## 테스트

```bash
npm test
```

테스트는 PIN 정책, 패키지 암호화/복호화, 발행 이력 저장, 플러그인 registry/store, SMTP 설정 저장, SMTP 전송 액션, SMTP 오류 마스킹, 패키지 해시 무결성, 정적 보안 제약을 검증합니다.

## 빌드

```bash
npm run build
```

빌드 결과는 `out/`에 생성됩니다.

## 패키징

macOS universal DMG:

```bash
npm run make:mac
```

Windows x64 NSIS 설치 파일:

```bash
npm run make:win
```

패키징 결과는 `release/`에 생성됩니다. 운영 배포 전에는 macOS Developer ID 코드서명, notarization, Windows 코드서명 인증서, 앱 아이콘, 업데이트 배포 정책을 별도로 구성해야 합니다.

## 보안 한계

오프라인 단일 HTML 구조는 다음을 보장하지 않습니다.

- 이미 배포된 파일 회수
- 서버 기반 열람 로그
- 강제 만료
- 동적인 실패 횟수 제한
- 캡처 방지
- HTML/JS 뷰어 코드 변조 방지

공격자가 HTML 파일 자체를 변조할 수 있는 환경에서는 입력 PIN 노출 위험이 있습니다. 고보안 환경에서는 전자서명 검증, 코드서명, 신뢰된 로컬 뷰어 같은 추가 통제가 필요합니다.

## 문서

상세 설계 노트는 [docs/secure-doc-pin-plan.md](docs/secure-doc-pin-plan.md)를 참고하세요.
