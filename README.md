# Secure Doc Admin

Secure Doc Admin은 Electron + React/TypeScript 기반의 오프라인 보안 문서 발행 도구입니다. 관리자는 문서를 작성한 뒤 PIN으로 보호된 단일 HTML 패키지를 발행하고, 수신자는 별도로 전달받은 PIN으로 브라우저에서 문서를 열람합니다.

## 주요 기능

- Tiptap 기반 WYSIWYG 본문 편집과 HTML 보기 모드
- 문서 유형 분류와 명시적 템플릿 적용 흐름
- 기본 문서 템플릿과 내장 템플릿팩 플러그인
- 6~15자 PIN 정책, 취약 PIN 차단, `crypto.getRandomValues()` 기반 PIN 생성
- PBKDF2-HMAC-SHA-256 기반 KEK 파생
- AES-256-GCM 기반 본문 암호화와 DEK/KEK 분리 구조
- 외부 리소스 없는 단일 HTML 뷰어 생성
- CSP `connect-src 'none'` 적용
- 발행 이력 저장, 패키지 SHA-256 기록, 저장 파일 무결성 감사
- Gmail SMTP와 Generic SMTP 플러그인을 통한 보안 HTML 첨부 발송
- 발행 직후와 발행 이력에서 이메일 발송 지원
- 선언형 발행 정책 플러그인과 보수적 정책 병합
- 브랜딩 preset 플러그인으로 발행자, 워터마크, viewer 색상 적용
- PIN 원문, PIN 해시, 평문 본문, DEK, KEK 저장 금지

## 문서 작성 흐름

문서 유형 선택은 분류 메타데이터를 바꾸는 동작입니다. 본문을 자동으로 덮어쓰지 않으며, 선택한 유형에 맞는 템플릿이 있으면 템플릿 선택만 이동해 사용자가 다음 행동을 명확히 볼 수 있게 합니다.

본문을 바꾸려면 `본문에 템플릿 적용` 버튼을 눌러야 합니다. 기존 본문이 있으면 앱 내부 확인 다이얼로그로 덮어쓰기를 확인합니다.

기본 템플릿:

- `core.notice`: 안내문/공지문
- `core.contract`: 계약/동의 문서
- `core.policy`: 정책/규정 문서
- `core.general`: 일반 보안 문서

`template-pack.business-samples` 플러그인을 활성화하면 보험증서와 고지서 템플릿이 추가됩니다. 템플릿팩은 실행 코드를 로드하지 않고, 신뢰된 번들 내부의 정적 템플릿 id만 기여합니다.

## 내장 플러그인

플러그인은 앱에 내장된 manifest와 allowlist된 main-process 동작으로만 동작합니다. 현재 외부 플러그인 코드, 원격 registry, 런타임 JavaScript 로딩은 지원하지 않습니다. 모든 플러그인은 로컬 상태에 명시적으로 활성화된 뒤 기여 기능이 표시됩니다.

현재 내장 플러그인:

- `delivery.smtp.gmail`: Gmail SMTP로 보안 HTML 패키지를 발송합니다.
- `delivery.smtp.generic`: 내부 SMTP relay 등 임의 SMTP 서버로 보안 HTML 패키지를 발송합니다.
- `template-pack.business-samples`: 보험증서와 고지서 템플릿을 추가합니다.
- `audit.integrity.report`: 발행 이력의 SHA-256과 저장 파일을 비교해 정상, 파일 없음, 변조 의심 상태를 보고합니다.
- `branding.company-defaults`: 조직 발행자, 기본 워터마크, viewer 색상 preset을 적용합니다.
- `policy.strict-pin`: 더 긴 PIN, 기본 KDF 반복 횟수, 필수 메타데이터, 워터마크를 요구합니다.

플러그인 권한과 기여 지점은 [docs/plugin-api.md](docs/plugin-api.md)에 정리되어 있습니다.

## 발송 플러그인

Gmail SMTP와 Generic SMTP는 같은 보안 경로를 사용합니다. renderer는 저장된 패키지 식별자와 발송 입력값만 전달하며, 문서 평문, PIN, PIN 해시, DEK, KEK, HTML 첨부 원문을 IPC payload에 싣지 않습니다.

공통 권한:

- `network:smtp`: SMTP 연결과 메일 발송
- `secret:safeStorage`: SMTP 비밀번호 암호화 저장
- `package:read`: 발행된 보안 HTML 첨부 읽기
- `history:read`: 발행 이력에서 재발송 대상 확인
- `ui:settings`: 플러그인 설정 UI 표시
- `ui:publish-action`: 발행 직후 발송 액션 표시

공통 동작:

- `test-smtp`: 저장된 설정으로 Nodemailer `transporter.verify()`를 실행합니다.
- `send-email`: 발행 직후 저장된 보안 HTML을 첨부해 단일 수신자에게 발송합니다.
- `send-email-from-history`: 발행 이력의 저장 파일을 첨부해 단일 수신자에게 발송합니다.

Gmail SMTP는 `smtp.gmail.com:587` STARTTLS와 Google 앱 비밀번호를 사용합니다. 앱 비밀번호는 저장 전에 NFKC 정규화와 공백 제거를 거친 뒤 16자만 허용합니다. Generic SMTP는 host, port, STARTTLS 필수 여부, 발신자 주소, 사용자 이름, 비밀번호를 설정할 수 있습니다.

두 채널 모두 비밀번호 원문을 renderer로 반환하지 않고 Electron `safeStorage.encryptString()` 결과를 base64로 저장합니다. 발송 전 main process가 발행 이력의 `documentId`, `outputPath`, `packageSha256`를 확인하고, 현재 파일 내용의 SHA-256이 이력의 해시와 일치할 때만 첨부합니다.

메일 본문은 고정 안내문만 포함합니다. 문서 평문, PIN, PIN 해시, DEK, KEK는 메일 본문에 넣지 않습니다.

## 발행 정책

기본 발행 정책은 PIN 길이, PIN 강도, KDF 반복 횟수, PIN 확인 일치 여부를 검사합니다. `policy.strict-pin`을 활성화하면 다음 조건이 추가됩니다.

- PIN 10자 이상
- PBKDF2 1,000,000회 이상
- 수신자, 문서번호, 표시용 만료일 필수
- 워터마크 문구 필수

여러 정책 profile이 활성화되면 가장 강한 최소 PIN 길이, 가장 강한 최소 KDF 반복 횟수, 필수 메타데이터 합집합, 워터마크 요구 여부를 보수적으로 병합합니다. 자세한 내용은 [docs/publish-policy-plugins.md](docs/publish-policy-plugins.md)를 참고하세요.

## 브랜딩 preset

`branding.company-defaults`는 문서 기본정보와 viewer 표현을 위한 정적 preset을 제공합니다.

브랜딩 preset이 적용할 수 있는 항목:

- 발행자 기본값
- 워터마크 문구
- 오프라인 viewer와 편집/미리보기의 안전한 색상 token

viewer theme 값은 literal `#rrggbb` 색상만 허용합니다. 원격 이미지, 외부 폰트, 외부 script, 네트워크 URL은 preset에 포함할 수 없습니다. 적용된 viewer theme은 암호화된 private metadata 안에 저장되므로, 생성된 HTML은 PIN으로 복호화되기 전까지 브랜드 색상도 노출하지 않습니다.

## 보안 모델

이 시스템은 서버 인증 없이 문서 자체를 암호화합니다. 입력 PIN을 저장된 값과 비교하지 않고, 복호화 성공 여부로 PIN이 맞는지 검증합니다.

쉽게 말해 발행할 때는 무작위 문서 키인 DEK로 본문을 잠그고, 사용자가 정한 PIN에서 만든 KEK로 그 DEK를 한 번 더 잠급니다. 사용자가 문서를 열 때는 입력한 PIN으로 같은 KEK를 다시 만들어 DEK를 풀고, 그 DEK로 본문을 복호화합니다.

```text
PIN -> PBKDF2-HMAC-SHA-256 -> KEK
문서 본문 -> AES-256-GCM with DEK
DEK -> wrapped by KEK
```

잘못된 PIN, 메타데이터 변조, 암호문 변조는 동일한 공개 실패 메시지로 처리합니다. 발행 이력은 패키지 SHA-256을 보관해 저장 후 파일 변조를 감지합니다.

암호화 관련 용어는 본문 흐름을 해치지 않도록 문서 하단의 [암호화 용어 쉬운 설명](#암호화-용어-쉬운-설명)에 모았습니다.

저장하지 않는 항목:

- PIN 원문
- PIN 해시
- 평문 본문
- 평문 DEK
- 평문 KEK
- SMTP 비밀번호 원문

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

`audit.integrity.report`를 활성화하면 발행 이력의 저장 파일을 다시 읽어 SHA-256을 계산하고, 발행 당시 기록된 해시와 비교합니다. 감사 결과에는 PIN, 평문 본문, 암호화 키가 포함되지 않습니다.

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

테스트는 PIN 정책, 패키지 암호화/복호화, viewer 보안, 발행 이력 저장, 플러그인 registry/store, 문서 템플릿, 발행 정책, 브랜딩 preset, SMTP 설정 저장, SMTP 전송 액션, SMTP 오류 마스킹, 패키지 해시 무결성, 정적 보안 제약을 검증합니다.

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

6자리 이상 15자리 이내 PIN은 편의형 오프라인 암호입니다. 고보안 문서에는 서버 인증, 전자서명, 신뢰된 로컬 뷰어 앱, OS 코드서명 정책을 함께 사용해야 합니다.

## 암호화 용어 쉬운 설명

README 본문에는 보안 설계를 정확하게 표현하기 위해 표준 용어를 사용했습니다. 아래 설명은 구현 세부를 모두 담기보다, 처음 읽는 사람이 의미를 빠르게 이해할 수 있도록 쉬운 표현으로 정리한 용어집입니다.

| 용어 | 쉬운 설명 |
| --- | --- |
| WebCrypto | 브라우저와 Electron에서 제공하는 표준 암호화 기능입니다. 직접 암호화 알고리즘을 구현하지 않고 검증된 내장 기능을 사용합니다. |
| PIN | 문서를 열 때 입력하는 암호입니다. 이 앱은 PIN 원문을 저장하지 않고, PIN에서 암호화 키를 만들어 문서를 풀 수 있는지만 확인합니다. |
| `crypto.getRandomValues()` | 예측하기 어려운 난수를 만드는 WebCrypto 기능입니다. 보안용 난수에는 일반 난수 함수인 `Math.random()`을 쓰지 않습니다. |
| KDF | 비밀번호나 PIN처럼 사람이 입력하는 값을 암호화 키로 바꾸는 함수입니다. 바로 키로 쓰지 않고 계산을 거쳐 더 안전한 키로 만듭니다. |
| PBKDF2-HMAC-SHA-256 | PIN에서 KEK를 만들 때 사용하는 KDF입니다. 같은 계산을 많이 반복해 PIN 추측 공격을 느리게 만듭니다. |
| salt | PIN에서 키를 만들 때 함께 섞는 무작위 값입니다. 같은 PIN을 써도 문서마다 다른 키가 나오게 해 미리 계산해 둔 공격을 어렵게 합니다. |
| KEK | Key Encryption Key의 줄임말입니다. 문서 본문을 직접 잠그는 키가 아니라, DEK를 잠그기 위해 PIN에서 만들어지는 키입니다. |
| DEK | Data Encryption Key의 줄임말입니다. 실제 문서 본문을 암호화하는 무작위 키입니다. |
| DEK/KEK 분리 구조 | 문서는 DEK로 잠그고, DEK는 PIN에서 만든 KEK로 다시 잠그는 구조입니다. 문서 본문 키와 사용자 PIN 기반 키의 역할을 분리합니다. |
| AES-256-GCM | 문서 본문 암호화에 사용하는 인증 암호화 알고리즘입니다. 데이터를 숨기는 기능과 변조 여부를 확인하는 기능을 함께 제공합니다. |
| IV | AES-GCM 암호화마다 새로 쓰는 무작위 시작값입니다. 같은 내용이라도 암호화 결과가 매번 달라지게 합니다. |
| 인증 태그 | AES-GCM이 만드는 변조 검사용 값입니다. PIN이 틀리거나 파일이 바뀌면 이 값 검증이 실패해 복호화가 중단됩니다. |
| DEK wrapping | DEK를 KEK로 다시 암호화해 감싸는 과정입니다. 문서 본문 키를 파일 안에 평문으로 넣지 않기 위한 처리입니다. |
| PIN 해시 | PIN을 해시 함수에 넣어 만든 값입니다. 해시도 추측 공격의 단서가 될 수 있으므로 이 앱은 PIN 해시를 저장하지 않습니다. |
| SHA-256 | 데이터를 고정 길이의 지문처럼 바꾸는 해시 함수입니다. 패키지 SHA-256은 파일이 같은지 확인하기 위한 식별값이며, 원문을 되돌릴 수 있는 암호화가 아닙니다. |
| CSP `connect-src 'none'` | HTML 뷰어가 외부 네트워크로 연결하지 못하게 하는 브라우저 보안 정책입니다. 문서나 입력값이 밖으로 나갈 가능성을 줄입니다. |
| 전자서명 | 파일이나 데이터가 신뢰할 수 있는 작성자에게서 왔고 중간에 바뀌지 않았는지 확인하는 기술입니다. 암호화처럼 내용을 숨기는 기능과는 목적이 다릅니다. |
| 코드서명 | 앱 설치 파일이나 실행 파일의 제작자를 확인하고 변조 여부를 판단하는 서명입니다. 사용자가 신뢰할 수 있는 앱인지 확인하는 데 도움을 줍니다. |

## 문서

- [docs/secure-doc-pin-plan.md](docs/secure-doc-pin-plan.md): PIN 기반 보안 문서 설계 노트
- [docs/plugin-api.md](docs/plugin-api.md): 플러그인 manifest, 권한, 기여 지점 계약
- [docs/document-templates.md](docs/document-templates.md): 문서 템플릿 registry와 template-pack 흐름
- [docs/publish-policy-plugins.md](docs/publish-policy-plugins.md): 발행 정책 플러그인 동작
