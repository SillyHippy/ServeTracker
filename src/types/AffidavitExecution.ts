// Affidavit execution (e-signature) records.

export type ExecutionStatus = "signed_not_notarized" | "void" | "finalized";

export type ApplicationMode = "server_self" | "admin_on_behalf";

export interface AffidavitExecution {
  id: string;
  caseId: string;
  clientId: string;
  assignedServerId: string;
  signedByUserId: string;
  signedByName: string;
  appliedByUserId: string;
  appliedByName: string;
  applicationMode: ApplicationMode;
  status: ExecutionStatus;
  sourceHash: string;
  renderedHash: string;
  supersedesExecutionId: string;
  invalidatedAt: string;
  invalidationReason: string;
  createdAt: string;
  signedAt: string;
  finalizedAt: string;
}

export interface AffidavitPrepareResult {
  ready: boolean;
  caseId: string;
  sourceHash?: string;
  assignedServer?: {
    id: string;
    legalName: string;
    displayName: string;
    licenseNumber: string;
    licenseJurisdiction: string;
    signatureEnrolled: boolean;
  };
  preview?: {
    title: string;
    caseNumber: string;
    personServed: string;
    documents: string;
    attemptsCount: number;
    kind?: "service" | "non-service";
    method: string;
    methodRecorded: boolean;
    acceptedBy: string;
  };
  executionStatus?: ExecutionStatus | "none";
  error?: string;
}

export interface AffidavitSignResult {
  success: boolean;
  status: ExecutionStatus;
  execution: AffidavitExecution;
}

export interface AffidavitRenderResult {
  execution: AffidavitExecution;
  html: string;
}

export interface AffidavitAuditResult {
  executions: AffidavitExecution[];
}
