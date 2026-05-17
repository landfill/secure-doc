# Publish Policy Plugins

Issue #12 adds declarative publish policy profiles as a plugin contribution point.

## Built-In Policy

`policy.strict-pin` contributes the `strict-pin` policy profile. When enabled, the publish dialog enforces:

- PIN length of at least 10 characters
- PBKDF2 iterations of at least 1,000,000
- required recipient, document number, and expiry fields
- required watermark text

The plugin stores no PIN, PIN hash, plaintext body, DEK, or KEK. It only contributes validation requirements.

## Security Floor

Policy profiles can make publishing stricter but cannot weaken the existing floor:

- `minimumPinLength` must be between the core PIN minimum and maximum.
- `minimumKdfIterations` must be at least the compatibility KDF floor.
- `requiredMetadata` must use the reviewed metadata allowlist.

These rules are enforced by plugin registry contract tests.

## Renderer Flow

The renderer resolves enabled `policyProfiles` through `window.secureDoc.plugins.getContributions()`.
Before issuing a package, it evaluates the effective policy and blocks publish when any requirement fails. The user sees actionable messages such as missing metadata or an insufficient KDF iteration count, without exposing secrets or document plaintext.

Multiple active policy profiles are merged conservatively by taking the strongest minimum PIN length, strongest minimum KDF iteration count, the union of required metadata fields, and any watermark requirement.
