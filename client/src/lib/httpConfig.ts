const rawEnvBase = import.meta.env.VITE_API_BASE_URL?.trim();

const computedBase = (() => {
  if (rawEnvBase) {
    return rawEnvBase.replace(/\/+$/, '');
  }

  if (import.meta.env.DEV) {
    return '/api';
  }

  if (typeof window !== 'undefined') {
    return `${window.location.origin.replace(/\/+$/, '')}/api`;
  }

  return '/api';
})();

export const API_BASE_URL = computedBase;

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  let normalized = path.trim();
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  // Remove `/api` prefix if the resolved base already includes it.
  if (normalized.startsWith('/api') && API_BASE_URL !== '/api') {
    normalized = normalized.slice(4) || '/';
    if (!normalized.startsWith('/')) {
      normalized = `/${normalized}`;
    }
  }

  if (API_BASE_URL === '/api') {
    return normalized.startsWith('/api') ? normalized : `/api${normalized}`;
  }

  return `${API_BASE_URL}${normalized}`;
}
