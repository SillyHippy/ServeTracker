import React from "react";
import { ServeAttemptData } from "@/types/ServeAttemptData";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Calendar, MapPin, Edit, Trash2, Clock, ClipboardList, User, ShieldCheck, FileCheck, Layers, Plus } from "lucide-react";
import AffidavitGenerator from "@/components/AffidavitGenerator";
import FieldSheetButton from "@/components/FieldSheetButton";
import { ClientData } from "@/components/ClientForm";
import { useAuth } from "@/context/AuthContext";

interface ServeHistoryProps {
  serves: ServeAttemptData[];
  clients: ClientData[];
  onEdit?: (serve: ServeAttemptData) => void;
  onDelete?: (serveId: string) => void;
}

const formatDate = (date: string | Date | undefined): string => {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
};

const formatCoordinates = (coords: unknown): string => {
  if (!coords) return "Location unavailable";
  if (typeof coords === "string") {
    if (coords.trim() === "" || coords === "No coordinates") return "Location unavailable";
    return coords;
  }
  if (typeof coords === "object" && coords !== null && "latitude" in coords && "longitude" in coords) {
    const obj = coords as { latitude: number; longitude: number };
    return `${obj.latitude.toFixed(6)}, ${obj.longitude.toFixed(6)}`;
  }
  return "Location unavailable";
};

const getGoogleMapsLink = (coords: unknown): string | null => {
  if (!coords) return null;
  if (typeof coords === "string" && coords.includes(",")) {
    return `https://www.google.com/maps?q=${coords}`;
  }
  if (typeof coords === "object" && coords !== null && "latitude" in coords && "longitude" in coords) {
    const obj = coords as { latitude: number; longitude: number };
    return `https://www.google.com/maps?q=${obj.latitude},${obj.longitude}`;
  }
  return null;
};

export const ServeHistory: React.FC<ServeHistoryProps> = ({ serves, clients, onEdit, onDelete }) => {
  const navigate = useNavigate();
  const { isAdmin, isServer } = useAuth();
  if (!serves || serves.length === 0) {
    return (
      <div className="text-center p-8 border rounded-lg bg-slate-50 dark:bg-slate-900 text-slate-500">
        <p>No serve history found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {serves.map((serve) => {
          if (!serve || !serve.id) return null;

          const client = clients.find((c) => c.id === serve.clientId || c.id === serve.client_id);
          const clientName = serve.clientName || (serve as any).client_name || client?.name || "Client";
          const pbs = serve.personBeingServed || serve.person_being_served || serve.caseName || serve.case_name || "Target Recipient";
          const googleMapsLink = getGoogleMapsLink(serve.coordinates);
          const caseServes = serves.filter((s) => (s.clientId === serve.clientId || s.client_id === serve.client_id) && (s.caseNumber === serve.caseNumber || s.case_number === serve.case_number));
          const hasEdits = serve.edits && serve.edits.length > 0;
          const photos = serve.photos && serve.photos.length > 0 ? serve.photos : (serve.imageUrl || serve.image_url ? [{ id: "p1", position: 1, imageUrl: serve.imageUrl || serve.image_url!, image_url: serve.imageUrl || serve.image_url! }] : []);

          return (
            <Card key={serve.id} className="border border-slate-200 dark:border-slate-800 shadow-sm hover:shadow-md transition">
              <CardHeader className="pb-2 bg-slate-50/50 dark:bg-slate-900/50">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-1.5 font-bold text-slate-900 dark:text-slate-100 text-base">
                      <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>{pbs}</span>
                    </div>
                    {!isServer && (
                    <div className="text-xs text-slate-500 font-medium">Client: {clientName}</div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <FieldSheetButton
                      data={{
                        caseId: (serve as any).caseId || (serve as any).case_id,
                        caseNumber: serve.caseNumber || serve.case_number,
                        caseName: serve.caseName || serve.case_name,
                        courtName: serve.court_name,
                        plaintiff: serve.plaintiff_petitioner,
                        defendant: serve.defendant_respondent,
                        documents: (serve as any).documents_to_serve || "",
                        requirements: (serve as any).service_requirements || "",
                        contactInfo: (serve as any).contact_info || "",
                        notes: serve.notes,
                        homeAddress: serve.home_address || serve.serviceAddress || serve.service_address || serve.address,
                        workAddress: serve.work_address,
                        personToServe: pbs,
                        assignedServer: (serve as any).loggedByName || (serve as any).logged_by_name || "",
                        clientName,
                        clientId: serve.clientId || (serve as any).client_id,
                        hideClient: isServer,
                      }}
                    />
                    {(isAdmin || isServer) && (
                      <AffidavitGenerator
                        client={client || ({
                          id: serve.clientId || serve.client_id || '',
                          name: serve.clientName || (serve as any).client_name || 'Client',
                          email: '', phone: '', address: '', notes: '',
                        } as ClientData)}
                        serves={caseServes}
                        caseNumber={serve.caseNumber || serve.case_number}
                        caseName={serve.caseName || serve.case_name}
                        personBeingServed={pbs}
                        courtName={serve.court_name}
                        plaintiffPetitioner={serve.plaintiff_petitioner}
                        defendantRespondent={serve.defendant_respondent}
                        homeAddress={serve.home_address}
                        workAddress={serve.work_address}
                        documentsToServe={(serve as any).documents_to_serve || ""}
                      />
                    )}
                    <span
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                        serve.status === "completed" || serve.status === "served"
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      }`}
                    >
                      {serve.status === "completed" || serve.status === "served" ? "Successful" : "Unsuccessful"}
                    </span>
                  </div>
                </div>

                <CardDescription className="pt-1 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1">
                    <ClipboardList className="h-3.5 w-3.5" />
                    <span>Case: {serve.caseNumber || serve.case_number}</span>
                  </span>

                  <div className="flex gap-1">
                    <span className="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold">
                      {(serve.attemptType || serve.attempt_type || "physical").toUpperCase()}
                    </span>
                    {(serve.status === "completed" || serve.status === "served") && (serve.serviceMethod || serve.service_method) ? (
                      <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold">
                        {(serve.serviceMethod || serve.service_method)}
                      </span>
                    ) : null}
                    {serve.gpsSource === "captured" || serve.gps_source === "captured" ? (
                      <span className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-0.5">
                        <ShieldCheck className="w-2.5 h-2.5" /> GPS
                      </span>
                    ) : (
                      <span className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 text-[10px] px-1.5 py-0.5 rounded font-semibold">
                        Manual
                      </span>
                    )}
                    {hasEdits && (
                      <span className="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 text-[10px] px-1.5 py-0.5 rounded font-semibold">
                        Edited
                      </span>
                    )}
                  </div>
                </CardDescription>
              </CardHeader>

              <CardContent className="py-3 text-xs space-y-2">
                {/* Photo Exhibit Gallery Grid */}
                {photos.length > 0 && (
                  <div className="grid grid-cols-5 gap-1.5 mb-2">
                    {photos.map((p, idx) => (
                      <div key={idx} className="relative aspect-square rounded border overflow-hidden bg-slate-900">
                        <img src={p.imageUrl || p.image_url} alt="Exhibit" className="w-full h-full object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] text-center font-bold">
                          #{p.position || idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs border-t pt-2 dark:border-slate-800">
                  <div>
                    <p className="font-medium text-slate-500 flex items-center gap-1">
                      <Calendar className="h-3 w-3" /> Event Time
                    </p>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {formatDate(serve.occurredAt || serve.occurred_at || serve.timestamp)}
                    </p>
                  </div>

                  <div>
                    <p className="font-medium text-slate-500 flex items-center gap-1">
                      <MapPin className="h-3 w-3" /> Location
                    </p>
                    {googleMapsLink ? (
                      <a href={googleMapsLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">
                        {formatCoordinates(serve.coordinates)}
                      </a>
                    ) : (
                      <p className="text-slate-600 dark:text-slate-400 truncate">{formatCoordinates(serve.coordinates)}</p>
                    )}
                  </div>
                </div>

                {serve.contactPerson || serve.contact_person ? (
                  <div className="text-xs bg-slate-50 dark:bg-slate-900 p-1.5 rounded border border-slate-200 dark:border-slate-800">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Spoke To:</span>{" "}
                    <span className="text-slate-900 dark:text-slate-100">{serve.contactPerson || serve.contact_person}</span>
                  </div>
                ) : null}

                {serve.notes && (
                  <div className="space-y-1 text-xs pt-1">
                    <p className="font-medium text-slate-500">Notes</p>
                    <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap bg-slate-50 dark:bg-slate-900/50 p-2 rounded border border-slate-100 dark:border-slate-800">
                      {serve.notes}
                    </p>
                  </div>
                )}
              </CardContent>

              <CardFooter className="pt-2 border-t dark:border-slate-800 flex justify-between items-center text-[11px] text-slate-400">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>Logged: {formatDate(serve.enteredAt || serve.entered_at || serve.timestamp)}</span>
                </div>

                <div className="flex gap-1 items-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 h-11 px-3 text-xs font-semibold"
                    onClick={() => {
                      const params = new URLSearchParams();
                      const clientId = String(serve.clientId || serve.client_id || "");
                      const caseId = String((serve as any).caseId || (serve as any).case_id || "");
                      const caseNumber = String(serve.caseNumber || serve.case_number || "");
                      const recipientId = String(serve.recipientId || serve.recipient_id || "");
                      const person = String(serve.personBeingServed || serve.person_being_served || "");
                      const address = String(serve.serviceAddress || serve.service_address || serve.address || "");
                      if (clientId) params.set("clientId", clientId);
                      if (caseId) params.set("caseId", caseId);
                      if (caseNumber) params.set("caseNumber", caseNumber);
                      if (recipientId) params.set("recipientId", recipientId);
                      if (person) params.set("person", person);
                      if (address) params.set("address", address);
                      params.set("step", "confirm");
                      navigate(`/new-serve?${params.toString()}`);
                    }}
                    aria-label="Log another attempt for this case"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Log another
                  </Button>
                    {onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 min-w-11 h-11 w-11 p-0"
                      onClick={() => onEdit(serve)}
                      aria-label="Edit serve attempt"
                    >
                      <Edit className="h-4 w-4 text-slate-600 hover:text-blue-600" />
                    </Button>
                  )}
                  {!isServer && onDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-11 min-w-11 h-11 w-11 p-0 hover:text-red-600"
                      onClick={() => onDelete(serve.id!)}
                      aria-label="Delete serve attempt"
                    >
                      <Trash2 className="h-4 w-4 text-slate-600 hover:text-red-600" />
                    </Button>
                  )}
                </div>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default ServeHistory;
