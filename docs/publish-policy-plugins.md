# Publish Policy Plugins

Publish policy profiles are declarative plugin contributions that can only make publishing stricter.

## Core Policy

The publish policy is now a core default. It is always enforced before a package is issued:

- PIN length of at least 6 characters and at most 15 characters
- PBKDF2 iterations of at least 1,000,000
- required recipient, document number, and display expiry fields
- required watermark text

This core policy stores no PIN, PIN hash, plaintext body, DEK, or KEK.

## Plugin Policy Profiles

Policy plugins may still contribute `policyProfiles`, but only as additional requirements. A profile can require a longer PIN, a higher PBKDF2 iteration count, additional reviewed metadata fields, or a watermark. It cannot lower the core floor.

Contract rules:

- `policy.strict-pin` is a retired plugin id and must not be reintroduced.
- `minimumPinLength` must be between 6 and the core maximum PIN length.
- `minimumKdfIterations` must be at least 1,000,000.
- `requiredMetadata` must use the reviewed metadata allowlist.
- Policy profiles cannot replace PIN handling, KEK derivation, encryption, viewer HTML, CSP, or package integrity behavior.

These rules are enforced by plugin registry contract tests.

## Renderer Flow

The renderer resolves enabled `policyProfiles` through `window.secureDoc.plugins.getContributions()`.
Before issuing a package, it evaluates the core policy plus enabled profile requirements and blocks publish when any requirement fails. The user sees actionable messages such as missing metadata or an insufficient KDF iteration count, without exposing secrets or document plaintext.

Multiple active policy profiles are merged conservatively by taking the strongest minimum PIN length, strongest minimum KDF iteration count, the union of required metadata fields, and any watermark requirement.
