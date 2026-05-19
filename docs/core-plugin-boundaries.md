# Core and Plugin Boundaries

Secure Doc separates features into core security surfaces and plugin extension points. The rule is simple: if document issuance or offline viewing depends on it for trust, it belongs in core.

## Core Defaults

Core behavior is always available and is not controlled by plugin enablement:

- Document editing, sanitized preview, and safe HTML body preparation
- Document metadata required for issuance history and viewer display
- PIN normalization, strength checks, secure generation, and confirmation matching
- WebCrypto package encryption with PBKDF2-HMAC-SHA-256, AES-256-GCM, and DEK/KEK separation
- Single-file offline HTML viewer with no external resources
- Viewer CSP, including `connect-src 'none'`
- Pre-publish decryptability checks and secret/plaintext exclusion checks
- Publish history with package SHA-256, KDF, content algorithm, output path, and platform metadata
- Core package integrity verification from publish history
- Core publish policy: PIN 6-15 characters, PBKDF2 at least 1,000,000 iterations, recipient/document number/display expiry metadata, and watermark text

Core behavior must not store PINs, PIN hashes, plaintext bodies, DEKs, or KEKs.

## Plugin Extensions

Plugins are suitable for capabilities that do not change the core security model:

- Delivery channels such as SMTP, SMS, or approved first-party connectors
- Static document template packs
- Safe document authoring helpers that still pass through sanitizer and package rules
- Branding presets for issuer, watermark defaults, and literal `#rrggbb` viewer color tokens
- Operational reports that read reviewed history/package metadata without exposing secrets
- Business-system integrations that reference issued packages through main-process mediation

Plugins are built-in manifests plus allowlisted main-process behavior. The renderer never executes plugin implementation code.

## Forbidden Plugin Surfaces

General plugins must not replace or relax these surfaces:

- Encryption algorithm selection
- PIN processing, KDF, or key handling
- DEK/KEK package structure
- Offline viewer HTML implementation
- Viewer CSP or external resource restrictions
- Package integrity verification
- Legal/electronic signature trust models
- KMS/HSM, multi-recipient key wrapping, SIEM export, or server-side AI inspection without a separate threat model

If one of these capabilities is needed, implement it as core, an enterprise core module, or a constrained first-party connector with a dedicated security design.

## #24 Boundary Decisions

- `audit.integrity.report` is retired. Package integrity verification is a core history action exposed through `window.secureDoc.verifyPackageIntegrity()`.
- `policy.strict-pin` is retired. Its requirements are now the core default publish policy.
- `delivery.smtp.gmail`, `delivery.smtp.generic`, `template-pack.business-samples`, and `branding.company-defaults` remain plugins.
- Future `policy.*` plugins may only add stricter requirements than the core policy.
- Future `audit.*` plugins may report on reviewed metadata, but they must not replace core package integrity verification.
