# Secure Doc Admin

WebCrypto 기반 오프라인 보안문서 발행 및 열람 시스템입니다.

관리자는 Electron 데스크톱 앱에서 문서를 작성하고 6자리 이상 15자리 이내 PIN을 설정해 암호화된 단일 HTML 파일을 발행합니다. 사용자는 발행된 HTML 파일을 브라우저에서 열고, 별도로 전달받은 PIN을 입력해야 문서를 복호화해 볼 수 있습니다.

## 주요 기능

- Electron + React/TypeScript 기반 Admin 발행도구
- macOS universal DMG, Windows x64 NSIS 설치 파일 생성
- Tiptap 기반 WYSIWYG 본문 에디터와 HTML 보기 모드
- 6자리 이상 15자리 이내 PIN 정책 적용
- `crypto.getRandomValues()` 기반 PIN 자동 생성
- PBKDF2-HMAC-SHA-256 기반 KEK 유도
- AES-256-GCM 기반 본문 암호화
- DEK/KEK 분리 구조
- 발행 직후 자체 복호화 테스트
- 외부 리소스 없는 단일 HTML 뷰어 생성
- CSP `connect-src 'none'` 적용
- 발행 이력 저장
- PIN 원문, PIN 해시, DEK, KEK, 평문 본문 저장 금지

## 보안 모델

이 시스템은 서버 인증 없이 문서 자체를 암호화합니다. 입력 PIN을 저장된 값과 비교하지 않고, 다음 흐름으로 복호화 성공 여부를 검증합니다.

```text
PIN -> PBKDF2 -> KEK
DEK -> 문서 본문 AES-256-GCM 암호화
KEK -> DEK wrapping
```

복호화 시 PIN이 틀리거나 문서가 변조되면 AES-GCM 인증 태그 검증이 실패합니다. 사용자에게는 상세 원인을 노출하지 않고 아래 메시지만 표시합니다.

```text
PIN이 올바르지 않거나 문서가 손상되었습니다.
```

6자리 이상 15자리 이내 PIN은 편의형 오프라인 암호입니다. 고보안 문서에는 서버 인증, 전자서명, 신뢰된 로컬 뷰어 앱, OS 코드서명 정책을 함께 사용해야 합니다.

암호화 관련 용어는 본문 흐름을 해치지 않도록 문서 하단의 [암호화 용어 쉬운 설명](#암호화-용어-쉬운-설명)에 모았습니다.

## 요구사항

- Node.js 22 이상
- npm 10 이상
- macOS DMG 빌드: macOS 환경 필요
- Windows 설치 파일 빌드: macOS cross-build 가능, 단 electron-builder가 필요한 Windows 빌드 도구를 다운로드합니다.

## 설치

```bash
npm install
```

## 개발 실행

```bash
npm run dev
```

`npm install`은 설치 후 Electron 런타임 바이너리도 내려받습니다. 네트워크, 캐시, 설치 스크립트 차단 때문에 `Electron uninstall` 또는 `Electron failed to install correctly` 오류가 나오면 아래 명령으로 복구한 뒤 다시 실행하세요.

```bash
npm run fix:electron
npm run dev
```

## 테스트

```bash
npm test
```

현재 테스트는 다음을 검증합니다.

- 앞자리 `0`이 있는 PIN 보존
- 취약 PIN 차단
- `Math.random()` 미사용
- 올바른 PIN 복호화 성공
- 잘못된 PIN 및 메타데이터 변조 실패
- 평문 본문과 PIN이 HTML 패키지에 포함되지 않음
- 동일 PIN으로 여러 문서 발행 시 salt, IV, wrapped DEK가 모두 다름
- `localStorage`, `sessionStorage`, `type="number"` 미사용

## 프로덕션 빌드

```bash
npm run build
```

빌드 산출물은 `out/`에 생성됩니다.

## 배포 패키지 생성

macOS universal DMG:

```bash
npm run make:mac
```

Windows x64 NSIS 설치 파일:

```bash
npm run make:win
```

패키징 산출물은 `release/`에 생성됩니다.

현재 기본 설정은 개발 검증용입니다. 운영 배포 전에는 다음을 설정해야 합니다.

- macOS Developer ID 코드서명
- macOS notarization
- Windows 코드서명 인증서
- 앱 아이콘
- 업데이트 배포 정책

## 발행 이력 저장

발행 이력은 Electron userData 경로에 저장됩니다. 런타임에서 `node:sqlite`를 사용할 수 있으면 SQLite를 사용하고, 사용할 수 없으면 JSONL fallback을 사용합니다.

저장하는 항목:

- 문서 ID
- 제목
- 발행자
- 발행일
- 표시용 만료일
- 패키지 SHA-256
- KDF 알고리즘 및 반복 횟수
- 본문 암호화 알고리즘
- 발행 작업자
- 저장 파일 경로
- 플랫폼

저장하지 않는 항목:

- PIN 원문
- PIN 해시
- 평문 본문
- 평문 DEK
- 평문 KEK
- 암호화 전 개인정보 원문

## 문서

상세 플랜은 [docs/secure-doc-pin-plan.md](docs/secure-doc-pin-plan.md)에 있습니다.

## 보안 한계

오프라인 단일 HTML 구조는 다음을 보장하지 않습니다.

- 이미 배포된 파일 회수
- 서버 기반 열람 로그
- 강제 만료
- 실질적인 실패 횟수 제한
- 캡처 방지
- HTML/JS 뷰어 코드 변조 방지

특히 공격자가 HTML 파일 자체를 변조할 수 있는 환경에서는 입력 PIN 탈취 위험이 있습니다. 고보안 환경에서는 전자서명 검증 또는 신뢰된 로컬 뷰어 앱을 추가해야 합니다.

## 암호화 용어 쉬운 설명

README 본문에는 보안 설계를 정확하게 표현하기 위해 표준 용어를 사용했습니다. 아래 설명은 구현 세부를 모두 담기보다, 처음 읽는 사람이 의미를 빠르게 이해할 수 있도록 쉬운 표현으로 정리한 용어집입니다.

| 용어 | 쉬운 설명 |
| --- | --- |
| WebCrypto | 브라우저와 Electron에서 제공하는 표준 암호화 기능입니다. 직접 암호화 알고리즘을 구현하지 않고 검증된 내장 기능을 사용합니다. |
| PIN | 문서를 열 때 입력하는 숫자 암호입니다. 이 앱은 PIN 원문을 저장하지 않고, PIN에서 암호화 키를 만들어 문서를 풀 수 있는지만 확인합니다. |
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
