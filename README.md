# Secure Doc Admin

WebCrypto 기반 오프라인 보안문서 발행 및 열람 시스템입니다.

관리자는 Electron 데스크톱 앱에서 문서를 작성하고 6자리 숫자 PIN을 설정해 암호화된 단일 HTML 파일을 발행합니다. 사용자는 발행된 HTML 파일을 브라우저에서 열고, 별도로 전달받은 PIN을 입력해야 문서를 복호화해 볼 수 있습니다.

## 주요 기능

- Electron + React/TypeScript 기반 Admin 발행도구
- macOS universal DMG, Windows x64 NSIS 설치 파일 생성
- 6자리 숫자 PIN 정책 적용
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

6자리 PIN은 편의형 오프라인 암호입니다. 고보안 문서에는 서버 인증, 전자서명, 신뢰된 로컬 뷰어 앱, OS 코드서명 정책을 함께 사용해야 합니다.

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

