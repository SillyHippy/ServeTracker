import { createServeEmailBody } from "@/utils/email";
import { generateThumbnail } from "@/utils/thumbnailGenerator";
import { API_BASE } from "@/lib/publicBase";
import { enqueueServe, isNetworkFailure, newOfflineId, startOfflineSync } from "@/lib/offlineQueue";

export { API_BASE };

async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Accept": "application/json",
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    throw new Error(`Expected JSON from ${path}, got ${ctype || "unknown"} (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// Compatibility constants (legacy code references these)
export const DATABASE_ID = "local";
export const CLIENTS_COLLECTION_ID = "clients";
export const SERVE_ATTEMPTS_COLLECTION_ID = "serve_attempts";
export const CASES_COLLECTION_ID = "client_cases";
export const DOCUMENTS_COLLECTION_ID = "client_documents";
export const STORAGE_BUCKET_ID = "local";

const databasesShim = {
  async listDocuments(_databaseId: string, collectionId: string, _queries?: unknown[]) {
    if (collectionId === CLIENTS_COLLECTION_ID || collectionId === "67eae70e000c042112c8") {
      const docs = await apiFetch<Record<string, unknown>[]>("/api/clients");
      return { documents: docs, total: docs.length };
    }
    if (collectionId === CASES_COLLECTION_ID || collectionId === "67eae98f0017c9503bee") {
      const docs = await apiFetch<Record<string, unknown>[]>("/api/cases");
      return { documents: docs, total: docs.length };
    }
    if (collectionId === SERVE_ATTEMPTS_COLLECTION_ID || collectionId === "new_serve_attempts") {
      const result = await apiFetch<{ documents: unknown[]; total: number }>("/api/serves?limit=500");
      return { documents: result.documents, total: result.total };
    }
    if (collectionId === DOCUMENTS_COLLECTION_ID || collectionId === "67eaeaa900128f318514") {
      const docs = await apiFetch<Record<string, unknown>[]>("/api/documents");
      return { documents: docs, total: docs.length };
    }
    return { documents: [], total: 0 };
  },

  async getDocument(_databaseId: string, collectionId: string, documentId: string) {
    if (collectionId === CLIENTS_COLLECTION_ID) {
      const clients = await apiFetch<Record<string, unknown>[]>("/api/clients");
      const found = clients.find((c) => c.$id === documentId || c.id === documentId);
      if (!found) throw new Error("Client not found");
      return found;
    }
    throw new Error("getDocument not implemented for collection");
  },

  async updateDocument(_databaseId: string, collectionId: string, documentId: string, data: Record<string, unknown>) {
    if (collectionId === SERVE_ATTEMPTS_COLLECTION_ID || collectionId === "new_serve_attempts") {
      return apiFetch(`/api/serves/${documentId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    }
    if (collectionId === CLIENTS_COLLECTION_ID) {
      return apiFetch(`/api/clients/${documentId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      });
    }
    throw new Error("updateDocument not implemented for collection");
  },

  async deleteDocument(_databaseId: string, collectionId: string, documentId: string) {
    if (collectionId === SERVE_ATTEMPTS_COLLECTION_ID) {
      await apiFetch(`/api/serves/${documentId}`, { method: "DELETE" });
      return true;
    }
    if (collectionId === CLIENTS_COLLECTION_ID) {
      await apiFetch(`/api/clients/${documentId}`, { method: "DELETE" });
      return true;
    }
    if (collectionId === CASES_COLLECTION_ID) {
      await apiFetch(`/api/cases/${documentId}`, { method: "DELETE" });
      return true;
    }
    if (collectionId === DOCUMENTS_COLLECTION_ID) {
      await apiFetch(`/api/documents/${documentId}`, { method: "DELETE" });
      return true;
    }
    return false;
  },
};

const storageShim = {
  async createFile(_bucketId: string, fileId: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("fileId", fileId);
    const res = await fetch(`${API_BASE}/api/documents`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) throw new Error(await res.text());
    const doc = await res.json();
    return { $id: doc.file_path || fileId };
  },

  async deleteFile(_bucketId: string, fileId: string) {
    // fileId may be a path fragment; best-effort no-op for legacy callers
    console.warn("deleteFile shim called for", fileId);
    return true;
  },

  getFileView(_bucketId: string, fileId: string) {
    const href = `${API_BASE}/uploads/documents/${fileId}`;
    return { href, toString: () => href };
  },
};

const functionsShim = {
  async createExecution(_functionId: string, body: string) {
    const payload = JSON.parse(body);
    const result = await apiFetch("/api/email/send", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return { status: "completed", responseBody: JSON.stringify(result) };
  },
};

export const api = {
  client: { config: { endpoint: API_BASE, project: "local" } },
  account: {},
  databases: databasesShim,
  storage: storageShim,
  teams: {},
  functions: functionsShim,
  DATABASE_ID,
  collections: {
    clients: CLIENTS_COLLECTION_ID,
    clientCases: CASES_COLLECTION_ID,
    serveAttempts: SERVE_ATTEMPTS_COLLECTION_ID,
    clientDocuments: DOCUMENTS_COLLECTION_ID,
  },
  CLIENTS_COLLECTION_ID,
  SERVE_ATTEMPTS_COLLECTION_ID,
  CASES_COLLECTION_ID,
  DOCUMENTS_COLLECTION_ID,
  STORAGE_BUCKET_ID,

  async sendMessage() {
    throw new Error("sendMessage is not supported on local API");
  },

  async sendEmailViaFunction(emailData: {
    to: string | string[];
    subject: string;
    html: string;
    imageUrl?: string;
    imageData?: string;
  }) {
    try {
      const result = await apiFetch<{ success: boolean; message?: string }>("/api/email/send", {
        method: "POST",
        body: JSON.stringify(emailData),
      });
      return { success: result.success, message: result.message || "Email sent successfully" };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Unknown error" };
    }
  },

  setupRealtimeSubscription(_callback: (response: unknown) => void) {
    const interval = setInterval(() => {
      window.dispatchEvent(new CustomEvent("serves-updated"));
    }, 30000);
    return () => clearInterval(interval);
  },

  isApiConfigured() {
    return true;
  },

  async globalSearch(query: string) {
    return apiFetch<{ recipients: any[]; cases: any[]; clients: any[]; serves: any[] }>(
      `/api/search?q=${encodeURIComponent(query)}`
    );
  },

  async getRecipients(caseId?: string, clientId?: string) {
    let path = "/api/recipients";
    if (caseId) path += `?case_id=${caseId}`;
    else if (clientId) path += `?client_id=${clientId}`;
    return apiFetch<any[]>(path);
  },

  async createRecipient(recipientData: Record<string, unknown>) {
    return apiFetch("/api/recipients", {
      method: "POST",
      body: JSON.stringify(recipientData),
    });
  },

  async updateRecipient(id: string, recipientData: Record<string, unknown>) {
    return apiFetch(`/api/recipients/${id}`, {
      method: "PUT",
      body: JSON.stringify(recipientData),
    });
  },

  async deleteRecipient(id: string) {
    await apiFetch(`/api/recipients/${id}`, { method: "DELETE" });
    return true;
  },

  async getAffidavitData(caseId: string, clientId?: string) {
    const q = clientId ? `?client_id=${encodeURIComponent(clientId)}` : "";
    return apiFetch<any>(`/api/affidavit/${caseId}${q}`);
  },

  async uploadServePhoto(serveId: string, position: number, imageData: string) {
    return apiFetch(`/api/serves/${serveId}/photos`, {
      method: "POST",
      body: JSON.stringify({ position, imageData }),
    });
  },

  async deleteServePhoto(serveId: string, photoId: string) {
    return apiFetch(`/api/serves/${serveId}/photos/${photoId}`, { method: "DELETE" });
  },

  async getClients() {
    return apiFetch<Record<string, unknown>[]>("/api/clients");
  },

  async createClient(client: Record<string, unknown>) {
    return apiFetch("/api/clients", {
      method: "POST",
      body: JSON.stringify({
        id: client.id,
        name: client.name,
        email: client.email,
        additionalEmails: client.additionalEmails,
        phone: client.phone,
        address: client.address,
        notes: client.notes,
      }),
    });
  },

  async updateClient(clientId: string, clientData: Record<string, unknown>) {
    return apiFetch(`/api/clients/${clientId}`, {
      method: "PUT",
      body: JSON.stringify(clientData),
    });
  },

  async deleteClient(clientId: string) {
    await apiFetch(`/api/clients/${clientId}`, { method: "DELETE" });
    return true;
  },

  async getServeAttempts(limit = 50, offset = 0) {
    const result = await apiFetch<any>(
      `/api/serves?limit=${limit}&offset=${offset}`
    );
    return Array.isArray(result) ? result : (result.documents || []);
  },

  async getClientServeAttempts(clientId: string) {
    const result = await apiFetch<{ documents: Record<string, unknown>[] }>(
      `/api/serves?client_id=${clientId}&limit=500`
    );
    return result.documents.sort(
      (a, b) => new Date(b.timestamp as string).getTime() - new Date(a.timestamp as string).getTime()
    );
  },

  async getTotalServeAttemptsCount() {
    const result = await apiFetch<{ total: number }>("/api/serves/count");
    return result.total;
  },

  async createServeAttempt(serveData: Record<string, unknown>) {
    let thumbnailData: string | undefined;
    if (serveData.imageData && typeof serveData.imageData === "string") {
      try {
        const thumbBlob = await generateThumbnail(serveData.imageData as string, {
          maxWidth: 400,
          maxHeight: 300,
          quality: 0.8,
          format: "jpeg",
        });
        const reader = new FileReader();
        thumbnailData = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(thumbBlob);
        });
      } catch (error) {
        console.warn("Thumbnail generation failed:", error);
      }
    }

    // Server sends the notification with photo LINKS (no attachments).
    // Do NOT send a second client-side email with imageUrl/imageData — that
    // re-attached only Photo 1 and dropped the rest.
    const payload: Record<string, unknown> = {
      ...serveData,
      thumbnailData,
      sendEmail: serveData.sendEmail !== false,
      id: serveData.id || newOfflineId(),
    };
    try {
      return await apiFetch<Record<string, unknown>>("/api/serves", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (serveData._offlineReplay) throw err;
      if (isNetworkFailure(err) || (typeof navigator !== "undefined" && navigator.onLine === false)) {
        const queued = await enqueueServe(payload, err instanceof Error ? err.message : "offline");
        return {
          id: queued.id,
          offlineQueued: true,
          status: payload.status,
          case_number: payload.case_number || payload.caseNumber,
          person_being_served: payload.person_being_served || payload.personBeingServed,
        };
      }
      throw err;
    }
  },

  async updateServeAttempt(serveId: string | Record<string, unknown>, serveData: Record<string, unknown>) {
    const docId = typeof serveId === "object" ? (serveId.id || serveId.$id) : serveId;
    const response = await apiFetch<Record<string, unknown>>(`/api/serves/${docId}`, {
      method: "PUT",
      body: JSON.stringify(serveData),
    });

    // No auto-email on edit — avoids duplicate/attachment emails. User can
    // resend from History when needed.

    await this.syncServesToLocal();
    return response;
  },

  async deleteServeAttempt(serveId: string) {
    await apiFetch(`/api/serves/${serveId}`, { method: "DELETE" });
    return true;
  },

  async resolveClientId(fallbackClientId: string) {
    try {
      const cases = await this.getClientCases(fallbackClientId);
      if (cases.length > 0) return fallbackClientId;
      const documents = await this.getClientDocuments(fallbackClientId);
      if (documents.length > 0) return fallbackClientId;
      const serves = await this.getClientServeAttempts(fallbackClientId);
      if (serves.length > 0) return fallbackClientId;
      return null;
    } catch {
      return null;
    }
  },

  async syncServesToLocal() {
    try {
      const result = await apiFetch<{ documents: Record<string, unknown>[] }>("/api/serves?limit=100");
      const frontendServes = result.documents.map((doc) => ({
        id: doc.id,
        clientId: doc.clientId,
        clientName: doc.clientName,
        caseNumber: doc.caseNumber,
        caseName: doc.caseName,
        coordinates: doc.coordinates,
        notes: doc.notes,
        status: doc.status,
        timestamp: doc.timestamp,
        attemptNumber: doc.attemptNumber,
        imageUrl: doc.imageUrl,
        imageFileId: doc.imageFileId,
        thumbnailUrl: doc.thumbnailUrl,
        thumbnailFileId: doc.thumbnailFileId,
        image_data: doc.image_data,
        address: doc.address,
        serviceAddress: doc.serviceAddress,
      }));

      localStorage.setItem("serve-tracker-serves", JSON.stringify(frontendServes));
      window.dispatchEvent(new CustomEvent("serves-updated"));
      return true;
    } catch (error) {
      console.error("Error syncing serves to local storage:", error);
      return false;
    }
  },

  async getCases(clientId?: string) {
    const url = clientId ? `/api/cases?client_id=${clientId}` : "/api/cases";
    return apiFetch<Record<string, unknown>[]>(url);
  },

  async getClientCases(clientId: string) {
    return apiFetch<Record<string, unknown>[]>(`/api/cases?client_id=${clientId}`);
  },

  async createCase(caseData: Record<string, unknown>) {
    return apiFetch("/api/cases", {
      method: "POST",
      body: JSON.stringify(caseData),
    });
  },

  async updateCase(caseId: string, caseData: Record<string, unknown>) {
    return apiFetch(`/api/cases/${caseId}`, {
      method: "PUT",
      body: JSON.stringify(caseData),
    });
  },

  async deleteClientCase(caseId: string) {
    await apiFetch(`/api/cases/${caseId}`, { method: "DELETE" });
    return true;
  },

  async updateCaseStatus(caseId: string, status: string) {
    return apiFetch(`/api/cases/${caseId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  },

  async markCasePaid(
    caseId: string,
    opts: { payment_method?: string; payment_notes?: string; paid_at?: string } = {},
  ) {
    return apiFetch<Record<string, unknown>>(`/api/cases/${caseId}/mark-paid`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
  },

  async markCaseUnpaid(caseId: string) {
    return apiFetch<Record<string, unknown>>(`/api/cases/${caseId}/mark-unpaid`, {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  async attachCaseInvoice(
    caseId: string,
    opts: {
      invoice_id?: string;
      invoice_number?: string;
      quoted_fee?: number;
      preview?: boolean;
    },
  ) {
    return apiFetch<Record<string, unknown>>(`/api/cases/${caseId}/invoice/attach`, {
      method: "POST",
      body: JSON.stringify(opts),
    });
  },

  async uploadClientDocument(clientId: string, file: File, caseNumber?: string, description?: string) {
    const form = new FormData();
    form.append("file", file);
    form.append("clientId", clientId);
    if (caseNumber) form.append("caseNumber", caseNumber);
    if (description) form.append("description", description);

    const res = await fetch(`${API_BASE}/api/documents`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async getClientDocuments(clientId: string, caseNumber?: string) {
    let path = `/api/documents?client_id=${clientId}`;
    if (caseNumber) path += `&case_number=${encodeURIComponent(caseNumber)}`;
    return apiFetch<Record<string, unknown>[]>(path);
  },

  async deleteClientDocument(docId: string, _fileId?: string) {
    await apiFetch(`/api/documents/${docId}`, { method: "DELETE" });
    return true;
  },

  async createBackup() {
    return apiFetch<{ success: boolean; path?: string; sizeMB?: string; timestamp?: string; error?: string }>(
      "/api/backup",
      { method: "POST" }
    );
  },

  async uploadToDrive() {
    return apiFetch<{ success: boolean; output?: string; error?: string }>(
      "/api/backup/upload",
      { method: "POST" }
    );
  },

  async getUsers() {
    return apiFetch<Array<{
      id: string;
      username: string;
      displayName: string;
      role: "admin" | "server";
      isActive: boolean;
      createdAt: string;
    }>>("/api/users");
  },

  async getUserDetail(id: string) {
    return apiFetch<Record<string, unknown>>(`/api/users/${id}`);
  },

  async createUser(userData: {
    username: string;
    password: string;
    displayName: string;
    role?: "admin" | "server";
    email?: string;
    phone?: string;
    legalName?: string;
    licenseNumber?: string;
    licenseJurisdiction?: string;
    licenseExpiresAt?: string;
    serviceTerritory?: string[];
    profileNotes?: string;
  }) {
    return apiFetch<{ success: boolean; user: any }>("/api/users", {
      method: "POST",
      body: JSON.stringify(userData),
    });
  },

  async updateUser(
    id: string,
    userData: {
      displayName?: string;
      password?: string;
      role?: string;
      isActive?: boolean;
      email?: string;
      phone?: string;
      legalName?: string;
      licenseNumber?: string;
      licenseJurisdiction?: string;
      licenseExpiresAt?: string;
      serviceTerritory?: string[];
      onboardingStatus?: string;
      profileNotes?: string;
    }
  ) {
    return apiFetch<{ success: boolean }>(`/api/users/${id}`, {
      method: "PUT",
      body: JSON.stringify(userData),
    });
  },

  async deleteUser(id: string) {
    return apiFetch<{
      success: boolean;
      deactivated?: boolean;
      signedAffidavits?: number;
      message?: string;
    }>(`/api/users/${id}`, {
      method: "DELETE",
    });
  },

  async revokeUserSessions(id: string) {
    return apiFetch<{ success: boolean }>(`/api/users/${id}/revoke-sessions`, {
      method: "POST",
    });
  },

  async revokeUserSignature(id: string) {
    return apiFetch<{ success: boolean }>(`/api/users/${id}/signature/revoke`, {
      method: "POST",
    });
  },

  // ---- Admin workload + assignment ----

  async getServerWorkload() {
    return apiFetch<import("@/types/ServerProfile").ServerWorkloadPayload>("/api/admin/server-workload");
  },

  async getServerCases(id: string) {
    return apiFetch<import("@/types/ServerProfile").ServerCaseDetail>(`/api/admin/servers/${id}/cases`);
  },

  async assignCase(caseId: string, serverId: string) {
    return apiFetch(`/api/admin/cases/${caseId}/assign`, {
      method: "POST",
      body: JSON.stringify({ serverId }),
    });
  },

  async unassignCase(caseId: string) {
    return apiFetch(`/api/admin/cases/${caseId}/unassign`, { method: "POST" });
  },

  // ---- Self-service profile + sessions ----

  async getMyProfile() {
    return apiFetch<Record<string, unknown>>("/api/me/profile");
  },

  async updateMyProfile(profile: {
    displayName?: string;
    email?: string;
    phone?: string;
    phoneSmsEnabled?: boolean;
    serviceTerritory?: string[];
    profileNotes?: string;
  }) {
    return apiFetch<{ success: boolean; user: unknown }>("/api/me/profile", {
      method: "PUT",
      body: JSON.stringify(profile),
    });
  },

  async changePassword(currentPassword: string, newPassword: string) {
    return apiFetch<{ success: boolean; message?: string }>("/api/me/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  async getMySessions() {
    const raw = await apiFetch<
      import("@/types/ServerProfile").SelfSessionList | import("@/types/ServerProfile").SessionInfo[]
    >("/api/me/sessions");
    if (Array.isArray(raw)) return { sessions: raw };
    return { sessions: raw?.sessions || [] };
  },

  async revokeOtherSessions(sessionId?: string) {
    return apiFetch<{ success: boolean }>("/api/me/sessions/revoke-other", {
      method: "POST",
      body: JSON.stringify(sessionId ? { sessionId } : {}),
    });
  },

  async logoutCurrentSession() {
    return apiFetch<{ success: boolean }>("/api/me/sessions/logout-current", {
      method: "POST",
    });
  },

  // ---- Signature enrollment (server self) ----

  async enrollSignature(payload: {
    password: string;
    image_data: string;
    mime_type: string;
    ack: boolean;
  }) {
    return apiFetch<{ success: boolean; status: string; assetId: string; updatedAt: string }>("/api/me/signature", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async deleteMySignature(password: string) {
    return apiFetch<{ success: boolean }>("/api/me/signature", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    });
  },

  // ---- Affidavit e-sign ----

  async prepareAffidavit(caseId: string, affidavitKind?: "service" | "non-service", recipientId?: string) {
    const res = await fetch(`${API_BASE}/api/affidavits/prepare`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ caseId, affidavitKind, recipientId }),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      return {
        ready: false,
        caseId,
        error:
          String((data as { error?: string }).error || (data as { message?: string }).message || text || `Request failed: ${res.status}`),
        ...data,
      } as import("@/types/AffidavitExecution").AffidavitPrepareResult;
    }
    return data as unknown as import("@/types/AffidavitExecution").AffidavitPrepareResult;
  },

  async signAffidavit(caseId: string, payload: {
    password?: string;
    acknowledged?: boolean;
    confirmation?: string;
    affidavitKind?: "service" | "non-service";
    recipientId?: string;
    notaryState?: string;
    notaryCounty?: string;
  }) {
    return apiFetch<import("@/types/AffidavitExecution").AffidavitSignResult>(`/api/affidavits/${caseId}/sign`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async renderAffidavit(caseId: string, recipientId?: string) {
    const q = recipientId ? `?recipientId=${encodeURIComponent(recipientId)}` : "";
    return apiFetch<import("@/types/AffidavitExecution").AffidavitRenderResult>(`/api/affidavits/${caseId}/render${q}`);
  },

  async auditAffidavit(caseId: string) {
    return apiFetch<import("@/types/AffidavitExecution").AffidavitAuditResult>(`/api/affidavits/${caseId}/audit`);
  },
};

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "server";
  mustChangePassword?: boolean;
  isActive?: boolean;
  onboardingStatus?: string;
  signatureEnrolled?: boolean;
}

export async function login(password: string, username?: string) {
  return apiFetch<{ success: boolean; token?: string; user?: CurrentUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password, username }),
  });
}

export async function logout() {
  return apiFetch("/api/auth/logout", { method: "POST" });
}

export async function checkAuth() {
  return apiFetch<{ authenticated: boolean; user?: CurrentUser }>("/api/auth/me");
}

export async function checkApiConnection() {
  try {
    await apiFetch("/api/health");
    return true;
  } catch {
    return false;
  }
}

export default api;

if (typeof window !== "undefined") {
  startOfflineSync((payload) =>
    apiFetch("/api/serves", {
      method: "POST",
      body: JSON.stringify(payload),
    })
  );
}
// cache-bust-1780205190
