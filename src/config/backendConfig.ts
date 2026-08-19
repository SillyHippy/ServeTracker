// Backend configuration for the local Hono/SQLite API

export const API_CONFIG = {
  baseUrl: import.meta.env.VITE_API_URL || '',
};

export const COLLECTION_IDS = {
  clients: 'clients',
  clientCases: 'client_cases',
  serveAttempts: 'serve_attempts',
  clientDocuments: 'client_documents',
};

// Backward-compatible exports for legacy code
export const DB_ID = 'local';
export const CLIENTS_COLLECTION_ID = 'clients';
export const CASES_COLLECTION_ID = 'client_cases';
export const SERVE_ATTEMPTS_COLLECTION_ID = 'serve_attempts';
export const CLIENT_DOCUMENTS_COLLECTION_ID = 'client_documents';
export const STORAGE_BUCKET_ID = 'local';
export const BACKEND_PROVIDER = { LOCAL: 'local' } as const;
export const ACTIVE_BACKEND = BACKEND_PROVIDER.LOCAL;
export const CACHE_BUST = '1780205173';
