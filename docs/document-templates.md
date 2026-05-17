# Document Template Contract

Core document templates are first-party editor presets. They provide metadata defaults and safe HTML body structure, then the renderer sanitizes the HTML before it enters the editor.

Current core templates:

- `core.notice-secure-open`: secure document opening notice.
- `core.contract-basic`: service and cooperation contract.
- `core.insurance-certificate`: insurance-style certificate.
- `core.notice-billing`: service notice.
- `core.general-secure-document`: general secure document.

Template rules:

- Templates must contain structure and placeholders only.
- Templates must not include real sensitive document bodies, PINs, PIN hashes, DEKs, KEKs, or credentials.
- Applying a template to an edited body requires explicit overwrite confirmation.
- Template HTML must pass the existing renderer sanitizer before editing and packaging.
- Future template packs should use `template-pack.*` plugin ids and `contributes.templates` without network or secret permissions.

When adding a template, update the renderer registry, add or update plugin registry tests for the contribution contract, and run `npm test` plus `npm run build`.
