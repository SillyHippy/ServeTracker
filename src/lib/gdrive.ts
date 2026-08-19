import type { Client, Case, ServeAttempt } from '@/types';

// Google Identity Services types
interface GisTokenResponse {
  access_token?: string;
  error?: string;
  expires_in?: number;
}

interface GisTokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GisTokenResponse) => void;
          }) => GisTokenClient;
          revoke: (token: string, callback: () => void) => void;
        };
      };
    };
  }
}

const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
const FOLDER_NAME = 'PDFUSA Backups';
const TOKEN_KEY = 'gdrive_token';
const TOKEN_EXPIRY_KEY = 'gdrive_token_expiry';
const FOLDER_ID_KEY = 'gdrive_folder_id';
const LAST_BACKUP_KEY = 'gdrive_last_backup';

let tokenClient: GisTokenClient | null = null;
let pendingResolve: ((token: string) => void) | null = null;
let pendingReject: ((err: Error) => void) | null = null;

function buildTokenClient(clientId: string): GisTokenClient {
  return window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (resp: GisTokenResponse) => {
      if (resp.error || !resp.access_token) {
        pendingReject?.(new Error(resp.error || 'No access token returned'));
      } else {
        localStorage.setItem(TOKEN_KEY, resp.access_token);
        localStorage.setItem(
          TOKEN_EXPIRY_KEY,
          String(Date.now() + (resp.expires_in ?? 3600) * 1000),
        );
        pendingResolve?.(resp.access_token);
      }
      pendingResolve = null;
      pendingReject = null;
    },
  });
}

function getClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
}

export function isGdriveConfigured(): boolean {
  return !!getClientId();
}

export function isGdriveReady(): boolean {
  return !!window.google?.accounts?.oauth2;
}

export function getStoredToken(): string | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
  if (!token || !expiry) return null;
  if (Date.now() > parseInt(expiry) - 60_000) return null;
  return token;
}

export function getLastBackupTime(): string | null {
  return localStorage.getItem(LAST_BACKUP_KEY);
}

export function isGdriveSetUp(): boolean {
  return (
    !!localStorage.getItem(FOLDER_ID_KEY) ||
    !!localStorage.getItem(LAST_BACKUP_KEY) ||
    !!localStorage.getItem(TOKEN_KEY)
  );
}

export function disconnectGdrive(): void {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && isGdriveReady()) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_EXPIRY_KEY);
  localStorage.removeItem(FOLDER_ID_KEY);
  localStorage.removeItem(LAST_BACKUP_KEY);
  tokenClient = null;
  pendingResolve = null;
  pendingReject = null;
}

export function signInWithGoogle(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isGdriveReady()) {
      reject(new Error('Google Identity Services not loaded yet.'));
      return;
    }
    const clientId = getClientId();
    if (!clientId) {
      reject(new Error('Google Client ID not configured.'));
      return;
    }
    pendingResolve = resolve;
    pendingReject = reject;
    if (!tokenClient || true) {
      tokenClient = buildTokenClient(clientId);
    }
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

async function ensureFolder(token: string): Promise<string> {
  let folderId = localStorage.getItem(FOLDER_ID_KEY);
  if (folderId) return folderId;

  // Check if folder already exists
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (listRes.ok) {
    const data = await listRes.json();
    if (data.files && data.files.length > 0) {
      folderId = data.files[0].id;
      localStorage.setItem(FOLDER_ID_KEY, folderId);
      return folderId;
    }
  }

  // Create folder
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!res.ok) throw new Error(`Failed to create folder: ${await res.text()}`);
  const folder = await res.json();
  localStorage.setItem(FOLDER_ID_KEY, folder.id);
  return folder.id;
}

export async function backupToDrive(data: { clients: any[]; cases: any[]; serves: any[]; timestamp: string }): Promise<string> {
  const token = getStoredToken();
  if (!token) throw new Error('Not signed in to Google Drive');

  const folderId = await ensureFolder(token);
  const filename = `pdfusa-backup-${data.timestamp}.json`;

  const metadata = { name: filename, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', new Blob([JSON.stringify(data)], { type: 'application/json' }));

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${await res.text()}`);

  const now = new Date().toISOString();
  localStorage.setItem(LAST_BACKUP_KEY, now);
  return filename;
}

export async function listBackupFiles(): Promise<{ id: string; name: string; modifiedTime: string; size: number }[]> {
  const token = getStoredToken();
  if (!token) throw new Error('Not signed in to Google Drive');
  const folderId = localStorage.getItem(FOLDER_ID_KEY);
  if (!folderId) return [];

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}' in parents and trashed=false&orderBy=createdTime desc`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`List failed: ${await res.text()}`);
  const data = await res.json();
  return data.files || [];
}

export async function restoreFromDrive(fileId: string): Promise<any> {
  const token = getStoredToken();
  if (!token) throw new Error('Not signed in to Google Drive');

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Download failed: ${await res.text()}`);
  return res.json();
}
