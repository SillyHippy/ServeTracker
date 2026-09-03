import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { FileText, Printer, PenLine, Loader2 } from 'lucide-react';
import {
  generateAffidavitHtml,
  generateBatchAffidavitsHtml,
  inferAffidavitKind,
  latestSuccessfulServe,
  serviceMethodLabel,
  type AffidavitKind,
} from '@/utils/affidavitEngine';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ServeAttemptData } from '@/types/ServeAttemptData';
import { ClientData } from '@/components/ClientForm';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import AffidavitSignatureDialog from '@/components/AffidavitSignatureDialog';
import AffidavitExecutionAudit from '@/components/AffidavitExecutionAudit';
import { detectNotaryVenue } from '@/utils/oklahomaVenue';

function coordsFromAttempts(attempts: ServeAttemptData[]): Array<{ latitude: number; longitude: number }> {
  const out: Array<{ latitude: number; longitude: number }> = [];
  for (const a of [...attempts].reverse()) {
    const c = a.coordinates as unknown;
    if (c && typeof c === 'object' && Number.isFinite((c as { latitude?: number }).latitude) && Number.isFinite((c as { longitude?: number }).longitude)) {
      out.push({ latitude: Number((c as { latitude: number }).latitude), longitude: Number((c as { longitude: number }).longitude) });
      continue;
    }
    if (typeof c === 'string' && c.includes(',')) {
      const [lat, lon] = c.split(',').map((v) => Number(v.trim()));
      if (Number.isFinite(lat) && Number.isFinite(lon)) out.push({ latitude: lat, longitude: lon });
    }
  }
  return out;
}

function printHtmlWithImages(html: string): boolean {
  const printWin = window.open('', '_blank');
  if (!printWin) return false;
  printWin.document.write(html);
  printWin.document.close();
  printWin.focus();

  const triggerPrint = () => {
    try {
      printWin.focus();
      printWin.print();
    } catch {
      // ignore
    }
  };

  const imgs = Array.from(printWin.document.images);
  if (imgs.length === 0) {
    setTimeout(triggerPrint, 300);
  } else {
    let remaining = imgs.length;
    const done = () => {
      remaining--;
      if (remaining <= 0) setTimeout(triggerPrint, 200);
    };
    imgs.forEach((img) => {
      if (img.complete) {
        done();
      } else {
        img.addEventListener('load', done);
        img.addEventListener('error', done);
      }
    });
    // Fallback safety timeout so print triggers even on slow connections
    setTimeout(triggerPrint, 3000);
  }
  return true;
}

interface AffidavitGeneratorProps {
  client: ClientData;
  serves: ServeAttemptData[];
  /** Case UUID — preferred lookup so duplicate case numbers (PG-26-22) don't mix jobs */
  caseRecordId?: string;
  caseNumber?: string;
  caseName?: string;
  courtName?: string;
  plaintiffPetitioner?: string;
  defendantRespondent?: string;
  homeAddress?: string;
  workAddress?: string;
  personBeingServed?: string;
  /** Exact document titles for the affidavit Documents line */
  documentsToServe?: string;
  className?: string;
  buttonClassName?: string;
}

interface AssignedServerInfo {
  id: string;
  legalName: string;
  displayName: string;
  licenseNumber: string;
  licenseJurisdiction: string;
}

export const AffidavitGenerator: React.FC<AffidavitGeneratorProps> = ({
  client,
  serves,
  caseRecordId,
  caseNumber,
  caseName,
  courtName,
  plaintiffPetitioner,
  defendantRespondent,
  homeAddress,
  workAddress,
  personBeingServed,
  documentsToServe,
  className,
  buttonClassName,
}) => {
  const { isAdmin } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [resolvedDocs, setResolvedDocs] = useState<string>((documentsToServe || '').trim());
  const [resolvedCourt, setResolvedCourt] = useState(courtName || '');
  const [resolvedPlaintiff, setResolvedPlaintiff] = useState(plaintiffPetitioner || '');
  const [resolvedDefendant, setResolvedDefendant] = useState(defendantRespondent || '');
  const [resolvedHome, setResolvedHome] = useState(homeAddress || '');
  const [resolvedWork, setResolvedWork] = useState(workAddress || '');
  const [isLoadingCase, setIsLoadingCase] = useState(false);
  const [caseId, setCaseId] = useState(caseRecordId || '');
  const [resolvedAttempts, setResolvedAttempts] = useState<ServeAttemptData[]>(serves);
  const [recipientsList, setRecipientsList] = useState<Array<{ id: string; full_name: string; role?: string }>>([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string>('');
  const [assignedServer, setAssignedServer] = useState<AssignedServerInfo | null>(null);
  const [notaryInfo, setNotaryInfo] = useState<{ notaryName?: string; commissionExpiration?: string } | null>(null);
  const [hasActiveSigned, setHasActiveSigned] = useState(false);
  const [checkingSigned, setCheckingSigned] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [isRenderingSigned, setIsRenderingSigned] = useState(false);
  const [affidavitKind, setAffidavitKind] = useState<AffidavitKind>(() => inferAffidavitKind(serves));
  const { toast } = useToast();

  const lookupKey = caseRecordId || caseId || caseNumber || '';

  // Always pull Documents to Serve, caption fields, and THIS case's attempts from the live record.
  // History cards can mix duplicate case numbers (PG-26-22) — UUID lookup is authoritative.
  useEffect(() => {
    if (!isOpen || !lookupKey) {
      setResolvedDocs((documentsToServe || '').trim());
      setResolvedAttempts(serves);
      return;
    }

    let cancelled = false;
    setIsLoadingCase(true);

    (async () => {
      try {
        const clientId = String(client.id || (client as any).$id || '').trim();
        const data = await api.getAffidavitData(lookupKey, clientId || undefined);
        if (cancelled || !data?.case) return;
        const c = data.case;
        if (c.id) setCaseId(String(c.id));
        const fromCase = String(c.documents_to_serve || c.documentsToServe || '').trim();
        const fromProp = (documentsToServe || '').trim();
        setResolvedDocs(fromCase || fromProp);
        if (c.court_name) setResolvedCourt(String(c.court_name));
        if (c.plaintiff_petitioner) setResolvedPlaintiff(String(c.plaintiff_petitioner));
        if (c.defendant_respondent) setResolvedDefendant(String(c.defendant_respondent));
        if (c.home_address) setResolvedHome(String(c.home_address));
        if (c.work_address) setResolvedWork(String(c.work_address));
        if (Array.isArray(data.recipients) && data.recipients.length > 0) {
          const mapped = data.recipients.map((r: any) => ({
            id: String(r.id || r.$id || ''),
            full_name: String(r.full_name || r.fullName || ''),
            role: String(r.role || ''),
          })).filter((r: any) => Boolean(r.full_name));
          setRecipientsList(mapped);
          if (mapped.length > 0) {
            setSelectedRecipientId((prev) => (mapped.some((m: any) => m.id === prev) ? prev : mapped[0].id));
          }
        }
        if (Array.isArray(data.attempts) && data.attempts.length > 0) {
          setResolvedAttempts(data.attempts as ServeAttemptData[]);
        } else {
          setResolvedAttempts(serves);
        }
        if (data.assignedServer) setAssignedServer(data.assignedServer);
        if (data.notaryBlock) setNotaryInfo(data.notaryBlock);
        setCheckingSigned(true);
        try {
          const audit = await api.auditAffidavit(String(c.id || ''));
          setHasActiveSigned((audit.executions || []).some((e) => e.status === 'signed_not_notarized'));
        } catch {
          setHasActiveSigned(false);
        } finally {
          setCheckingSigned(false);
        }
      } catch (err) {
        console.warn('Affidavit: could not load case documents, using prop fallback', err);
        if (!cancelled) {
          setResolvedDocs((documentsToServe || '').trim());
          setResolvedAttempts(serves);
        }
      } finally {
        if (!cancelled) setIsLoadingCase(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, lookupKey, documentsToServe, client, serves, caseRecordId]);

  useEffect(() => {
    setAffidavitKind(inferAffidavitKind(resolvedAttempts));
  }, [resolvedAttempts, isOpen]);

  const handlePrintOrSave = async () => {
    // Re-fetch once more right before print so Edit Case saves are never stale
    let docs = resolvedDocs;
    let court = resolvedCourt;
    let plaintiff = resolvedPlaintiff;
    let defendant = resolvedDefendant;
    let home = resolvedHome;
    let work = resolvedWork;

    let attemptsForPrint = resolvedAttempts;
    if (lookupKey) {
      try {
        const clientId = String(client.id || (client as any).$id || '').trim();
        const data = await api.getAffidavitData(lookupKey, clientId || undefined);
        if (data?.case) {
          const c = data.case;
          docs = String(c.documents_to_serve || c.documentsToServe || docs || '').trim();
          if (c.court_name) court = String(c.court_name);
          if (c.plaintiff_petitioner) plaintiff = String(c.plaintiff_petitioner);
          if (c.defendant_respondent) defendant = String(c.defendant_respondent);
          if (c.home_address) home = String(c.home_address);
          if (c.work_address) work = String(c.work_address);
          if (c.id) setCaseId(String(c.id));
          if (data.assignedServer) setAssignedServer(data.assignedServer);
          if (data.notaryBlock) setNotaryInfo(data.notaryBlock);
          setResolvedDocs(docs);
          if (Array.isArray(data.attempts) && data.attempts.length > 0) {
            attemptsForPrint = data.attempts as ServeAttemptData[];
            setResolvedAttempts(attemptsForPrint);
          }
        }
      } catch {
        // keep already-resolved values
      }
    }

    // Assigned server profile is authoritative when available.
    const serverName = assignedServer?.legalName || 'Joseph Iannazzi';
    const licenseNumber = assignedServer?.licenseNumber || 'PSL-2026-2';

    const venue = await detectNotaryVenue({
      fallbackTexts: [court, caseName, home, work],
      fallbackCoords: coordsFromAttempts(attemptsForPrint),
    });

    const html = generateAffidavitHtml({
      case: {
        case_number: caseNumber || '',
        case_name: caseName || '',
        court_name: court || '',
        plaintiff_petitioner: plaintiff || '',
        defendant_respondent: defendant || personBeingServed || '',
        documents_to_serve: docs || '',
      },
      client: {
        name: client.name,
        email: client.email,
      },
      recipient: {
        id: selectedRecipientId || undefined,
        full_name: activeRecipientName || 'TARGET RECIPIENT',
        home_address: home,
        work_address: work,
      },
      attempts: attemptsForPrint,
      swornDate: new Date(),
      affidavitKind,
      notaryBlock: {
        serverName,
        licenseNumber,
        state: venue.state,
        county: venue.county,
      },
    });

    const printSuccess = printHtmlWithImages(html);
    if (printSuccess) {
      toast({
        title: 'Affidavit Document Ready',
        description: docs
          ? 'Print window opened — all exhibit photos loaded. Wet-ink: server (left), notary (right).'
          : 'Print opened — no Documents to Serve on this case yet (Edit Case to add them).',
      });
      setIsOpen(false);
    } else {
      toast({
        title: 'Pop-up Blocked',
        description: 'Please allow pop-ups to open and save the affidavit document.',
        variant: 'destructive',
      });
    }
  };

  // Print all recipient affidavits in a single continuous stream with exhibits once at the end
  const handlePrintAll = async () => {
    let docs = resolvedDocs;
    let court = resolvedCourt;
    let plaintiff = resolvedPlaintiff;
    let defendant = resolvedDefendant;
    let home = resolvedHome;
    let work = resolvedWork;
    let attemptsForPrint = resolvedAttempts;

    if (lookupKey) {
      try {
        const clientId = String(client.id || (client as any).$id || '').trim();
        const data = await api.getAffidavitData(lookupKey, clientId || undefined);
        if (data?.case) {
          const c = data.case;
          docs = String(c.documents_to_serve || c.documentsToServe || docs || '').trim();
          if (c.court_name) court = String(c.court_name);
          if (c.plaintiff_petitioner) plaintiff = String(c.plaintiff_petitioner);
          if (c.defendant_respondent) defendant = String(c.defendant_respondent);
          if (c.home_address) home = String(c.home_address);
          if (c.work_address) work = String(c.work_address);
          if (c.id) setCaseId(String(c.id));
          if (data.assignedServer) setAssignedServer(data.assignedServer);
          if (data.notaryBlock) setNotaryInfo(data.notaryBlock);
          setResolvedDocs(docs);
          if (Array.isArray(data.attempts) && data.attempts.length > 0) {
            attemptsForPrint = data.attempts as ServeAttemptData[];
            setResolvedAttempts(attemptsForPrint);
          }
        }
      } catch {
        // keep already-resolved values
      }
    }

    const serverName = assignedServer?.legalName || 'Joseph Iannazzi';
    const licenseNumber = assignedServer?.licenseNumber || 'PSL-2026-2';

    const venue = await detectNotaryVenue({
      fallbackTexts: [court, caseName, home, work],
      fallbackCoords: coordsFromAttempts(attemptsForPrint),
    });

    // Check if signed versions exist for any recipients to embed signatures
    const payloads = await Promise.all(
      recipientsList.map(async (rec) => {
        let sig: { dataUrl: string; mimeType: string } | undefined;
        if (caseId) {
          try {
            const rend = await api.renderAffidavit(caseId, rec.id);
            if (rend?.html) {
              const sigMatch = rend.html.match(/src="(data:image\/[^;]+;base64,[^"]+)"/);
              if (sigMatch) {
                sig = { dataUrl: sigMatch[1], mimeType: "image/png" };
              }
            }
          } catch {}
        }

        return {
          case: {
            case_number: caseNumber || '',
            case_name: caseName || '',
            court_name: court || '',
            plaintiff_petitioner: plaintiff || '',
            defendant_respondent: defendant || personBeingServed || '',
            documents_to_serve: docs || '',
          },
          client: {
            name: client.name,
            email: client.email,
          },
          recipient: {
            id: rec.id,
            full_name: rec.full_name,
            role: rec.role,
            home_address: home,
            work_address: work,
          },
          attempts: attemptsForPrint,
          swornDate: new Date(),
          signature: sig,
          affidavitKind,
          notaryBlock: {
            serverName,
            licenseNumber,
            state: venue.state,
            county: venue.county,
          },
        };
      })
    );

    const html = generateBatchAffidavitsHtml(payloads, true);
    const printSuccess = printHtmlWithImages(html);
    if (printSuccess) {
      toast({
        title: 'Batch Affidavits Ready',
        description: `Print window opened with ${recipientsList.length} individual affidavits (exhibits once at end).`,
      });
      setIsOpen(false);
    } else {
      toast({
        title: 'Pop-up Blocked',
        description: 'Please allow pop-ups to open and save the batch affidavits.',
        variant: 'destructive',
      });
    }
  };

  // Print the server-rendered SIGNED version (render endpoint embeds signature).
  const handlePrintSigned = async () => {
    if (!caseId) return;
    setIsRenderingSigned(true);
    try {
      const res = await api.renderAffidavit(caseId, selectedRecipientId || undefined);
      const printSuccess = printHtmlWithImages(res.html);
      if (printSuccess) {
        toast({
          title: 'Signed Affidavit Ready',
          description: 'Signed version printed — electronic signature applied (left). Notarization pending: notary wet-ink/stamp (right).',
        });
        setIsOpen(false);
      } else {
        toast({ title: 'Pop-up Blocked', description: 'Please allow pop-ups to print the signed affidavit.', variant: 'destructive' });
      }
    } catch (err) {
      toast({
        title: 'Render failed',
        description: err instanceof Error ? err.message : 'No active signed version — sign the affidavit first.',
        variant: 'destructive',
      });
    } finally {
      setIsRenderingSigned(false);
    }
  };

  const handleSigned = (renderedHtml: string) => {
    setHasActiveSigned(true);
    printHtmlWithImages(renderedHtml);
  };

  const pbsName = personBeingServed || resolvedDefendant || defendantRespondent || caseName || 'Target Recipient';
  const activeRecipientObj = recipientsList.find((r) => String(r.id) === selectedRecipientId);
  const activeRecipientName = activeRecipientObj?.full_name || pbsName;
  const inferredKind = inferAffidavitKind(resolvedAttempts, undefined, activeRecipientObj?.id, activeRecipientName);
  const servedAttempt = latestSuccessfulServe(resolvedAttempts, activeRecipientObj?.id, activeRecipientName);
  const methodRaw = String((servedAttempt as any)?.service_method || (servedAttempt as any)?.serviceMethod || '').toLowerCase();
  const acceptedRaw = String((servedAttempt as any)?.accepted_by || (servedAttempt as any)?.acceptedBy || '').trim();
  const methodLabelText = serviceMethodLabel(methodRaw);
  const docsPreview = resolvedDocs;
  const serverLabel = assignedServer?.displayName || 'the assigned server';
  const isService = affidavitKind === 'service';

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={
            buttonClassName ||
            className ||
            "h-10 px-3 w-full sm:w-auto justify-center flex items-center gap-1.5 text-xs font-semibold"
          }
        >
          <FileText className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="truncate">Affidavit</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="w-5 h-5 text-blue-600" />
            <span>Generate Court Affidavit</span>
          </DialogTitle>
          <DialogDescription>
            {assignedServer
              ? `${assignedServer.legalName} (${assignedServer.licenseNumber}) signs left; notary wet-ink/stamp right. Swear date = print day.`
              : 'Physical attempts as date/time bars; phone notes in Comments. Signature left; notary right. Swear date = print day.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-1.5">
            <div className="space-y-1.5">
              <span className="text-slate-500 font-medium">Type:</span>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={isService ? "default" : "outline"}
                  className="h-7 text-xs flex-1"
                  onClick={() => setAffidavitKind("service")}
                >
                  Affidavit of Service
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={!isService ? "default" : "outline"}
                  className="h-7 text-xs flex-1"
                  onClick={() => setAffidavitKind("non-service")}
                >
                  Non-Service
                </Button>
              </div>
              {inferredKind === "non-service" && isService && (
                <p className="text-[11px] text-amber-700">No successful serve with a recorded method — verify before printing a Service affidavit.</p>
              )}
              {inferredKind === "service" && !isService && (
                <p className="text-[11px] text-slate-500">A completed serve exists; this will print as Affidavit of Non-Service.</p>
              )}
            </div>
            {recipientsList.length > 1 ? (
              <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Affidavit For:</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {activeRecipientObj?.full_name || pbsName}
                  </span>
                </div>
                {recipientsList.length <= 2 ? (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {recipientsList.map((rec) => (
                      <Button
                        key={rec.id}
                        type="button"
                        size="sm"
                        variant={selectedRecipientId === rec.id ? "default" : "outline"}
                        className="h-7 text-xs flex-1 min-w-[120px]"
                        onClick={() => setSelectedRecipientId(rec.id)}
                      >
                        {rec.full_name}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Select value={selectedRecipientId} onValueChange={setSelectedRecipientId}>
                    <SelectTrigger className="h-8 text-xs w-full mt-1">
                      <SelectValue placeholder="Select Recipient" />
                    </SelectTrigger>
                    <SelectContent>
                      {recipientsList.map((rec, idx) => (
                        <SelectItem key={rec.id} value={rec.id}>
                          {rec.full_name} {idx === 0 ? "(Primary)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            ) : (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500 font-medium">Serving:</span>
                <span className="font-semibold text-right">{pbsName}</span>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 font-medium">Case No:</span>
              <span className="font-semibold">{caseNumber || 'N/A'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 font-medium">Attempts:</span>
              <span className="font-semibold">{serves.length}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 font-medium">Method:</span>
              <span className="font-semibold text-right">
                {!isService ? 'N/A (Non-Service)' : methodLabelText
                  ? <>{methodLabelText}{acceptedRaw ? ` — accepted by ${acceptedRaw}` : ''}</>
                  : <span className="font-bold text-amber-600">⚠ NOT RECORDED — verify before printing</span>}
              </span>
            </div>
            <div className="pt-1 border-t border-slate-200 dark:border-slate-700">
              <span className="text-slate-500 font-medium block mb-0.5">Documents:</span>
              <span className="text-xs text-slate-800 dark:text-slate-200">
                {isLoadingCase
                  ? 'Loading from case…'
                  : docsPreview || '— Add under Edit Case → Documents to Serve'}
              </span>
            </div>
            {assignedServer && (
              <div className="pt-1 border-t border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 font-medium block mb-0.5">Assigned server:</span>
                <span className="text-xs text-slate-800 dark:text-slate-200">
                  {assignedServer.legalName} · {assignedServer.licenseNumber} ({assignedServer.licenseJurisdiction || 'OK'})
                </span>
              </div>
            )}
          </div>

          {checkingSigned ? (
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking signed versions…
            </div>
          ) : hasActiveSigned ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-2.5 text-xs text-green-800">
              A signed version exists (notarization pending). Print it to apply the electronic signature.
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 pt-2 flex-wrap">
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          {recipientsList.length > 1 && (
            <Button
              onClick={handlePrintAll}
              variant="outline"
              className="border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 flex items-center gap-1.5"
              disabled={isLoadingCase}
              title="Prints all recipient affidavits in one continuous job, with exhibits once at the end"
            >
              <Printer className="w-4 h-4 text-blue-600" />
              <span>Print All ({recipientsList.length} Packets)</span>
            </Button>
          )}
          {hasActiveSigned && caseId ? (
            <Button
              onClick={handlePrintSigned}
              disabled={isRenderingSigned}
              className="bg-green-600 hover:bg-green-700 text-white flex items-center gap-2"
            >
              {isRenderingSigned ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              <span>Print Signed Version</span>
            </Button>
          ) : (
            <Button
              onClick={handlePrintOrSave}
              className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
              disabled={isLoadingCase}
            >
              <Printer className="w-4 h-4" />
              <span>{recipientsList.length > 1 ? `Print ${activeRecipientName.split(' ')[0]}` : "Print / Save PDF"}</span>
            </Button>
          )}
          {caseId && (isAdmin || assignedServer) && (
            <Button
              onClick={() => setSignOpen(true)}
              variant={hasActiveSigned ? "outline" : "secondary"}
              className="flex items-center gap-2"
              title="Applies the assigned server's electronic signature only — does not notarize"
            >
              <PenLine className="w-4 h-4" />
              <span>{hasActiveSigned ? "Re-sign (new version)" : `Sign Affidavit as ${serverLabel}`}</span>
            </Button>
          )}
        </div>

        {caseId && (
          <div className="pt-2">
            <AffidavitExecutionAudit caseId={caseId} />
          </div>
        )}
      </DialogContent>

      {caseId && (
        <AffidavitSignatureDialog
          caseId={caseId}
          caseNumber={caseNumber || ''}
          personBeingServed={activeRecipientName}
          open={signOpen}
          onOpenChange={setSignOpen}
          onSigned={handleSigned}
          affidavitKind={affidavitKind}
          recipientId={selectedRecipientId}
          allRecipients={recipientsList}
        />
      )}
    </Dialog>
  );
};

export default AffidavitGenerator;
