# Plugin API Contract

Secure Doc Admin supports plugins as packaged, built-in extension points. The current contract does not load arbitrary external code. A plugin is a manifest plus allowlisted main-process behavior that the renderer can discover and invoke through the preload bridge.

## Current Scope

- Plugins are shipped with the app as built-in manifests in `src/shared/plugins.ts`.
- Plugins are disabled by default unless their id is stored in the local plugin state.
- The renderer never executes plugin implementation code.
- Network, file, secret, and package access happens only in the Electron main process.
- Plugin settings views must not return raw secrets.
- Viewer HTML, encryption algorithms, PIN handling, and offline CSP are core security surfaces and are not replaceable by plugins.

External plugin loading, remote registries, and runtime JavaScript from plugin packages are outside the current scope.

## Manifest Shape

```ts
type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  category: "delivery" | "template" | "audit" | "branding" | "policy";
  permissions: PluginPermission[];
  contributes: PluginContributes;
};
```

The stable categories are:

- `delivery`: sends or copies already-issued secure HTML packages.
- `template`: contributes static document templates or safe template metadata.
- `audit`: reads publish-history metadata and, when permitted, verifies package files.
- `branding`: contributes safe brand presets for metadata, watermark, or viewer presentation.
- `policy`: contributes stricter publish-time validation presets.

Plugin ids must use lowercase dot/dash segments and match the category prefix:

- `delivery.*`
- `template-pack.*`
- `audit.*`
- `branding.*`
- `policy.*`

Examples: `delivery.smtp.gmail`, `template-pack.legal`, `audit.export.csv`, `branding.company-defaults`, `policy.strict-pin`.

## Permissions

Permissions are declarative and testable. They drive user-facing disclosure and must match the main-process surface actually used by the plugin.

| Permission | Meaning |
| --- | --- |
| `network:smtp` | Opens SMTP connections from the main process. |
| `secret:safeStorage` | Stores or reads encrypted plugin secrets with Electron `safeStorage`. |
| `package:read` | Reads an issued secure HTML package from disk after history/hash validation. |
| `history:read` | Reads publish-history metadata. |
| `history:write` | Writes publish-history metadata or plugin delivery status. |
| `ui:settings` | Adds a plugin settings panel. |
| `ui:publish-action` | Adds an action to the publish flow. |

Required contribution permissions:

- `settingsPanel` requires `ui:settings`.
- `publishActions` requires `ui:publish-action`.
- `historyActions` requires `history:read`.
- `templates` requires no special permission by default because templates must be static data with no network or secret access.

Feature-specific permissions still apply. For example, an SMTP delivery plugin also needs `network:smtp`, `secret:safeStorage`, `package:read`, and usually `history:read`.

## Contributions

```ts
type PluginContributes = {
  settingsPanel?: boolean;
  publishActions?: PluginActionContribution[];
  templates?: PluginTemplateContribution[];
  historyActions?: PluginActionContribution[];
};
```

Contribution ids use the same lowercase dot/dash segment rule as plugin ids and must be unique within each contribution point for a plugin.

### `settingsPanel`

Declares that the plugin has a renderer settings panel. The renderer can show first-party UI for known built-in plugins, but settings are saved and cleared through `window.secureDoc.plugins`.

### `publishActions`

Declares actions shown after a secure HTML package has been issued. The action payload must refer to the saved package and publish metadata; the renderer must not send plaintext document bodies, PINs, PIN hashes, DEKs, or KEKs.

### `historyActions`

Declares actions available from publish history. The main process must resolve the selected history record, verify `documentId` and `outputPath`, read the package only when allowed, and compare file content with `packageSha256` before passing it to a delivery or audit action.

### `templates`

Declares static templates or template ids. Core templates are implemented in `src/shared/documentTemplates.ts`, and future template packs should use the same static-data or safe-builder shape. Template content must be sanitized before injection into the editor and must not contain real sensitive examples, PINs, PIN hashes, keys, executable markup, or remote resources.

## IPC Contract

The renderer accesses plugins only through the preload API:

```ts
window.secureDoc.plugins.list();
window.secureDoc.plugins.setEnabled(pluginId, enabled);
window.secureDoc.plugins.getContributions();
window.secureDoc.plugins.getSettings(pluginId);
window.secureDoc.plugins.saveSettings(pluginId, values);
window.secureDoc.plugins.clearSettings(pluginId);
window.secureDoc.plugins.runAction(pluginId, actionId, payload);
```

Main-process handlers must validate `pluginId`, `actionId`, and payload shape. Unsupported plugin ids or action ids must fail closed. Plugin action errors should be mapped to safe user messages that do not include credentials, PINs, document bodies, package contents, or cryptographic material.

## Adding a Contribution Type

When adding a new contribution type, update these surfaces together:

1. `src/shared/plugins.ts`: add the contribution type, resolved contribution type if needed, and required permissions.
2. `src/shared/desktopApi.ts`: extend payload/result types only if renderer/main IPC needs a new shape.
3. `src/main/main.ts`: add an allowlisted handler or route to a plugin service.
4. `src/preload/preload.ts`: expose the minimum renderer API needed.
5. `src/renderer/src/App.tsx`: render disclosure UI and action controls for known built-in plugins.
6. `tests/pluginRegistry.test.ts`: update category, permission, id, and contribution contract coverage.
7. Add service-level tests for payload validation, permission checks, secret handling, and safe error mapping.

Do not add a contribution type just to mirror UI state. Add it only when it creates a stable integration point that future built-in plugins can share.

## Regression Expectations

The registry contract tests must fail when:

- A built-in plugin id does not match its category prefix.
- A contribution lacks its required permission.
- A plugin duplicates contribution ids within one contribution point.
- A contribution id uses uppercase, whitespace, or unsupported characters.

Security tests must continue to reject browser storage, weak random generation, numeric PIN inputs, raw secret persistence, and viewer/network policy regressions.
