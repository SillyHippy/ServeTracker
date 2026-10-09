import type { ServeAttemptData } from "@/types/ServeAttemptData";

/** Keep update payloads explicit: the saved entry timestamp and GPS are never editable. */
export function serveEditPayload(serve: ServeAttemptData): Record<string, unknown> {
  const method = serve.serviceMethod || serve.service_method || "";
  const acceptedBy = serve.acceptedBy || serve.accepted_by || "";
  const posting = serve.postingLocation || serve.posting_location || "";
  const entity = serve.corporateAgent || serve.corporate_agent || serve.entityName || serve.entity_name || "";
  const title = serve.recipientTitle || serve.recipient_title || "";
  return {
    status: serve.status,
    notes: serve.notes || "",
    ...(Object.prototype.hasOwnProperty.call(serve, "occurredAt") || Object.prototype.hasOwnProperty.call(serve, "occurred_at")
      ? { occurredAt: serve.occurredAt || serve.occurred_at } : {}),
    serviceMethod: method, service_method: method,
    acceptedBy, accepted_by: acceptedBy,
    postingLocation: posting, posting_location: posting,
    corporateAgent: entity, corporate_agent: entity,
    entityName: entity, entity_name: entity,
    recipientTitle: title, recipient_title: title,
  };
}
