import { computed, ref } from 'vue';
import type {
  ActivateTargetInput,
  DashboardState,
  DiagnosticsState,
  NamespaceOverview,
  SecretItem
} from '@shared/types.js';

export function useAppState() {
  const dashboard = ref<DashboardState | null>(null);
  const diagnostics = ref<DiagnosticsState | null>(null);
  const selectedNamespace = ref<string>('');
  const selectedTarget = ref<ActivateTargetInput['target'] | null>(null);
  const secrets = ref<SecretItem[]>([]);
  const busy = ref(false);
  const error = ref<string>('');

  function getApi() {
    if (!window.pvmount) {
      throw new Error('Electron preload API is unavailable. Restart the desktop app instead of opening the renderer directly in a browser.');
    }
    return window.pvmount;
  }

  async function loadDashboard(): Promise<void> {
    busy.value = true;
    error.value = '';
    try {
      const api = getApi();
      dashboard.value = await api.getDashboardState();
      diagnostics.value = await api.getDiagnostics();
      const firstNamespace = dashboard.value.namespaces[0];
      if (firstNamespace && !selectedNamespace.value) {
        selectedNamespace.value = firstNamespace.namespace;
      }
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy.value = false;
    }
  }

  async function refreshSecrets(): Promise<void> {
    if (!selectedNamespace.value || !selectedTarget.value) {
      secrets.value = [];
      return;
    }
    const target = toPlainTarget(selectedTarget.value);
    secrets.value = await getApi().listSecrets({
      namespace: selectedNamespace.value,
      ...target
    });
  }

  async function runAction<T>(action: () => Promise<T>): Promise<T | undefined> {
    busy.value = true;
    error.value = '';
    try {
      return await action();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      return undefined;
    } finally {
      busy.value = false;
    }
  }

  const selectedOverview = computed<NamespaceOverview | undefined>(() =>
    dashboard.value?.namespaces.find((item) => item.namespace === selectedNamespace.value)
  );

  return {
    dashboard,
    diagnostics,
    selectedNamespace,
    selectedTarget,
    selectedOverview,
    secrets,
    busy,
    error,
    loadDashboard,
    refreshSecrets,
    runAction
  };
}

function toPlainTarget(target: ActivateTargetInput['target']): ActivateTargetInput['target'] {
  return target.type === 'base'
    ? { type: 'base', environment: target.environment }
    : { type: 'variant', environment: target.environment, variant: target.variant };
}
