// Server profile payloads shared by admin workload, intake, and self-service.

export type OnboardingStatus = "pending" | "active" | "suspended";

export type LicenseStatus =
  | "valid"
  | "expires_soon"
  | "expired"
  | "missing"
  | "n/a";

export interface SignatureStatus {
  enrolled: boolean;
  updatedAt?: string;
  revoked: boolean;
}

export interface ServerProfile {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "server";
  isActive: boolean;
  createdAt: string;

  // Intake / professional profile (admin view; self view is limited)
  email: string;
  phone: string;
  legalName: string;
  licenseNumber: string;
  licenseJurisdiction: string;
  licenseExpiresAt: string; // YYYY-MM-DD or ""
  serviceTerritory: string[];
  onboardingStatus: OnboardingStatus;
  mustChangePassword: boolean;
  profileNotes: string; // admin-only
  lastLoginAt: string;
  lastActivityAt: string;

  // Derived / admin extras
  activeCaseCount?: number;
  licenseStatus?: LicenseStatus;
  signatureStatus?: SignatureStatus;
  profileComplete?: boolean;
  licenseComplete?: boolean;
  phoneSmsEnabled?: boolean;
  googleLinked?: boolean;
  googleEmail?: string;
}

export interface WorkloadServer {
  id: string;
  username: string;
  displayName: string;
  legalName: string;
  role: "admin" | "server";
  isActive: boolean;
  onboardingStatus: OnboardingStatus;
  licenseStatus: LicenseStatus;
  licenseExpiresAt: string;
  email: string;
  phone: string;
  lastActivity: string;
  assignedActiveCases: number;
  noAttemptCases: number;
  stale48hCases: number;
  activityToday: number;
  activity7Days: number;
  /** "none" | "enrolled" | "revoked" */
  signatureStatus: string;
  profileCompleteness?: { profileComplete: boolean; licenseComplete: boolean };
}

export interface ServerWorkloadPayload {
  servers: WorkloadServer[];
  unassignedActiveCases: number;
}

export interface AssignmentEvent {
  id: string;
  case_id: string;
  previous_server_id: string;
  new_server_id: string;
  actor_user_id: string;
  occurred_at: string;
  note: string;
}

export interface ServerCaseDetail {
  cases: Record<string, unknown>[];
  assignment_history: AssignmentEvent[];
}

export interface SessionInfo {
  sessionId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string;
  current: boolean;
}

export interface SelfSessionList {
  sessions: SessionInfo[];
}

export interface ChangePasswordResult {
  success: boolean;
  message?: string;
}
