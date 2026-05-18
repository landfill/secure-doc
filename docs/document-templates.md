# Document Template Registry

Issue #4 introduces document templates as first-class data instead of renderer-local sample strings.

## Core Templates

Core templates live in `src/shared/documentTemplates.ts` and are available without enabling a plugin:

- `core.notice`: 안내문/공지문
- `core.contract`: 계약/동의 문서
- `core.policy`: 정책/규정 문서
- `core.general`: 일반 보안 문서

The trusted registry also keeps plugin-pack structures such as insurance certificate and billing notice. They are not part of the default picker until an enabled template-pack plugin contributes their ids.

## Data Contract

Each template has:

- `id`: stable lowercase template id
- `name` and `description`: renderer display text
- `category`: `notice`, `contract`, `policy`, or `general`
- `defaultMetadata`: title, document type, watermark, and admin description defaults
- `buildBodyHtml(metadata)`: safe builder that escapes metadata before interpolation

Template builders must not store PINs, PIN hashes, DEKs, KEKs, plaintext examples from real customers, remote URLs, or executable markup.

## Renderer Flow

The document screen lets the user choose and apply a template. Applying a template:

- merges template metadata defaults into the current metadata
- builds body HTML through the shared registry
- sanitizes the HTML before injecting it into Tiptap
- asks for confirmation before replacing an existing non-empty body

After a template is applied, metadata fields that are part of the body placeholder set keep the body synchronized until the user manually edits the body.

Changing the document type is metadata-only. It can move the template selector to a matching template for discoverability, but it must not apply template defaults or replace the body. The renderer marks whether the selected template is already applied to the body so the next action stays visible. Body replacement remains an explicit template-apply action.

## Template Packs

Template-pack plugins should contribute template ids through `contributes.templates`. The renderer resolves those ids against the trusted bundled template registry before showing them. Unknown ids are ignored, and the content itself should remain static data or a safe builder shipped with the trusted app bundle; renderer code should not execute arbitrary third-party plugin code.

Template packs should require no network, secret storage, or package read permission unless a future design explicitly adds a reviewed capability.
