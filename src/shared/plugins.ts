export type PluginCategory = "delivery" | "template" | "audit" | "branding" | "policy";

export type PluginPermission =
  | "network:smtp"
  | "secret:safeStorage"
  | "package:read"
  | "history:read"
  | "history:write"
  | "ui:settings"
  | "ui:publish-action";

export interface PluginActionContribution {
  id: string;
  label: string;
  description: string;
}

export interface PluginTemplateContribution {
  id: string;
  label: string;
  description: string;
}

export interface PluginContributes {
  settingsPanel?: boolean;
  publishActions?: PluginActionContribution[];
  templates?: PluginTemplateContribution[];
  historyActions?: PluginActionContribution[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  category: PluginCategory;
  permissions: PluginPermission[];
  contributes: PluginContributes;
}

export interface PluginDescriptor extends PluginManifest {
  enabled: boolean;
}

export interface ResolvedPluginActionContribution extends PluginActionContribution {
  pluginId: string;
  pluginName: string;
}

export interface ResolvedPluginTemplateContribution extends PluginTemplateContribution {
  pluginId: string;
  pluginName: string;
}

export interface PluginContributions {
  publishActions: ResolvedPluginActionContribution[];
  templates: ResolvedPluginTemplateContribution[];
  historyActions: ResolvedPluginActionContribution[];
}

export const GMAIL_SMTP_PLUGIN_ID = "delivery.smtp.gmail";
export const GMAIL_SMTP_SEND_ACTION_ID = "send-email";
export const GMAIL_SMTP_HISTORY_SEND_ACTION_ID = "send-email-from-history";
export const GMAIL_SMTP_TEST_ACTION_ID = "test-smtp";

export const EMPTY_PLUGIN_CONTRIBUTIONS: PluginContributions = {
  publishActions: [],
  templates: [],
  historyActions: []
};

export const BUILT_IN_PLUGIN_MANIFESTS: PluginManifest[] = [
  {
    id: GMAIL_SMTP_PLUGIN_ID,
    name: "Gmail SMTP Delivery",
    version: "0.1.0",
    description: "Sends the issued secure HTML package through Gmail SMTP after explicit activation.",
    category: "delivery",
    permissions: [
      "network:smtp",
      "secret:safeStorage",
      "package:read",
      "history:read",
      "ui:settings",
      "ui:publish-action"
    ],
    contributes: {
      settingsPanel: true,
      publishActions: [
        {
          id: GMAIL_SMTP_SEND_ACTION_ID,
          label: "Send email",
          description: "Attach the issued secure HTML document to a Gmail SMTP message."
        }
      ],
      historyActions: [
        {
          id: GMAIL_SMTP_HISTORY_SEND_ACTION_ID,
          label: "Send email",
          description: "Attach a saved secure HTML document from publish history to a Gmail SMTP message."
        }
      ]
    }
  }
];

export function buildPluginDescriptors(
  enabledPluginIds: readonly string[],
  manifests: readonly PluginManifest[] = BUILT_IN_PLUGIN_MANIFESTS
): PluginDescriptor[] {
  const enabledIds = new Set(enabledPluginIds);
  return manifests.map((manifest) => ({
    ...manifest,
    enabled: enabledIds.has(manifest.id)
  }));
}

export function getEnabledPluginContributions(
  enabledPluginIds: readonly string[],
  manifests: readonly PluginManifest[] = BUILT_IN_PLUGIN_MANIFESTS
): PluginContributions {
  const enabledIds = new Set(enabledPluginIds);
  const contributions: PluginContributions = {
    publishActions: [],
    templates: [],
    historyActions: []
  };

  for (const manifest of manifests) {
    if (!enabledIds.has(manifest.id)) {
      continue;
    }

    for (const action of manifest.contributes.publishActions ?? []) {
      contributions.publishActions.push({
        ...action,
        pluginId: manifest.id,
        pluginName: manifest.name
      });
    }

    for (const template of manifest.contributes.templates ?? []) {
      contributions.templates.push({
        ...template,
        pluginId: manifest.id,
        pluginName: manifest.name
      });
    }

    for (const action of manifest.contributes.historyActions ?? []) {
      contributions.historyActions.push({
        ...action,
        pluginId: manifest.id,
        pluginName: manifest.name
      });
    }
  }

  return contributions;
}
