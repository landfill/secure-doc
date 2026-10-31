# HTML File Attachment / HTML 파일 첨부

## Purpose / 목적

Issuers can encrypt an existing HTML file (for example an internal confidential report exported from another tool) without re-authoring it in the editor. The file keeps its own CSS and layout in the viewer.

이미 만들어진 HTML 파일(다른 도구에서 내보낸 사내 대외비 보고서 등)을 편집기에서 다시 작성하지 않고 그대로 암호화한다. 뷰어에서 원본의 CSS와 레이아웃이 유지된다.

## Content Format / 콘텐츠 형식

`SecureDocPlainContent.format` has two values. The value is inside the AES-GCM ciphertext, so it is authenticated with the body.

| format | Source | Viewer rendering |
|---|---|---|
| `html` | Editor body | Allowlist sanitizer, rendered inline |
| `html-attachment` | Selected `.html`/`.htm` file, byte-for-byte text | `srcdoc` of a sandboxed iframe |

The crypto structure (PBKDF2 KEK, AES-256-GCM DEK, AAD, package schema/version) is unchanged. The public `doc.format` stays `html`, so the outer package does not reveal which content type it carries.

## Viewer Isolation / 뷰어 격리

The viewer renders attachments only in:

```html
<iframe sandbox="" referrerpolicy="no-referrer" ...></iframe>
```

- `sandbox=""` grants no permissions: no scripts, forms, popups, top-level navigation, downloads, or same-origin access. The attachment cannot read the viewer DOM, the package JSON, or the PIN field.
- `srcdoc` documents inherit the viewer CSP (`default-src 'none'`, `connect-src 'none'`, `img-src 'self' data: blob:`, ...). External images, stylesheets, fonts, and scripts are blocked; only resources embedded in the file (inline `<style>`, `data:` images/fonts) render.
- The viewer CSP is not relaxed. `frame-src 'none'` stays; `srcdoc` is not a network navigation and is not blocked by it (verified in Chromium).
- The watermark layer sits above the iframe with `pointer-events: none`.

The admin app preview uses the same `sandbox=""` + `srcdoc` iframe.

## Issuer Warnings / 발행자 경고

`analyzeHtmlAttachment()` (`src/shared/htmlAttachment.ts`) flags, before publishing:

- scripts (`<script>`, inline `on*=` handlers, `javascript:` URLs) — these will not run in the viewer
- external resources (`src`/`href` to `http(s)://` or `//` on resource tags, CSS `url()`/`@import`) — these will not load

These are heuristics for user guidance only. Isolation does not depend on them.

## Limits / 제약

- Script-driven UI (JS tabs, accordions, charts drawn at load time) does not work. CSS-only effects (`:hover`, animations, `<details>`, `:target`) work.
- Maximum file size: 20 MB (`MAX_HTML_ATTACHMENT_BYTES`). The base64 package is about 1.33x the file.
- Printing prints the visible frame area only.
- Firefox and Safari behavior of `srcdoc` under `frame-src 'none'` has not been verified yet.
- Allowing scripts (`allow-scripts` without `allow-same-origin`) is deliberately not offered: a script inside the decrypted document could leak its content through channels CSP does not fully cover (e.g. WebRTC).
