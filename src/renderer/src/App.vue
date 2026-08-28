<template>
  <main class="app-shell">
    <div class="chrome-shell">
      <header class="topbar">
        <div class="brand-block">
          <p class="eyebrow">Azure Key Vault secret sets</p>
          <h1>PVMount GUI</h1>
        </div>
        <nav class="tabbar" aria-label="Primary">
          <button class="tab" :data-active="currentPage === 'namespaces'" @click="currentPage = 'namespaces'">Namespaces</button>
          <button class="tab" :data-active="currentPage === 'setup'" @click="currentPage = 'setup'">Setup</button>
          <button class="tab" :data-active="currentPage === 'diagnostics'" @click="currentPage = 'diagnostics'">Diagnostics</button>
        </nav>
        <div class="topbar-actions">
          <button class="button" :disabled="busy" @click="reloadAll">Refresh</button>
          <button class="button button-primary" :disabled="busy || diagnostics?.isReady" @click="confirmAndRepairMount">Repair Mount</button>
        </div>
      </header>

      <div class="crumbbar">
        <div class="crumbs">
          <button v-if="canGoBack" class="button crumb-back" :disabled="busy" @click="goBack">Back</button>
          <template v-for="(crumb, index) in breadcrumbs" :key="`${crumb.key}-${crumb.label}`">
            <button
              v-if="crumb.clickable"
              class="crumb crumb-button"
              :disabled="busy"
              @click="navigateToCrumb(crumb.key)"
            >
              {{ crumb.label }}
            </button>
            <span v-else class="crumb">{{ crumb.label }}</span>
            <span v-if="index < breadcrumbs.length - 1" class="crumb-separator">></span>
          </template>
        </div>
      </div>
    </div>

    <section class="workspace">
      <p v-if="error" class="error-banner">{{ error }}</p>
      <div v-if="showSetupRequiredBanner" class="setup-banner">
        <div>
          <strong>Setup required before syncing secrets</strong>
          <p>{{ setupRequiredMessage }}</p>
        </div>
        <button class="button" :disabled="busy" @click="currentPage = 'setup'">Review Setup</button>
      </div>

      <template v-if="currentPage === 'namespaces'">
        <template v-if="namespaceView === 'list'">
          <section class="page-header">
            <div>
              <p class="page-kicker">Local Workspace</p>
              <h2>Namespaces</h2>
              <p class="page-copy">Manage the namespaces you have locally, see what is active, and drill into environments when you need to sync or browse.</p>
            </div>
            <div class="header-actions">
              <button class="button button-primary" :disabled="busy" @click="openNamespaceWizard">Add Namespace</button>
            </div>
          </section>

          <section class="panel">
            <div v-if="showNamespaceWizard" class="wizard-card">
              <div class="wizard-header">
                <div>
                  <h3>Add Namespace</h3>
                  <p class="panel-copy">Select a subscription, load namespaces from Azure, and add one locally.</p>
                </div>
                <button class="button" :disabled="busy" @click="showNamespaceWizard = false">Close</button>
              </div>

            <div class="wizard-grid">
              <div class="field-stack">
                <label>Discovered namespace</label>
                <div class="inline-form">
                    <select v-model="selectedSubscriptionId" :disabled="busy || subscriptions.length === 0">
                      <option disabled value="">Select subscription</option>
                      <option v-for="subscription in subscriptions" :key="subscription.id" :value="subscription.id">
                        {{ subscription.name }}
                      </option>
                    </select>
                    <button class="button" :disabled="busy || !selectedSubscriptionId" @click="loadDiscoveredNamespaces">Load from Azure</button>
                    <select v-model="discoveredNamespace" :disabled="busy || discoveredNamespaces.length === 0">
                      <option disabled value="">Select namespace</option>
                      <option v-for="item in discoveredNamespaces" :key="item.namespace" :value="item.namespace">
                        {{ item.namespace }}
                      </option>
                    </select>
                    <select v-model="discoveredEnvironmentVaultName" :disabled="busy || discoveredEnvironmentOptions.length === 0">
                      <option disabled value="">Select environment</option>
                      <option v-for="environment in discoveredEnvironmentOptions" :key="environment.vaultName" :value="environment.vaultName">
                        {{ environment.environment }}
                      </option>
                    </select>
                    <button class="button button-primary" :disabled="busy || !discoveredNamespace || !discoveredEnvironmentVaultName" @click="addDiscoveredEnvironment">
                      Add
                    </button>
                  </div>
                </div>
            </div>
          </div>

            <div v-if="(dashboard?.namespaces.length ?? 0) === 0" class="empty-state">
              No local namespaces yet. Add one from Azure or manually to begin.
            </div>
            <div v-else class="namespace-table">
              <div class="namespace-table-head">
                <span>Namespace</span>
                <span>Active</span>
                <span>Local Environments</span>
                <span>Actions</span>
              </div>
              <div v-for="overview in dashboard?.namespaces ?? []" :key="overview.namespace" class="namespace-row-card">
                <div class="namespace-cell">
                  <strong>{{ overview.namespace }}</strong>
                </div>
                <div class="namespace-cell">
                  <span>{{ overview.activeLabel ?? 'Not active' }}</span>
                </div>
                <div class="namespace-cell">
                  <span>{{ overview.environments.length }} base · {{ overview.variants.length }} clone</span>
                </div>
                <div class="row-actions">
                  <button class="button" :disabled="busy" @click="openNamespaceDetail(overview.namespace)">Manage</button>
                  <button class="button button-danger" :disabled="busy" @click="removeNamespace(overview.namespace)">Remove local</button>
                </div>
              </div>
            </div>
          </section>
        </template>

        <template v-else-if="namespaceView === 'detail'">
          <section class="page-header">
            <div>
              <p class="page-kicker">Namespace</p>
              <h2>{{ selectedOverview?.namespace }}</h2>
              <p class="page-copy">Manage local environments for this namespace. Activation changes the application-facing mount target.</p>
            </div>
            <div class="header-actions">
              <div class="page-status">
                <strong>Active</strong>
                <p>{{ selectedOverview?.activeLabel ?? 'Not active' }}</p>
              </div>
              <button class="button button-primary" :disabled="busy || !selectedNamespace" @click="openEnvironmentWizard">Add Environment</button>
            </div>
          </section>

          <section class="panel">
            <div v-if="showEnvironmentWizard" class="wizard-card wizard-compact">
              <div class="wizard-header">
                <div>
                  <h3>Add Environment</h3>
                  <p class="panel-copy">Add another environment under `{{ selectedNamespace }}`.</p>
                </div>
                <button class="button" :disabled="busy" @click="showEnvironmentWizard = false">Close</button>
              </div>
              <div class="wizard-grid">
                <div class="field-stack">
                  <label>From Azure discovery</label>
                  <div class="inline-form">
                    <select v-model="selectedSubscriptionId" :disabled="busy || subscriptions.length === 0">
                      <option disabled value="">Select subscription</option>
                      <option v-for="subscription in subscriptions" :key="subscription.id" :value="subscription.id">
                        {{ subscription.name }}
                      </option>
                    </select>
                    <button class="button" :disabled="busy || !selectedSubscriptionId" @click="loadDiscoveredNamespaces">Refresh Azure</button>
                    <select v-model="discoveredEnvironmentVaultName" :disabled="busy || namespaceDiscoveryOptions.length === 0">
                      <option disabled value="">Select environment</option>
                      <option v-for="environment in namespaceDiscoveryOptions" :key="environment.vaultName" :value="environment.vaultName">
                        {{ environment.environment }}
                      </option>
                    </select>
                    <button class="button button-primary" :disabled="busy || !selectedNamespace || !discoveredEnvironmentVaultName" @click="addEnvironmentFromSelectedNamespace">
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="showCloneWizard" class="wizard-card wizard-compact">
              <div class="wizard-header">
                <div>
                  <h3>Clone Environment</h3>
                  <p class="panel-copy">Create a local-only clone from `{{ cloneSourceEnvironment }}` using the name `{{ cloneNamePreview }}`.</p>
                </div>
                <button class="button" :disabled="busy" @click="closeCloneWizard">Close</button>
              </div>
              <div class="wizard-grid">
                <div class="field-stack">
                  <label for="clone-suffix">Clone name suffix</label>
                  <div class="inline-form">
                    <span class="inline-prefix">{{ cloneSourceEnvironment }}-</span>
                    <input
                      id="clone-suffix"
                      v-model="cloneSuffix"
                      type="text"
                      placeholder="my-task"
                      :disabled="busy"
                    />
                    <button class="button button-primary" :disabled="busy || !cloneNamePreview" @click="submitClone">
                      Create clone
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="!selectedOverview" class="empty-state">Select a namespace first.</div>
            <div v-else class="environment-list">
              <div v-for="environment in selectedOverview.environments" :key="environment.environment" class="environment-row">
                <div class="environment-meta">
                  <strong>{{ environment.environment }}</strong>
                  <p>Last synced: {{ environment.lastSyncedAt ?? 'Never' }}</p>
                </div>
                <div class="row-actions">
                  <button class="button" :disabled="busy" @click="syncEnvironment(environment.namespace, environment.environment, environment.vaultName)">Sync</button>
                  <button
                    class="button button-primary"
                    :disabled="busy || isBaseActive(environment.filesPath)"
                    @click="activateBase(environment.namespace, environment.environment)"
                  >
                    {{ isBaseActive(environment.filesPath) ? 'Active' : 'Activate' }}
                  </button>
                  <button class="button" :disabled="busy" @click="openCloneWizard(environment.environment)">Clone</button>
                  <button class="button" :disabled="busy" @click="openBrowserForBase(environment.namespace, environment.environment)">Browse</button>
                  <button class="button button-danger" :disabled="busy" @click="removeEnvironment(environment.namespace, environment.environment)">Remove local</button>
                </div>
              </div>

              <div v-for="variant in selectedOverview.variants" :key="variant.variant" class="environment-row variant-row">
                <div class="environment-meta">
                  <strong>{{ variant.variant }}</strong>
                  <p>Base: {{ variant.environment }} · Disabled: {{ variant.disabledSecretNames.length }}</p>
                </div>
                <div class="row-actions">
                  <button
                    class="button button-primary"
                    :disabled="busy || isVariantActive(variant.filesPath)"
                    @click="activateVariant(variant.namespace, variant.environment, variant.variant)"
                  >
                    {{ isVariantActive(variant.filesPath) ? 'Active' : 'Activate' }}
                  </button>
                  <button class="button" :disabled="busy" @click="openBrowserForVariant(variant.namespace, variant.environment, variant.variant)">Browse</button>
                  <button class="button button-danger" :disabled="busy" @click="deleteVariant(variant.namespace, variant.environment, variant.variant)">Delete</button>
                </div>
              </div>

              <div v-if="selectedOverview.environments.length === 0 && selectedOverview.variants.length === 0" class="empty-state">
                No local environments for this namespace yet.
              </div>
            </div>
          </section>
        </template>

        <template v-else>
          <section class="page-header">
            <div>
              <p class="page-kicker">Environment Browser</p>
              <h2>{{ selectedTargetLabel }}</h2>
              <p class="page-copy">Browse filenames and clone state for the selected environment.</p>
            </div>
            <div v-if="selectedTarget && comparisonOptions.length > 0" class="header-actions">
              <div class="field-stack compare-field">
                <label for="compare-target">Compare against</label>
                <select id="compare-target" v-model="compareTargetKey">
                  <option value="">No comparison</option>
                  <option v-for="option in comparisonOptions" :key="option.key" :value="option.key">
                    {{ option.label }}
                  </option>
                </select>
              </div>
            </div>
          </section>

          <section class="panel">
            <div v-if="!selectedTarget" class="empty-state">
              Choose an environment to browse.
            </div>
            <div v-else class="secret-list">
              <div v-for="row in browserRows" :key="row.name" class="secret-row">
                <div>
                  <strong>{{ row.name }}</strong>
                  <p>{{ row.detail }}</p>
                </div>
                <div class="row-actions">
                  <StatusPill :label="row.state" :tone="stateTone(row.state)" />
                  <StatusPill
                    v-if="row.comparisonLabel"
                    :label="row.comparisonLabel"
                    :tone="comparisonTone(row.comparisonSide)"
                  />
                  <button
                    v-if="row.canDisable"
                    class="button"
                    :disabled="busy"
                    @click="disableSecret(row.name)"
                  >
                    Disable
                  </button>
                  <button
                    v-if="row.canRestore"
                    class="button"
                    :disabled="busy"
                    @click="restoreSecret(row.name)"
                  >
                    Restore
                  </button>
                </div>
              </div>
              <div v-if="browserRows.length === 0" class="empty-state">
                {{ compareTargetKey ? 'The selected environments have the same filenames.' : 'No synced secrets yet.' }}
              </div>
            </div>
          </section>
        </template>
      </template>

      <template v-else-if="currentPage === 'setup'">
        <section class="page-header">
          <div>
            <p class="page-kicker">Environment Checks</p>
            <h2>Setup</h2>
            <p class="page-copy">Validate Azure CLI, login state, and mount readiness before you start activating namespaces.</p>
          </div>
        </section>

        <section class="panel">
          <div class="check-list">
            <div v-for="check in dashboard?.setup.checks ?? []" :key="check.key" class="check-row">
              <div>
                <strong>{{ check.label }}</strong>
                <p>{{ check.detail }}</p>
                <div v-if="!check.ok && setupCheckDetail(check.key)" class="check-detail-box">
                  <strong>{{ setupCheckDetail(check.key)?.title }}</strong>
                  <p>{{ setupCheckDetail(check.key)?.body }}</p>
                  <code>{{ setupCheckDetail(check.key)?.command }}</code>
                </div>
              </div>
              <StatusPill :label="check.ok ? 'OK' : check.action ?? 'Needs action'" :tone="check.ok ? 'good' : 'warn'" />
            </div>
          </div>
        </section>
      </template>

      <template v-else>
        <section class="page-header">
          <div>
            <p class="page-kicker">Operational State</p>
            <h2>Diagnostics</h2>
            <p class="page-copy">Review mount health, active targets, sync metadata, and recent application logs.</p>
          </div>
        </section>

        <section class="grid diagnostics-grid">
          <article class="panel">
            <h2>Mount Health</h2>
            <dl class="stats">
              <div>
                <dt>Mount root</dt>
                <dd>{{ diagnostics?.mountRoot ?? 'Unknown' }}</dd>
              </div>
              <div>
                <dt>Application path</dt>
                <dd>{{ diagnostics?.expectedApplicationPath ?? 'Unknown' }}</dd>
              </div>
              <div>
                <dt>Synthetic alias</dt>
                <dd>{{ diagnostics?.syntheticAliasPath ?? 'Not required' }}</dd>
              </div>
              <div>
                <dt>Health</dt>
                <dd>{{ diagnostics?.isReady ? 'Ready' : 'Needs repair' }}</dd>
              </div>
            </dl>
          </article>

          <article class="panel">
            <h2>Active Targets</h2>
            <div class="target-list">
              <div v-for="(targetPath, namespace) in diagnostics?.activeTargets ?? {}" :key="String(namespace)" class="target-card">
                <div>
                  <h3>{{ namespace }}</h3>
                  <p>{{ targetPath }}</p>
                </div>
              </div>
              <div v-if="Object.keys(diagnostics?.activeTargets ?? {}).length === 0" class="empty-state">No active namespace targets yet.</div>
            </div>
          </article>
        </section>

        <section class="panel">
          <div class="snippet-header">
            <div>
              <h2>Docker Mount Example</h2>
              <p class="panel-copy">Use the mounted secrets path as a read-only bind mount inside a container.</p>
            </div>
          </div>
          <div class="snippet-card">
            <pre><code>{{ dockerMountExample }}</code></pre>
          </div>
        </section>

        <section class="panel">
          <h2>Activity</h2>
          <div class="log-list">
            <div v-for="log in dashboard?.logs ?? []" :key="`${log.at}-${log.message}`" class="log-row">
              <StatusPill :label="log.level" :tone="log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warn' : 'neutral'" />
              <div>
                <strong>{{ log.message }}</strong>
                <p>{{ log.at }}</p>
              </div>
            </div>
          </div>
        </section>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { AzureSubscription, DiscoveredNamespace, SecretItem, SetupCheck } from '@shared/types.js';
import StatusPill from './components/StatusPill.vue';
import { useAppState } from './composables/use-app-state';

const { dashboard, diagnostics, selectedNamespace, selectedOverview, selectedTarget, secrets, busy, error, loadDashboard, refreshSecrets, runAction } = useAppState();

const AZURE_SETUP_CHECK_KEYS = new Set(['azure-cli', 'azure-login']);

const currentPage = ref<'namespaces' | 'setup' | 'diagnostics'>('namespaces');
const namespaceView = ref<'list' | 'detail' | 'browser'>('list');
const subscriptions = ref<AzureSubscription[]>([]);
const selectedSubscriptionId = ref('');
const discoveredNamespaces = ref<DiscoveredNamespace[]>([]);
const discoveredNamespace = ref('');
const discoveredEnvironmentVaultName = ref('');
const showNamespaceWizard = ref(false);
const showEnvironmentWizard = ref(false);
const showCloneWizard = ref(false);
const cloneSourceEnvironment = ref('');
const cloneSuffix = ref('');

const selectedTargetLabel = computed(() => {
  if (!selectedTarget.value) {
    return '';
  }
  return selectedTarget.value.type === 'base'
    ? `${selectedNamespace.value}/${selectedTarget.value.environment}`
    : `${selectedNamespace.value}/${selectedTarget.value.variant}`;
});

const breadcrumbs = computed(() => {
  if (currentPage.value === 'setup') {
    return [{ key: 'setup', label: 'Setup', clickable: false }];
  }

  if (currentPage.value === 'diagnostics') {
    return [{ key: 'diagnostics', label: 'Diagnostics', clickable: false }];
  }

  const items: Array<{ key: 'namespaces' | 'namespace' | 'browser'; label: string; clickable: boolean }> = [
    {
      key: 'namespaces',
      label: 'Namespaces',
      clickable: namespaceView.value !== 'list'
    }
  ];

  if (namespaceView.value === 'detail' || namespaceView.value === 'browser') {
    items.push({
      key: 'namespace',
      label: selectedNamespace.value || 'Namespace',
      clickable: namespaceView.value === 'browser'
    });
  }

  if (namespaceView.value === 'browser' && selectedTarget.value) {
    items.push({
      key: 'browser',
      label: selectedTarget.value.type === 'base' ? selectedTarget.value.environment : selectedTarget.value.variant,
      clickable: false
    });
  }

  return items;
});

const canGoBack = computed(() => {
  if (currentPage.value !== 'namespaces') {
    return false;
  }

  return namespaceView.value === 'detail' || namespaceView.value === 'browser';
});

const discoveredEnvironmentOptions = computed(() =>
  discoveredNamespaces.value.find((item) => item.namespace === discoveredNamespace.value)?.environments ?? []
);

const namespaceDiscoveryOptions = computed(() =>
  discoveredNamespaces.value.find((item) => item.namespace === selectedNamespace.value)?.environments ?? []
);

const requiredSetupFailures = computed(() => dashboard.value?.setup.checks.filter((check) => !check.ok) ?? []);

const azureSetupFailures = computed(() => requiredSetupFailures.value.filter(isAzureSetupCheck));

const azureSetupReady = computed(() => {
  const checks = dashboard.value?.setup.checks ?? [];
  return [...AZURE_SETUP_CHECK_KEYS].every((key) => checks.find((check) => check.key === key)?.ok === true);
});

const showSetupRequiredBanner = computed(() => currentPage.value !== 'setup' && requiredSetupFailures.value.length > 0);

const setupRequiredMessage = computed(() => {
  const labels = requiredSetupFailures.value.map((check) => check.label);
  if (labels.length === 0) {
    return '';
  }

  const joinedLabels = labels.join(', ');
  return labels.length === 1
    ? `${joinedLabels} needs attention before syncing or activation.`
    : `${joinedLabels} need attention before syncing or activation.`;
});

const cloneNamePreview = computed(() => {
  if (!cloneSourceEnvironment.value) {
    return '';
  }

  const trimmedSuffix = cloneSuffix.value.trim();
  const normalizedSuffix = trimmedSuffix.startsWith(`${cloneSourceEnvironment.value}-`)
    ? trimmedSuffix.slice(cloneSourceEnvironment.value.length + 1).trim()
    : trimmedSuffix;
  return normalizedSuffix ? `${cloneSourceEnvironment.value}-${normalizedSuffix}` : '';
});

const compareTargetKey = ref('');
const compareTargetSecrets = ref<SecretItem[]>([]);
type ComparisonSide = 'current only' | 'compare only';

const comparisonOptions = computed(() => {
  if (!selectedOverview.value || !selectedTarget.value) {
    return [];
  }

  const baseOptions = selectedOverview.value.environments
    .filter((environment) => !(selectedTarget.value?.type === 'base' && selectedTarget.value.environment === environment.environment))
    .map((environment) => ({
      key: `base:${environment.environment}`,
      label: environment.environment,
      target: { type: 'base', environment: environment.environment } as const
    }));

  const variantOptions = selectedOverview.value.variants
    .filter((variant) => !(selectedTarget.value?.type === 'variant' && selectedTarget.value.variant === variant.variant))
    .map((variant) => ({
      key: `variant:${variant.variant}`,
      label: variant.variant,
      target: { type: 'variant', environment: variant.environment, variant: variant.variant } as const
    }));

  return [...baseOptions, ...variantOptions];
});

const compareTargetLabel = computed(() => comparisonOptions.value.find((item) => item.key === compareTargetKey.value)?.label ?? '');

const dockerMountExample = computed(() => {
  const applicationPath = diagnostics.value?.expectedApplicationPath ?? '/mnt/secrets';
  const activeNamespaces = Object.keys(diagnostics.value?.activeTargets ?? {});
  const exampleNamespace = activeNamespaces[0] ?? 'your-namespace';

  return [
    `docker run --rm \\`,
    `  -v ${applicationPath}/${exampleNamespace}:/app/secrets:ro \\`,
    `  alpine:3.20 ls -la /app/secrets`
  ].join('\n');
});

const browserRows = computed(() => {
  const compareSet = new Set(compareTargetSecrets.value.filter((item) => item.presentInTarget).map((item) => item.name));
  const rows = secrets.value.map((secret) => {
    const comparisonSide: ComparisonSide | null = compareTargetKey.value
      ? compareSet.has(secret.name)
        ? null
        : 'current only'
      : null;

    return {
      name: secret.name,
      detail: stateCopy(secret.state),
      state: secret.state,
      comparisonSide,
      comparisonLabel:
        comparisonSide && compareTargetLabel.value ? `Not in ${compareTargetLabel.value}` : '',
      canDisable: selectedTarget.value?.type === 'variant' && secret.presentInTarget,
      canRestore:
        selectedTarget.value?.type === 'variant' && !secret.presentInTarget && secret.presentInBase
    };
  });

  if (!compareTargetKey.value) {
    return rows;
  }

  const currentSet = new Set(secrets.value.filter((item) => item.presentInTarget).map((item) => item.name));
  const missingFromCurrent = compareTargetSecrets.value
    .filter((item) => item.presentInTarget && !currentSet.has(item.name))
    .map((item) => ({
      name: item.name,
      detail: `Present in ${compareTargetLabel.value} and missing from the current environment.`,
      state: 'missing' as const,
      comparisonSide: 'compare only' as const,
      comparisonLabel: 'Not in current',
      canDisable: false,
      canRestore: false
    }));

  return [...rows, ...missingFromCurrent].sort((left, right) => left.name.localeCompare(right.name));
});

onMounted(() => {
  void reloadAll();
});

watch(selectedTarget, () => {
  compareTargetKey.value = '';
  compareTargetSecrets.value = [];
  void refreshSecrets();
});

watch(discoveredNamespace, () => {
  discoveredEnvironmentVaultName.value = '';
});

watch(selectedSubscriptionId, () => {
  discoveredNamespaces.value = [];
  discoveredNamespace.value = '';
  discoveredEnvironmentVaultName.value = '';
});

watch(compareTargetKey, () => {
  void loadComparisonSecrets();
});

async function reloadAll(): Promise<void> {
  await runAction(async () => {
    await loadDashboard();
    if (selectedNamespace.value && !dashboard.value?.namespaces.find((item) => item.namespace === selectedNamespace.value)) {
      selectedNamespace.value = '';
      namespaceView.value = 'list';
      selectedTarget.value = null;
      secrets.value = [];
    }
  });
  applySetupGuidance({ redirect: true });
  if (azureSetupReady.value) {
    await loadSubscriptions();
  }
}

async function loadComparisonSecrets(): Promise<void> {
  if (!compareTargetKey.value || !selectedNamespace.value) {
    compareTargetSecrets.value = [];
    return;
  }

  const option = comparisonOptions.value.find((item) => item.key === compareTargetKey.value);
  if (!option || !window.pvmount) {
    compareTargetSecrets.value = [];
    return;
  }

  try {
    compareTargetSecrets.value = await window.pvmount.listSecrets({
      namespace: selectedNamespace.value,
      ...option.target
    });
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    compareTargetSecrets.value = [];
  }
}

function navigateToCrumb(key: 'namespaces' | 'namespace' | 'browser' | 'setup' | 'diagnostics'): void {
  if (currentPage.value !== 'namespaces') {
    return;
  }

  if (key === 'namespaces') {
    namespaceView.value = 'list';
    return;
  }

  if (key === 'namespace') {
    namespaceView.value = 'detail';
  }
}

function goBack(): void {
  if (!canGoBack.value) {
    return;
  }

  if (namespaceView.value === 'browser') {
    namespaceView.value = 'detail';
    return;
  }

  if (namespaceView.value === 'detail') {
    namespaceView.value = 'list';
  }
}

async function ensureMountReady(): Promise<void> {
  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    diagnostics.value = await window.pvmount.ensureMountReady();
    await loadDashboard();
  });
}

async function confirmAndRepairMount(): Promise<void> {
  const confirmed = window.confirm(
    [
      'Repair mount setup?',
      '',
      'This may request administrator access to prepare the mounted secrets path.',
      'On newer macOS versions it may temporarily write /etc/synthetic.conf, apply the /mnt alias, and then remove or restore that file.'
    ].join('\n')
  );

  if (!confirmed) {
    return;
  }

  await ensureMountReady();
}

async function loadSubscriptions(): Promise<void> {
  if (!requireAzureSetupReady()) {
    return;
  }

  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    subscriptions.value = await window.pvmount.listSubscriptions();
    if (!selectedSubscriptionId.value) {
      selectedSubscriptionId.value = subscriptions.value.find((item) => item.isDefault)?.id ?? subscriptions.value[0]?.id ?? '';
    }
  });
}

async function loadDiscoveredNamespaces(): Promise<void> {
  if (!requireAzureSetupReady()) {
    return;
  }

  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    discoveredNamespaces.value = await window.pvmount.discoverNamespaces(selectedSubscriptionId.value || undefined);
    if (discoveredNamespaces.value.length === 1) {
      discoveredNamespace.value = discoveredNamespaces.value[0]?.namespace ?? '';
    }
  });
}

async function syncEnvironment(namespace: string, environment: string, vaultName?: string): Promise<void> {
  if (!requireAzureSetupReady()) {
    return;
  }

  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    dashboard.value = await window.pvmount.syncEnvironment({ namespace, environment, ...(vaultName ? { vaultName } : {}) });
    selectedNamespace.value = namespace;
  });
}

async function addDiscoveredEnvironment(): Promise<void> {
  if (!requireAzureSetupReady()) {
    return;
  }

  const discoveredEnvironment = discoveredEnvironmentOptions.value.find((item) => item.vaultName === discoveredEnvironmentVaultName.value);
  if (!discoveredNamespace.value || !discoveredEnvironment) {
    return;
  }
  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    dashboard.value = await window.pvmount.syncEnvironment({
      namespace: discoveredNamespace.value,
      environment: discoveredEnvironment.environment,
      vaultName: discoveredEnvironment.vaultName
    });
    selectedNamespace.value = discoveredNamespace.value;
    discoveredNamespace.value = '';
    discoveredEnvironmentVaultName.value = '';
    namespaceView.value = 'detail';
    showNamespaceWizard.value = false;
  });
}

async function addEnvironmentFromSelectedNamespace(): Promise<void> {
  if (!requireAzureSetupReady()) {
    return;
  }

  const discoveredEnvironment = namespaceDiscoveryOptions.value.find((item) => item.vaultName === discoveredEnvironmentVaultName.value);
  if (!selectedNamespace.value || !discoveredEnvironment) {
    return;
  }
  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    dashboard.value = await window.pvmount.syncEnvironment({
      namespace: selectedNamespace.value,
      environment: discoveredEnvironment.environment,
      vaultName: discoveredEnvironment.vaultName
    });
    discoveredEnvironmentVaultName.value = '';
    showEnvironmentWizard.value = false;
  });
}

function openNamespaceDetail(namespace: string): void {
  selectedNamespace.value = namespace;
  namespaceView.value = 'detail';
}

function openBrowserForBase(namespace: string, environment: string): void {
  selectedNamespace.value = namespace;
  selectedTarget.value = { type: 'base', environment };
  compareTargetKey.value = '';
  compareTargetSecrets.value = [];
  namespaceView.value = 'browser';
}

function openBrowserForVariant(namespace: string, environment: string, variant: string): void {
  selectedNamespace.value = namespace;
  selectedTarget.value = { type: 'variant', environment, variant };
  compareTargetKey.value = '';
  compareTargetSecrets.value = [];
  namespaceView.value = 'browser';
}

function isBaseActive(filesPath: string): boolean {
  return selectedOverview.value?.activeTargetPath === filesPath;
}

function isVariantActive(filesPath: string): boolean {
  return selectedOverview.value?.activeTargetPath === filesPath;
}

async function activateBase(namespace: string, environment: string): Promise<void> {
  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    const target = { type: 'base', environment } as const;
    selectedNamespace.value = namespace;
    selectedTarget.value = target;
    dashboard.value = await window.pvmount.activateTarget({ namespace, target });
    diagnostics.value = await window.pvmount.getDiagnostics();
  });
}

async function activateVariant(namespace: string, environment: string, variant: string): Promise<void> {
  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    const target = { type: 'variant', environment, variant } as const;
    selectedNamespace.value = namespace;
    selectedTarget.value = target;
    dashboard.value = await window.pvmount.activateTarget({ namespace, target });
    diagnostics.value = await window.pvmount.getDiagnostics();
  });
}

function openCloneWizard(environment: string): void {
  if (!selectedNamespace.value) {
    return;
  }

  cloneSourceEnvironment.value = environment;
  cloneSuffix.value = 'my-task';
  showCloneWizard.value = true;
}

function closeCloneWizard(): void {
  showCloneWizard.value = false;
  cloneSourceEnvironment.value = '';
  cloneSuffix.value = '';
}

async function submitClone(): Promise<void> {
  if (!selectedNamespace.value || !cloneSourceEnvironment.value || !cloneNamePreview.value) {
    return;
  }

  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    dashboard.value = await window.pvmount.createVariant({
      namespace: selectedNamespace.value,
      environment: cloneSourceEnvironment.value,
      variant: cloneNamePreview.value
    });
    closeCloneWizard();
  });
}

async function deleteVariant(namespace: string, environment: string, variant: string): Promise<void> {
  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    dashboard.value = await window.pvmount.deleteVariant({ namespace, environment, variant });
    if (selectedTarget.value?.type === 'variant' && selectedTarget.value.variant === variant) {
      selectedTarget.value = null;
      secrets.value = [];
      namespaceView.value = 'detail';
    }
  });
}

async function removeNamespace(namespace: string): Promise<void> {
  const confirmed = window.confirm(
    `Remove local namespace '${namespace}'?\n\nThis only deletes the local namespace, its local environments, and any local clones. It does not remove anything from Azure.`
  );
  if (!confirmed) {
    return;
  }

  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    dashboard.value = await window.pvmount.deleteNamespace({ namespace });
    diagnostics.value = await window.pvmount.getDiagnostics();
    if (selectedNamespace.value === namespace) {
      selectedNamespace.value = '';
      selectedTarget.value = null;
      secrets.value = [];
      namespaceView.value = 'list';
    }
  });
}

async function removeEnvironment(namespace: string, environment: string): Promise<void> {
  const confirmed = window.confirm(
    `Remove local environment '${environment}' from namespace '${namespace}'?\n\nThis only deletes the local synced copy and any local clones derived from it. It does not delete anything from Azure Key Vault.`
  );
  if (!confirmed) {
    return;
  }

  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    dashboard.value = await window.pvmount.deleteEnvironment({ namespace, environment });
    diagnostics.value = await window.pvmount.getDiagnostics();
    if (selectedTarget.value?.environment === environment && selectedNamespace.value === namespace) {
      selectedTarget.value = null;
      secrets.value = [];
      namespaceView.value = 'detail';
    }
  });
}

async function disableSecret(secretName: string): Promise<void> {
  if (selectedTarget.value?.type !== 'variant') {
    return;
  }
  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    secrets.value = await window.pvmount.disableSecret({
      namespace: selectedNamespace.value,
      environment: selectedTarget.value.environment,
      variant: selectedTarget.value.variant,
      secretName
    });
  });
}

async function restoreSecret(secretName: string): Promise<void> {
  if (selectedTarget.value?.type !== 'variant') {
    return;
  }
  await runAction(async () => {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app.');
    }
    secrets.value = await window.pvmount.restoreSecret({
      namespace: selectedNamespace.value,
      environment: selectedTarget.value.environment,
      variant: selectedTarget.value.variant,
      secretName
    });
  });
}

async function openNamespaceWizard(): Promise<void> {
  if (!requireAzureSetupReady()) {
    return;
  }

  showNamespaceWizard.value = !showNamespaceWizard.value;
  if (showNamespaceWizard.value && subscriptions.value.length === 0) {
    await loadSubscriptions();
  }
}

async function openEnvironmentWizard(): Promise<void> {
  if (!requireAzureSetupReady()) {
    return;
  }

  showEnvironmentWizard.value = !showEnvironmentWizard.value;
  if (showEnvironmentWizard.value && subscriptions.value.length === 0) {
    await loadSubscriptions();
  }
}

function applySetupGuidance(input: { redirect: boolean }): void {
  if (!dashboard.value) {
    return;
  }

  if (azureSetupFailures.value.length > 0) {
    clearAzureDiscoveryState();
    showNamespaceWizard.value = false;
    showEnvironmentWizard.value = false;
  }

  if (input.redirect && requiredSetupFailures.value.length > 0) {
    currentPage.value = 'setup';
    namespaceView.value = 'list';
  }
}

function requireAzureSetupReady(): boolean {
  if (azureSetupReady.value) {
    return true;
  }

  clearAzureDiscoveryState();
  showNamespaceWizard.value = false;
  showEnvironmentWizard.value = false;
  currentPage.value = 'setup';
  error.value = '';
  return false;
}

function clearAzureDiscoveryState(): void {
  subscriptions.value = [];
  selectedSubscriptionId.value = '';
  discoveredNamespaces.value = [];
  discoveredNamespace.value = '';
  discoveredEnvironmentVaultName.value = '';
}

function isAzureSetupCheck(check: SetupCheck): boolean {
  return AZURE_SETUP_CHECK_KEYS.has(check.key);
}

function setupCheckDetail(key: string): { title: string; body: string; command: string } | null {
  if (key === 'azure-cli') {
    return {
      title: 'How this check passes',
      body: 'The app must be able to run Azure CLI from its own process. On macOS with Homebrew, install Azure CLI, then click Refresh.',
      command: 'brew install azure-cli'
    };
  }

  if (key === 'azure-login') {
    return {
      title: 'How this check passes',
      body: 'The app uses your existing Azure CLI session. Sign in in Terminal, complete the browser prompt, then click Refresh.',
      command: 'az login'
    };
  }

  return null;
}

function stateTone(state: SecretItem['state']): 'neutral' | 'good' | 'warn' | 'danger' {
  switch (state) {
    case 'present':
      return 'good';
    case 'disabled':
      return 'warn';
    case 'changed':
      return 'danger';
    case 'missing':
      return 'neutral';
  }
}

function stateCopy(state: SecretItem['state'] | 'missing'): string {
  switch (state) {
    case 'present':
      return 'Matches the synced base environment.';
    case 'disabled':
      return 'Removed in this clone but still available in the base environment.';
    case 'changed':
      return 'Present but different from the synced base environment.';
    case 'missing':
      return 'Missing from the current environment.';
  }
}

function comparisonTone(state: ComparisonSide | null): 'warn' | 'danger' {
  return state === 'current only' ? 'warn' : 'danger';
}
</script>
