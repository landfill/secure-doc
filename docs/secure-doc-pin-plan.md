# 6-15자 PIN 기반 오프라인 보안문서 발행/열람 시스템 개정 플랜

## Summary
- Admin 발행도구는 Electron + React/TypeScript 단일 코드베이스로 구현하고, 배포물은 macOS용 / Windows용 개별 설치 파일로 제공한다.
- 문서 열람 암호는 패스프레이즈나 긴 코드가 아니라 6자리 이상 15자리 이내 PIN으로 제한한다.
- 암호화 구조는 `PIN -> PBKDF2 -> KEK`, `DEK -> 본문 AES-256-GCM 암호화`, `KEK -> DEK wrapping`을 사용한다.
- 짧은 PIN은 오프라인 대입 공격에 취약하므로 MVP 기본 KDF 비용은 PBKDF2-HMAC-SHA-256 1,000,000 iterations로 상향하고, 저사양 호환용으로 600,000 선택지를 둔다.

## Key Changes
- Admin 앱은 macOS Apple Silicon/Intel universal DMG와 Windows x64 NSIS 설치 파일로 각각 빌드한다.
- 입력 PIN은 6자리 이상 15자리 이내 문자열이며, 숫자, 문자, 기호를 허용한다.
- PIN 입력은 `type="password"`를 사용하고 `type="number"`는 사용하지 않는다. 6-15자 검증은 UTF-16 code unit 기준의 네이티브 `minlength`/`maxlength`가 아니라 JS 정책 검사에서 code point 기준으로 수행한다.
- 자동 PIN 생성은 `crypto.getRandomValues()` 기반 균등 난수로 수행한다.
- 직접 입력 시 `000000`, `aaaaaa`, `123456`, `654321` 같은 명백한 취약 PIN은 차단한다.
- UI 문구는 "키 강도 검사"가 아니라 "PIN 정책 검사"로 표현한다.
- 관리자에게 "6자리 이상 15자리 이내 PIN은 편의형 암호이며, 고보안 문서는 서버 인증/전자서명/신뢰된 뷰어 앱이 필요하다"는 보안 안내를 표시한다.
- PIN 원문, PIN 해시, DEK, KEK, 평문 본문은 저장하지 않는다.

## Interfaces
패키지 JSON의 `ui`에는 PIN 정책을 명시한다.

```json
{
  "ui": {
    "keyLabel": "문서 열람 PIN",
    "helpText": "별도 안내받은 6자리 이상 15자리 이내 PIN을 입력하세요.",
    "keyPolicy": {
      "type": "pin-code",
      "minLength": 6,
      "maxLength": 15,
      "normalization": "nfkc-trim",
      "allowedCharacters": "printable"
    }
  }
}
```

KDF 기본값은 PIN용 프로필로 고정한다.

```json
{
  "crypto": {
    "kdf": {
      "name": "PBKDF2",
      "hash": "SHA-256",
      "iterations": 1000000,
      "salt": "base64url..."
    }
  }
}
```

사용자 오류 메시지는 상세 원인을 노출하지 않는다.

```text
PIN이 올바르지 않거나 문서가 손상되었습니다.
```

## Implementation Plan
- Electron + React/TypeScript로 문서 작성, 미리보기, PIN 설정, 암호화, HTML 생성, 발행 이력 저장 화면을 구현한다.
- macOS/Windows 빌드 파이프라인을 분리하고, 각 OS별 코드서명/패키징 설정을 둔다.
- 발행 이력은 로컬 SQLite에 저장하되, 런타임이 SQLite를 제공하지 않는 경우 JSONL fallback을 사용한다.
- DEK/KEK 분리 구조, AES-256-GCM, 256-bit salt, 96-bit IV, Base64URL 인코딩을 유지한다.
- PIN에서 KEK를 유도할 때 PBKDF2-HMAC-SHA-256을 사용한다.
- 발행 직후 같은 PIN으로 자체 복호화 테스트를 수행하고 실패 시 파일 생성을 막는다.
- 단일 HTML 뷰어는 외부 리소스를 사용하지 않고, `connect-src 'none'` CSP를 포함한다.
- 복호화 전 DOM에는 평문 본문을 넣지 않고, 새로고침 시 PIN을 다시 입력해야 한다.

## Test Plan
- macOS와 Windows에서 앱 실행, 문서 작성, 6-15자 PIN 직접 입력, 자동 생성, HTML 발행을 검증한다.
- `type=number` 미사용, 문자/기호 PIN 허용, 취약 PIN 차단을 테스트한다.
- 발행 이력에 PIN/평문/키 자료가 저장되지 않는지 확인한다.
- 올바른 PIN은 복호화 성공, 잘못된 PIN/변조된 salt/iv/ciphertext는 동일 오류 메시지로 실패한다.
- 소스 보기와 패키지 JSON에 평문 본문, PIN, PIN 해시, DEK/KEK가 없는지 검사한다.
- Chrome, Edge, Safari, Firefox 최신 2개 메이저 버전에서 WebCrypto 복호화를 검증한다.
- 동일 PIN으로 여러 문서 발행 시 salt, IV, DEK가 모두 다른지 확인한다.
- CSP로 외부 네트워크 요청이 차단되는지 확인한다.
- XSS payload가 sanitizer 또는 안전 렌더러를 통과해도 실행되지 않는지 확인한다.

## Assumptions
- MVP는 Electron 단일 코드베이스 + macOS/Windows 개별 배포물을 기본 선택으로 한다.
- 6-15자 PIN 요구사항은 제품 요구사항으로 수용하되, 보안 등급은 편의형 오프라인 암호로 명시한다.
- 오프라인 단일 HTML 구조에서는 회수, 열람 로그, 강제 만료, 실질적인 실패 횟수 제한을 보장하지 않는다.
