export interface ServeRecipient {
  id: string;
  case_id: string;
  client_id: string;
  full_name: string;
  role?: string;
  description?: string;
  status?: string;
  home_address?: string;
  work_address?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ServeAttemptPhoto {
  id: string;
  position: number;
  imageUrl: string;
  image_url: string;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  fileSize?: number;
}

export interface ServeAttemptEditLog {
  id: string;
  editedAt: string;
  editedBy?: string;
  oldNotes?: string;
  newNotes?: string;
  oldStatus?: string;
  newStatus?: string;
}

export interface ServeAttemptData {
  id?: string;
  client_id: string;
  case_name: string;
  case_number: string;
  description?: string;
  status: string;
  service_address?: string;
  created_at?: string;
  updated_at?: string;
  notes?: string;
  
  // Person Being Served & Case Links
  clientId?: string; // alias for client_id
  clientName?: string;
  clientEmail?: string;
  caseName?: string; // alias for case_name
  caseNumber?: string; // alias for case_number
  recipientId?: string;
  recipient_id?: string;
  personBeingServed?: string;
  person_being_served?: string;

  // Address & Geo
  serviceAddress?: string; // alias for service_address
  address?: string; // generic geocoded address field
  timestamp?: string | Date;
  occurredAt?: string;
  occurred_at?: string;
  enteredAt?: string;
  entered_at?: string;
  coordinates?: string | { latitude: number; longitude: number };
  gpsSource?: "captured" | "manual" | "none";
  gps_source?: "captured" | "manual" | "none";

  // Attempt Specs & Manual Flags
  attemptNumber?: number;
  attempt_number?: number;
  attemptType?: "physical" | "phone" | "neighbor" | "management" | "other";
  attempt_type?: "physical" | "phone" | "neighbor" | "management" | "other";
  contactPerson?: string;
  contact_person?: string;
  isManual?: boolean;
  is_manual?: boolean;
  resultDetail?: string;
  result_detail?: string;
  physicalDescription?: string | any;
  physical_description?: string | any;

  // Method of service for the successful serve + who actually received the papers.
  // serviceMethod: '' (legacy/unknown) | personal | substituted-residence |
  // substituted-business | posting | non-service
  serviceMethod?: string;
  service_method?: string;
  /** Name of the person who received the papers (co-resident, manager, etc.) for substituted/posting service */
  acceptedBy?: string;
  accepted_by?: string;
  /** True when the person who received the papers refused to identify themselves */
  refusedToIdentify?: boolean;
  refused_to_identify?: boolean;
  /** Where copies were posted (posting method): front_door | conspicuous_place */
  postingLocation?: string;
  posting_location?: string;
  /** Company / registered agent name (corporate method) */
  corporateAgent?: string;
  corporate_agent?: string;
  entityName?: string;
  entity_name?: string;
  recipientTitle?: string;
  recipient_title?: string;
  original_filename?: string;
  originalFilename?: string;

  // Legacy single image & Multi-Photo Gallery
  imageData?: string;
  image_data?: string;
  image_url?: string;
  imageUrl?: string;
  image_file_id?: string;
  imageFileId?: string;
  thumbnailUrl?: string;
  thumbnailFileId?: string;
  photos?: ServeAttemptPhoto[];
  edits?: ServeAttemptEditLog[];

  // Case Metadata
  court_name?: string;
  plaintiff_petitioner?: string;
  defendant_respondent?: string;
  home_address?: string;
  work_address?: string;
  documents_to_serve?: string;
  service_requirements?: string;
  contact_info?: string;
}
