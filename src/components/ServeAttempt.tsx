import React, { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ClientData } from "./ClientForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { embedGpsIntoImage, getGpsPosition, formatCoordinates } from "@/utils/gps";
import { useToast } from "@/components/ui/use-toast";
import { MapPin, Camera, Search, User, Plus, Calendar, Home, Briefcase, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { ServeAttemptData, ServeRecipient } from "@/types/ServeAttemptData";
import { PhotoUploader, PhotoSlot } from "./PhotoUploader";

interface ServeAttemptProps {
  clients: ClientData[];
  onComplete: (data: ServeAttemptData) => void;
  previousAttempts?: number;
}

interface ClientCase {
  id?: string;
  caseNumber: string;
  caseName?: string;
  homeAddress?: string;
  workAddress?: string;
  clientId?: string;
  clientName?: string;
  personEntityBeingServed?: string;
  defendantRespondent?: string;
  status?: string;
}

const serveAttemptSchema = z.object({
  clientId: z.string().optional(),
  caseNumber: z.string().min(1, { message: "Please select a case" }),
  notes: z.string().optional(),
  status: z.enum(["completed", "failed"]),
  serviceAddress: z.string().optional(),
});

type ServeFormValues = z.infer<typeof serveAttemptSchema>;

const STICKY_CASE_KEY = "servetracker.beta.lastActiveCase";

const filterCases = (cases: ClientCase[], query: string) => {
  if (!query.trim()) return cases;
  const q = query.toLowerCase();
  return cases.filter(
    (c) =>
      c.caseNumber?.toLowerCase().includes(q) ||
      c.caseName?.toLowerCase().includes(q) ||
      c.homeAddress?.toLowerCase().includes(q) ||
      c.workAddress?.toLowerCase().includes(q) ||
      c.clientName?.toLowerCase().includes(q) ||
      c.personEntityBeingServed?.toLowerCase().includes(q) ||
      c.defendantRespondent?.toLowerCase().includes(q)
  );
};

export const ServeAttempt: React.FC<ServeAttemptProps> = ({ clients, onComplete }) => {
  // Intermediate Camera Capture page removed — select → confirm (photos + GPS on same page)
  const { isServer } = useAuth();
  const [searchParams] = useSearchParams();
  const deepLinkApplied = useRef(false);
  const stickyApplied = useRef(false);
  const [step, setStep] = useState<"select" | "confirm">("select");
  const [isManualLog, setIsManualLog] = useState<boolean>(false);
  const [location, setLocation] = useState<GeolocationCoordinates | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null);
  const [clientCases, setClientCases] = useState<ClientCase[]>([]);
  const [allCases, setAllCases] = useState<ClientCase[]>([]);
  const [selectedCase, setSelectedCase] = useState<ClientCase | null>(null);

  const [recipients, setRecipients] = useState<ServeRecipient[]>([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>("");
  const [newRecipientName, setNewRecipientName] = useState<string>("");
  const [isAddingRecipient, setIsAddingRecipient] = useState<boolean>(false);

  const [attemptType, setAttemptType] = useState<"physical" | "phone" | "neighbor" | "management" | "other">("physical");
  const [contactPerson, setContactPerson] = useState<string>("");
  const [occurredAt, setOccurredAt] = useState<string>(new Date().toISOString().slice(0, 16));
  const [photos, setPhotos] = useState<PhotoSlot[]>([]);

  // Method of service (only meaningful when Result = Served / completed)
  const [serviceMethod, setServiceMethod] = useState<string>("personal");
  const [acceptedBy, setAcceptedBy] = useState<string>("");
  const [refusedToIdentify, setRefusedToIdentify] = useState(false);
  const [postingLocation, setPostingLocation] = useState<string>("");
  const [corporateAgent, setCorporateAgent] = useState<string>("");
  const [moreMethodsOpen, setMoreMethodsOpen] = useState(false);

  const [addressSearchTerm, setAddressSearchTerm] = useState("");
  const [addressSearchOpen, setAddressSearchOpen] = useState(false);
  const [isLoadingCases, setIsLoadingCases] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const { toast } = useToast();
  const isMobile = useIsMobile();

  const form = useForm<ServeFormValues>({
    resolver: zodResolver(serveAttemptSchema),
    defaultValues: { clientId: "", caseNumber: "", notes: "", status: "failed", serviceAddress: "" },
  });

  useEffect(() => { fetchAllCases(); }, [clients]);

  const fetchAllCases = async () => {
    setIsLoadingCases(true);
    try {
      // Use api.getCases() — it prefixes the public base path (e.g. /servetracker-staging)
      // and the server filters to assigned-only cases for field-server role.
      const rawCases = await api.getCases();
      if (Array.isArray(rawCases)) {
        const formatted: ClientCase[] = rawCases.map((c: any) => {
          const client = clients.find((cl) => cl.id === c.client_id || (cl as any).$id === c.client_id);
          return {
            id: c.id, caseNumber: c.case_number, caseName: c.case_name,
            homeAddress: c.home_address, workAddress: c.work_address,
            clientId: c.client_id, clientName: client?.name || "Client",
            personEntityBeingServed: c.defendant_respondent || c.case_name || "",
            defendantRespondent: c.defendant_respondent || "",
            status: c.status || "Open",
          };
        });
        setAllCases(formatted);
      }
    } catch (err) { console.error("Error fetching cases:", err); }
    finally { setIsLoadingCases(false); }
  };

  // New Serve list = ACTIVE cases only (exclude closed/completed)
  const isInactiveCase = (c: ClientCase) => {
    const s = (c.status || "").toLowerCase().trim();
    return s === "closed" || s === "completed";
  };

  const activeCases = useMemo(
    () => allCases.filter((c) => !isInactiveCase(c)),
    [allCases]
  );

  const filteredCases = useMemo(
    () => filterCases(activeCases, addressSearchTerm),
    [activeCases, addressSearchTerm]
  );

  const normalizeName = (name?: string) =>
    (name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /** Pick PBS for THIS case only — prefer defendant/respondent match, never another case's person. */
  const pickRecipientForCase = (recs: ServeRecipient[], caseItem: ClientCase | null) => {
    if (!recs.length) return "";
    const defendant = normalizeName(
      caseItem?.defendantRespondent || caseItem?.personEntityBeingServed || caseItem?.caseName
    );
    if (defendant) {
      const exact = recs.find((r) => normalizeName(r.full_name) === defendant);
      if (exact?.id) return exact.id;
      const partial = recs.find((r) => {
        const n = normalizeName(r.full_name);
        return n.includes(defendant) || defendant.includes(n);
      });
      if (partial?.id) return partial.id;
    }
    const defendantRole = recs.find((r) =>
      /defendant|respondent|target/i.test(r.role || "")
    );
    if (defendantRole?.id) return defendantRole.id;
    return "";
  };

  const fetchRecipientsForCase = async (caseItem: ClientCase) => {
    try {
      // CRITICAL: filter by case_id only — never by client_id (would mix other cases)
      const recs = caseItem.id ? await api.getRecipients(caseItem.id) : [];
      setRecipients(recs);
      setSelectedRecipientId(pickRecipientForCase(recs, caseItem));
    } catch (err) {
      console.error("Error fetching recipients:", err);
      setRecipients([]);
      setSelectedRecipientId("");
    }
  };

  const handleAddressSelect = (caseItem: ClientCase) => {
    const client = clients.find((c) => c.id === caseItem.clientId || (c as any).$id === caseItem.clientId) || null;
    setSelectedClient(client);
    setClientCases(allCases.filter((c) => c.clientId === caseItem.clientId && !isInactiveCase(c)));
    setSelectedCase(caseItem);
    setAddressSearchTerm("");
    form.setValue("clientId", caseItem.clientId || "");
    form.setValue("caseNumber", caseItem.caseNumber || "");
    // Auto-fill address from case
    form.setValue("serviceAddress", caseItem.homeAddress || caseItem.workAddress || "");
    setAddressSearchOpen(false);
    // Clear prior case PBS immediately so UI never shows previous case's person
    setRecipients([]);
    setSelectedRecipientId("");
    fetchRecipientsForCase(caseItem);
    try {
      if (caseItem.id && !isInactiveCase(caseItem)) {
        localStorage.setItem(
          STICKY_CASE_KEY,
          JSON.stringify({
            caseId: caseItem.id,
            clientId: caseItem.clientId,
            caseNumber: caseItem.caseNumber,
          })
        );
      }
    } catch { /* ignore */ }
  };

  const handleClientChange = (clientId: string) => {
    const client = clients.find((c) => c.id === clientId || (c as any).$id === clientId) || null;
    setSelectedClient(client);
    setClientCases(allCases.filter((c) => c.clientId === clientId && !isInactiveCase(c)));
    setSelectedCase(null);
    setRecipients([]);
    setSelectedRecipientId("");
    form.setValue("caseNumber", "");
  };

  const handleCaseChange = (caseNumber: string) => {
    const found = clientCases.find((c) => c.caseNumber === caseNumber) || null;
    setSelectedCase(found);
    setRecipients([]);
    setSelectedRecipientId("");
    if (found) {
      form.setValue("serviceAddress", found.homeAddress || found.workAddress || "");
      fetchRecipientsForCase(found);
    }
  };

  const handleAddRecipient = async () => {
    if (!newRecipientName.trim() || !selectedCase?.id) return;
    try {
      const created = await api.createRecipient({
        case_id: selectedCase.id,
        client_id: selectedClient?.id || (selectedClient as any)?.$id || selectedCase.clientId || "",
        full_name: newRecipientName.trim(), role: "Target Recipient",
      });
      setRecipients([...recipients, created]);
      setSelectedRecipientId(created.id);
      setNewRecipientName("");
      setIsAddingRecipient(false);
      toast({ title: "Recipient Added", description: `Added ${(created as any).full_name}` });
    } catch { toast({ title: "Error", description: "Failed to add recipient", variant: "destructive" }); }
  };

  /** Lock current GPS as soon as Field Capture opens the log page */
  const lockGpsNow = async () => {
    setGpsStatus("loading");
    setLocation(null);
    try {
      const pos = await getGpsPosition();
      setLocation(pos.coords);
      setGpsStatus("ready");
    } catch (err) {
      console.error("GPS lock failed:", err);
      setGpsStatus("error");
      toast({
        title: "GPS unavailable",
        description: "Could not lock location. You can still save — GPS will be marked manual.",
        variant: "destructive",
      });
    }
  };


  // Deep-link: /new-serve?clientId&caseId&...&step=confirm (Log another attempt)
  useEffect(() => {
    if (deepLinkApplied.current || allCases.length === 0 || clients.length === 0) return;
    const caseId = searchParams.get("caseId") || "";
    const clientId = searchParams.get("clientId") || "";
    const caseNumber = searchParams.get("caseNumber") || "";
    if (!caseId && !(clientId && caseNumber)) return;

    const found =
      (caseId ? allCases.find((c) => c.id === caseId) : undefined) ||
      allCases.find((c) => c.clientId === clientId && c.caseNumber === caseNumber) ||
      null;
    if (!found) return;

    deepLinkApplied.current = true;
    stickyApplied.current = true;
    const client = clients.find((c) => c.id === found.clientId || (c as any).$id === found.clientId) || null;
    setSelectedClient(client);
    setSelectedCase(found);
    setClientCases(allCases.filter((c) => c.clientId === found.clientId && !isInactiveCase(c)));
    form.setValue("clientId", found.clientId || "");
    form.setValue("caseNumber", found.caseNumber || "");
    const addr = searchParams.get("address") || found.homeAddress || found.workAddress || "";
    if (addr) form.setValue("serviceAddress", addr);
    const recipientId = searchParams.get("recipientId") || "";
    void (async () => {
      await fetchRecipientsForCase(found);
      if (recipientId) setSelectedRecipientId(recipientId);
    })();
    const stepParam = searchParams.get("step");
    if (stepParam === "confirm" || stepParam === "manual") {
      if (stepParam === "manual") {
        setIsManualLog(true);
        setGpsStatus("idle");
        setLocation(null);
      } else {
        setIsManualLog(false);
        void lockGpsNow();
      }
      setStep("confirm");
    }
  }, [allCases, clients, searchParams]);

  // Sticky last active case (only when no deep-link params)
  useEffect(() => {
    if (stickyApplied.current || deepLinkApplied.current || allCases.length === 0 || clients.length === 0) return;
    if (searchParams.get("caseId") || searchParams.get("clientId") || searchParams.get("caseNumber")) return;
    try {
      const raw = localStorage.getItem(STICKY_CASE_KEY);
      if (!raw) { stickyApplied.current = true; return; }
      const sticky = JSON.parse(raw) as { caseId?: string; clientId?: string; caseNumber?: string };
      const found =
        allCases.find((c) => c.id && sticky.caseId && c.id === sticky.caseId) ||
        allCases.find((c) => c.clientId === sticky.clientId && c.caseNumber === sticky.caseNumber);
      if (!found || isInactiveCase(found)) {
        if (found && isInactiveCase(found)) localStorage.removeItem(STICKY_CASE_KEY);
        stickyApplied.current = true;
        return;
      }
      stickyApplied.current = true;
      const client = clients.find((c) => c.id === found.clientId || (c as any).$id === found.clientId) || null;
      setSelectedClient(client);
      setSelectedCase(found);
      setClientCases(allCases.filter((c) => c.clientId === found.clientId && !isInactiveCase(c)));
      form.setValue("clientId", found.clientId || "");
      form.setValue("caseNumber", found.caseNumber || "");
      if (found.homeAddress) form.setValue("serviceAddress", found.homeAddress);
      void fetchRecipientsForCase(found);
    } catch {
      stickyApplied.current = true;
    }
  }, [allCases, clients, searchParams]);

  const startFieldCapture = () => {
    setIsManualLog(false);
    setStep("confirm");
    void lockGpsNow();
  };

  const startManualLog = () => {
    setIsManualLog(true);
    setGpsStatus("idle");
    setLocation(null);
    setStep("confirm");
  };

  // PBS: selected recipient for THIS case, else case defendant/respondent (never another case)
  const pbsName = useMemo(() => {
    const r = selectedRecipientId
      ? recipients.find((rec) => rec.id === selectedRecipientId)
      : undefined;
    return (
      r?.full_name ||
      selectedCase?.defendantRespondent ||
      selectedCase?.personEntityBeingServed ||
      selectedCase?.caseName ||
      ""
    ).trim();
  }, [recipients, selectedRecipientId, selectedCase]);

  const handleSubmit = async (data: ServeFormValues) => {
    if (!selectedCase) {
      toast({ title: "Missing Information", description: "Please select a case.", variant: "destructive" });
      return;
    }
    // Method of service validation — only for successful serves (the affidavit
    // wording depends on it; Joseph refuses to sign a false affidavit).
    if (data.status === "completed") {
      if (!serviceMethod) {
        toast({ title: "Method required", description: "Select how they were served (Personal or Substitute).", variant: "destructive" });
        return;
      }
      const needsAccepted = ["substituted-residence", "substituted-business", "corporate"].includes(serviceMethod);
      if (needsAccepted && !refusedToIdentify && !acceptedBy.trim()) {
        toast({ title: "Accepted By required", description: "Enter the name of the person who received the papers.", variant: "destructive" });
        return;
      }
      if (serviceMethod === "posting" && !postingLocation) {
        toast({ title: "Posting location required", description: "Select where copies were posted.", variant: "destructive" });
        return;
      }
      if (serviceMethod === "corporate" && !corporateAgent.trim()) {
        toast({ title: "Agent/company required", description: "Enter the registered agent or company name.", variant: "destructive" });
        return;
      }
    }
    setIsSending(true);
    try {
      let mainImageData = photos[0]?.imageData;
      if (mainImageData && location) mainImageData = embedGpsIntoImage(mainImageData, location);
      const ts = isManualLog ? new Date(occurredAt).toISOString() : new Date().toISOString();
      const clientId = selectedClient ? (selectedClient.id || (selectedClient as any).$id) : (selectedCase.clientId || "");
      const clientName = selectedClient?.name || selectedCase.clientName || "";
      const clientEmail = selectedClient?.email || "";
      const serveData: any = {
        client_id: clientId,
        clientId: clientId,
        clientName: clientName, clientEmail: clientEmail,
        case_id: selectedCase.id || "", caseId: selectedCase.id || "",
        case_number: selectedCase.caseNumber, caseNumber: selectedCase.caseNumber,
        case_name: selectedCase.caseName || "", caseName: selectedCase.caseName || "",
        recipient_id: selectedRecipientId === "default_pbs" ? "" : selectedRecipientId,
        person_being_served: pbsName, personEntityBeingServed: pbsName,
        imageData: mainImageData,
        coordinates: location ? `${location.latitude},${location.longitude}` : "",
        address: data.serviceAddress || selectedCase.homeAddress || selectedCase.workAddress || (selectedClient?.address || ""),
        serviceAddress: data.serviceAddress, notes: data.notes || "",
        timestamp: ts, occurred_at: ts, status: data.status,
        attempt_type: attemptType,
        gps_source: !isManualLog && location ? "captured" : "manual",
        contact_person: contactPerson, is_manual: isManualLog, photos: photos as any,
        serviceMethod, service_method: serviceMethod,
        acceptedBy: refusedToIdentify ? "" : acceptedBy,
        accepted_by: refusedToIdentify ? "" : acceptedBy,
        refusedToIdentify, refused_to_identify: refusedToIdentify,
        postingLocation, posting_location: postingLocation,
        corporateAgent, corporate_agent: corporateAgent,
      };
      // Single POST only — NewServe.onComplete must NOT createServeAttempt again.
      const saved = await api.createServeAttempt(serveData);
      if ((saved as any)?.offlineQueued) {
        toast({ title: "Saved on this phone", description: "No signal — will upload when you are back online." });
      } else {
        toast({ title: "Serve recorded", description: `Attempt saved for ${pbsName}` });
      }
      form.reset(); setLocation(null); setGpsStatus("idle");
      setSelectedClient(null); setSelectedCase(null); setPhotos([]);
      setIsManualLog(false); setStep("select");
      if (onComplete) onComplete({ ...serveData, ...(saved || {}), id: (saved as any)?.id || serveData.id });
    } catch (err) {
      console.error("Error saving:", err);
      const msg = err instanceof Error ? err.message : "Failed to save attempt.";
      toast({ title: "Error", description: msg.slice(0, 240), variant: "destructive" });
    } finally { setIsSending(false); }
  };

  // Field servers never get a Client object (GET /api/clients is empty and case.client_id is stripped).
  // Capture/manual-log must enable from the assigned case alone.
  const isCaseSelected = Boolean(selectedCase);

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      {step === "select" && (
        <Card className="border border-slate-200 dark:border-slate-800 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Search className="w-5 h-5 text-blue-600" />
              Select Case
            </CardTitle>
            <CardDescription className="text-xs">Search by person, case #, address, or client</CardDescription>
          </CardHeader>

          <CardContent className="space-y-3">
            <Form {...form}>
              <form className="space-y-3">
                {/* Quick Search — ACTIVE cases only */}
                <Popover open={addressSearchOpen} onOpenChange={setAddressSearchOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between text-left h-11">
                      <span className="truncate text-xs">
                        {selectedCase
                          ? `${selectedCase.defendantRespondent || selectedCase.caseName} — ${selectedCase.caseNumber}`
                          : "Search active cases by name, case #, or address..."}
                      </span>
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent sideOffset={6} className={`${isMobile ? "w-[calc(100vw-2rem)]" : "w-[450px]"} p-0`}>
                    <Command>
                      <CommandInput placeholder="Type name, case #, address..." value={addressSearchTerm} onValueChange={setAddressSearchTerm} />
                      <CommandEmpty>{isLoadingCases ? "Loading..." : "No active cases found."}</CommandEmpty>
                      <CommandList className={isMobile ? "max-h-[50vh]" : "max-h-[300px]"}>
                        <CommandGroup heading={`Active Cases (${filteredCases.length})`}>
                          {filteredCases.map((c) => (
                            <CommandItem
                              key={`${c.clientId}-${c.caseNumber}`}
                              value={`${c.defendantRespondent}-${c.caseNumber}-${c.clientName}-${c.homeAddress}`}
                              onSelect={() => handleAddressSelect(c)}
                              className={`flex flex-col w-full ${isMobile ? "py-3" : "py-1.5"}`}
                            >
                              <div className="flex justify-between items-center w-full">
                                <span className="font-bold text-sm">{c.defendantRespondent || c.caseName}</span>
                                <span className="text-[10px] bg-blue-100 text-blue-800 font-semibold px-1.5 py-0.5 rounded">{c.caseNumber}</span>
                              </div>
                              {!isServer && c.clientName && c.clientName !== "Client" && (
                                <span className="text-xs text-slate-500">Client: {c.clientName}</span>
                              )}
                              {c.homeAddress && <span className="text-xs text-slate-400 truncate">📍 {c.homeAddress}</span>}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {/* Selected case info */}
                {selectedCase && (
                  <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-900 space-y-2">
                    <div className="space-y-1.5">
                      <label className="text-[10px] font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1">
                        <User className="w-3.5 h-3.5" /> Person Being Served
                      </label>
                      <Select
                        value={selectedRecipientId || "default_pbs"}
                        onValueChange={(val) => {
                          if (val === "__add_new__") {
                            setIsAddingRecipient(true);
                            return;
                          }
                          setSelectedRecipientId(val === "default_pbs" ? "" : val);
                          setIsAddingRecipient(false);
                        }}
                      >
                        <SelectTrigger className="h-11 bg-white dark:bg-slate-900 text-sm font-semibold">
                          <SelectValue placeholder="Select who you are serving" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default_pbs">
                            {(selectedCase.defendantRespondent || selectedCase.caseName || "Defendant").trim()} (Defendant)
                          </SelectItem>
                          {recipients
                            .filter((r) => {
                              const def = (selectedCase.defendantRespondent || selectedCase.caseName || "").trim().toLowerCase();
                              return r.full_name.trim().toLowerCase() !== def;
                            })
                            .map((r) => (
                              <SelectItem key={r.id} value={r.id}>
                                {r.full_name}{r.role ? ` (${r.role})` : ""}
                              </SelectItem>
                            ))}
                          <SelectItem value="__add_new__">+ Add different person…</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {isAddingRecipient && (
                      <div className="flex gap-2">
                        <Input placeholder="Full Name" value={newRecipientName} onChange={(e) => setNewRecipientName(e.target.value)} className="h-10 text-sm" />
                        <Button type="button" size="sm" className="h-10 text-xs bg-blue-600 text-white" onClick={handleAddRecipient}>Save</Button>
                      </div>
                    )}

                    {/* Saved address buttons */}
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500">TAP TO USE SAVED ADDRESS:</label>
                      <div className="flex flex-col gap-1">
                        {selectedCase.homeAddress && (
                          <button
                            type="button"
                            onClick={() => form.setValue("serviceAddress", selectedCase.homeAddress!)}
                            className={`text-left text-xs p-2 rounded border transition ${
                              form.watch("serviceAddress") === selectedCase.homeAddress
                                ? "bg-blue-100 border-blue-400 text-blue-900 font-bold"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <Home className="w-3 h-3 inline mr-1.5 text-blue-600" />
                            Home: {selectedCase.homeAddress}
                          </button>
                        )}
                        {selectedCase.workAddress && (
                          <button
                            type="button"
                            onClick={() => form.setValue("serviceAddress", selectedCase.workAddress!)}
                            className={`text-left text-xs p-2 rounded border transition ${
                              form.watch("serviceAddress") === selectedCase.workAddress
                                ? "bg-purple-100 border-purple-400 text-purple-900 font-bold"
                                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <Briefcase className="w-3 h-3 inline mr-1.5 text-purple-600" />
                            Secondary: {selectedCase.workAddress}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </form>
            </Form>
          </CardContent>

          <CardFooter className="flex flex-col gap-2 pt-0">
            <Button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-12" disabled={!isCaseSelected} onClick={startFieldCapture}>
              <Camera className="w-4 h-4 mr-2" /> Field Capture (Live GPS + Photos)
            </Button>
            <Button variant="outline" className="w-full min-h-11 h-11 text-sm" disabled={!isCaseSelected} onClick={startManualLog}>
              <Calendar className="w-4 h-4 mr-2 text-purple-600" /> Manual Log / Backfill
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === "confirm" && (
        <Card className="border border-slate-200 dark:border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-bold space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span>Log Attempt</span>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500">Person Being Served</label>
                <Select
                  value={selectedRecipientId || "default_pbs"}
                  onValueChange={(val) => {
                    if (val === "__add_new__") {
                      setIsAddingRecipient(true);
                      return;
                    }
                    setSelectedRecipientId(val === "default_pbs" ? "" : val);
                    setIsAddingRecipient(false);
                  }}
                >
                  <SelectTrigger className="h-11 text-sm font-semibold">
                    <SelectValue placeholder="Who are you serving?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default_pbs">
                      {(selectedCase?.defendantRespondent || selectedCase?.caseName || "Defendant").trim()} (Defendant)
                    </SelectItem>
                    {recipients
                      .filter((r) => {
                        const def = (selectedCase?.defendantRespondent || selectedCase?.caseName || "").trim().toLowerCase();
                        return r.full_name.trim().toLowerCase() !== def;
                      })
                      .map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.full_name}</SelectItem>
                      ))}
                    <SelectItem value="__add_new__">+ Add different person…</SelectItem>
                  </SelectContent>
                </Select>
                {isAddingRecipient && (
                  <div className="flex gap-2 pt-1">
                    <Input placeholder="Full Name" value={newRecipientName} onChange={(e) => setNewRecipientName(e.target.value)} className="h-10 text-sm" />
                    <Button type="button" size="sm" className="h-10 text-xs bg-blue-600 text-white" onClick={handleAddRecipient}>Save</Button>
                  </div>
                )}
              </div>
            </CardTitle>
            <div className="flex items-center justify-between gap-2 pt-1">
              <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => { setStep("select"); setGpsStatus("idle"); }}>
                Back
              </Button>
              {!isManualLog && (
                <div className="flex-1 text-right">
                  {gpsStatus === "loading" && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-1 rounded-full">
                      <Loader2 className="w-3 h-3 animate-spin" /> Locking GPS…
                    </span>
                  )}
                  {gpsStatus === "ready" && location && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
                      <MapPin className="w-3 h-3" /> GPS Ready · {formatCoordinates(location.latitude, location.longitude)}
                      {Number.isFinite(location.accuracy) ? ` · ±${Math.round(location.accuracy)}m` : ""}
                    </span>
                  )}
                  {gpsStatus === "error" && (
                    <button type="button" onClick={() => void lockGpsNow()} className="text-[11px] font-semibold text-red-700 bg-red-50 px-2 py-1 rounded-full">
                      GPS failed — tap to retry
                    </button>
                  )}
                </div>
              )}
              {isManualLog && (
                <span className="text-[11px] font-semibold text-purple-700 bg-purple-50 px-2 py-1 rounded-full">
                  Manual log · GPS not required
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-bold block mb-1">Type</label>
                    <Select value={attemptType} onValueChange={(v: any) => setAttemptType(v)}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="physical">Physical</SelectItem>
                        <SelectItem value="phone">Phone Call</SelectItem>
                        <SelectItem value="neighbor">Neighbor</SelectItem>
                        <SelectItem value="management">Management</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs font-bold block mb-1">Result</label>
                    <FormField control={form.control} name="status" render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="completed">✓ Served</SelectItem>
                          <SelectItem value="failed">✗ Unsuccessful</SelectItem>
                        </SelectContent>
                      </Select>
                    )} />
                  </div>
                </div>

                {/* Method of Service — REQUIRED when Result = Served. Affidavit wording depends on it. */}
                {form.watch("status") === "completed" && (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-3">
                    <div>
                      <label className="text-xs font-bold block mb-1.5">
                        How were they served? <span className="text-red-500">*</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setServiceMethod("personal")}
                          className={`min-h-[56px] rounded-lg text-sm font-bold transition border ${
                            serviceMethod === "personal"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          Personal Service
                        </button>
                        <button
                          type="button"
                          onClick={() => setServiceMethod("substituted-residence")}
                          className={`min-h-[56px] rounded-lg text-sm font-bold transition border ${
                            serviceMethod === "substituted-residence"
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:bg-slate-50"
                          }`}
                        >
                          Substitute Service
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => setMoreMethodsOpen(!moreMethodsOpen)}
                        className="mt-2 text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1"
                      >
                        {moreMethodsOpen ? "▾ Hide" : "+ More methods"}
                      </button>
                      {moreMethodsOpen && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          {([
                            ["substituted-business", "Substitute (Business)"],
                            ["corporate", "Corporate / Registered Agent"],
                            ["posting", "Posting"],
                            ["non-service", "Non-Service"],
                          ] as const).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setServiceMethod(value)}
                              className={`min-h-11 rounded-lg text-xs font-semibold transition border ${
                                serviceMethod === value
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 hover:bg-slate-50"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {["substituted-residence", "substituted-business", "corporate"].includes(serviceMethod) && (
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs font-bold block mb-1">
                            Name of person who received papers <span className="text-red-500">*</span>
                          </label>
                          <Input
                            className="h-10 text-sm"
                            placeholder="e.g. Michael Davis (co-resident) / Agent name"
                            value={acceptedBy}
                            onChange={(e) => setAcceptedBy(e.target.value)}
                            disabled={refusedToIdentify}
                          />
                          {serviceMethod === "substituted-residence" && (
                            <p className="text-[11px] text-slate-500 mt-1">Co-resident must be 15+ — OK 12 O.S. § 2004(C)(1)(c)(1)</p>
                          )}
                          {serviceMethod === "corporate" && (
                            <p className="text-[11px] text-slate-500 mt-1">Service during regular office hours on the registered agent</p>
                          )}
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                          <input
                            type="checkbox"
                            checked={refusedToIdentify}
                            onChange={(e) => {
                              setRefusedToIdentify(e.target.checked);
                              if (e.target.checked) setAcceptedBy("");
                            }}
                            className="h-4 w-4"
                          />
                          Won't identify / refused
                        </label>
                      </div>
                    )}

                    {serviceMethod === "posting" && (
                      <div>
                        <label className="text-xs font-bold block mb-1">
                          Posting location <span className="text-red-500">*</span>
                        </label>
                        <Select value={postingLocation} onValueChange={setPostingLocation}>
                          <SelectTrigger className="h-10"><SelectValue placeholder="Select posting location" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="front_door">Front door</SelectItem>
                            <SelectItem value="conspicuous_place">Conspicuous place</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {serviceMethod === "corporate" && (
                      <div>
                        <label className="text-xs font-bold block mb-1">
                          Registered Agent / Company Name <span className="text-red-500">*</span>
                        </label>
                        <Input
                          className="h-10 text-sm"
                          placeholder="e.g. Crowe & Dunlevy"
                          value={corporateAgent}
                          onChange={(e) => setCorporateAgent(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}

                {isManualLog && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-bold block mb-1">Date & Time</label>
                      <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="text-xs h-10" />
                    </div>
                    <div>
                      <label className="text-xs font-bold block mb-1">Spoke With</label>
                      <Input placeholder="Neighbor / Manager" value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} className="text-xs h-10" />
                    </div>
                  </div>
                )}

                {/* Address — shows saved addresses as tappable buttons */}
                <FormField control={form.control} name="serviceAddress" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-bold">Service Address</FormLabel>
                    {selectedCase?.homeAddress && field.value !== selectedCase.homeAddress && (
                      <button type="button" onClick={() => field.onChange(selectedCase.homeAddress)} className="block text-[11px] text-blue-600 font-semibold mb-1">
                        <Home className="w-3 h-3 inline mr-1" />Use: {selectedCase.homeAddress}
                      </button>
                    )}
                    {selectedCase?.workAddress && field.value !== selectedCase.workAddress && (
                      <button type="button" onClick={() => field.onChange(selectedCase.workAddress)} className="block text-[11px] text-purple-600 font-semibold mb-1">
                        <Briefcase className="w-3 h-3 inline mr-1" />Use: {selectedCase.workAddress}
                      </button>
                    )}
                    <FormControl><Input placeholder="Type or tap above" {...field} className="h-10" /></FormControl>
                  </FormItem>
                )} />

                <PhotoUploader photos={photos} onChange={setPhotos} maxPhotos={5} />

                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-bold">Notes</FormLabel>
                    <FormControl><Textarea placeholder="No answer, dog barking, AC running..." className="min-h-[80px]" {...field} /></FormControl>
                  </FormItem>
                )} />

                <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold h-12" disabled={isSending}>
                  {isSending ? "Saving..." : "Save Attempt"}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ServeAttempt;
