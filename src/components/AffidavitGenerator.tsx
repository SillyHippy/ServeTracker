import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { FileText, Printer, PenLine, Loader2, AlertTriangle, X } from 'lucide-react';
import {
  generateAffidavitHtml,
  generateBatchAffidavitsHtml,
  inferAffidavitKind,
  latestSuccessfulServe,
  physicalAttemptsForAffidavit,
  distinctPeopleCount,
  serviceMethodLabel,
  type AffidavitKind,
  type LegalDocumentType,
} from '@/utils/affidavitEngine';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ServeAttemptData } from '@/types/ServeAttemptData';
import { ClientData } from '@/components/ClientForm';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';
import { getPendingForCase, subscribePending } from '@/lib/offlineQueue';
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
  const [signedExecutions, setSignedExecutions] = useState<Array<{ status?: string; recipientId?: string; recipient_id?: string }>>([]);
  const [checkingSigned, setCheckingSigned] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [isRenderingSigned, setIsRenderingSigned] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [hasPendingOutbox, setHasPendingOutbox] = useState(false);
  const [pendingOutboxCount, setPendingOutboxCount] = useState(0);
  const [documentType, setDocumentType] = useState<LegalDocumentType>('affidavit');
  const [allowDeclarations, setAllowDeclarations] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('servetracker_allow_declarations');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });
  const { toast } = useToast();

  useEffect(() => {
    if (isOpen) {
      api.getSettings().then((s) => {
        if (typeof s.allow_declarations === 'boolean') {
          setAllowDeclarations(s.allow_declarations);
          if (!s.allow_declarations && documentType === 'declaration') {
            setDocumentType('affidavit');
          }
        }
      }).catch(() => {});
    }
  }, [isOpen]);

  const courtNumber = String(caseNumber || '').trim();
  const fakeCourt = !courtNumber || courtNumber.toLowerCase() === 'unknown';
  const lookupKey = String(caseRecordId || caseId || '').trim() || (fakeCourt ? '' : courtNumber);
  // Block printing and signing if there are unverified outbox attempts for this case
  useEffect(() => {
    const checkOutbox = async () => {
      const key = String(caseRecordId || caseId || courtNumber || '').trim();
      if (!key) {
        setHasPendingOutbox(false);
        setPendingOutboxCount(0);
        return;
      }
      const items = await getPendingForCase(key);
      const unverified = items.filter(
        (item) => !['verified', 'skipped'].includes(item.state)
      );
      setHasPendingOutbox(unverified.length > 0);
      setPendingOutboxCount(unverified.length);
    };
    void checkOutbox();
    return subscribePending(() => {
      void checkOutbox();
    });
  }, [caseRecordId, caseId, courtNumber, isOpen]);


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
            const wanted = String(personBeingServed || '').trim().toLowerCase();
            setSelectedRecipientId((prev) => {
              if (mapped.some((m: any) => m.id === prev)) return prev;
              const named = wanted ? mapped.find((m: any) => m.full_name.toLowerCase() === wanted) : undefined;
              return named?.id || mapped[0].id;
            });
          }
        }
        setFetchFailed(false);
        if (Array.isArray(data.attempts)) {
          // CRITICAL: When server fetch succeeds, use its attempts EVEN IF EMPTY!
          setResolvedAttempts(data.attempts as ServeAttemptData[]);
        }
        if (data.assignedServer) setAssignedServer(data.assignedServer);
        if (data.notaryBlock) setNotaryInfo(data.notaryBlock);
        setCheckingSigned(true);
        try {
          const audit = await api.auditAffidavit(String(c.id || ''));
          setSignedExecutions(audit.executions || []);
        } catch {
          setSignedExecutions([]);
        } finally {
          setCheckingSigned(false);
        }
      } catch (err) {
        console.error('Affidavit: could not load case documents from server', err);
        if (!cancelled) {
          setFetchFailed(true);
          // On fetch failure do not silently print stale client-prop rows!
          setResolvedAttempts([]);
        }
      } finally {
        if (!cancelled) setIsLoadingCase(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, lookupKey, documentsToServe, client, serves, caseRecordId]);

  const effectiveKind: AffidavitKind = useMemo(() => {
    const rec = recipientsList.find((r) => String(r.id) === selectedRecipientId);
    const nm = (
      rec?.full_name ||
      personBeingServed ||
      resolvedDefendant ||
      defendantRespondent ||
      caseName ||
      ""
    ).trim();
    return inferAffidavitKind(resolvedAttempts, undefined, rec?.id, nm);
  }, [
    resolvedAttempts,
    selectedRecipientId,
    recipientsList,
    personBeingServed,
    resolvedDefendant,
    defendantRespondent,
    caseName,
  ]);

  const handlePrintOrSave = async () => {
    if (hasPendingOutbox) {
      toast({
        title: "Sync Pending — Print Blocked",
        description: `This case has ${pendingOutboxCount} offline attempt(s) waiting in your outbox. Upload and verify them before printing the affidavit.`,
        variant: "destructive",
      });
      return;
    }
    if (fetchFailed) {
      toast({
        title: "Server Records Required",
        description: "Could not load verified attempts from server. Printing blocked to prevent false affidavit.",
        variant: "destructive",
      });
      return;
    }
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
          if (Array.isArray(data.attempts)) {
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

    let sig: { dataUrl: string; mimeType: string } | undefined;
    if (caseId && documentType === 'declaration') {
      try {
        const rend = await api.renderAffidavit(caseId, selectedRecipientId || undefined);
        if (rend?.html) {
          const sigMatch = rend.html.match(/src="(data:image\/[^;]+;base64,[^"]+)"/);
          if (sigMatch) {
            sig = { dataUrl: sigMatch[1], mimeType: "image/png" };
          }
        }
      } catch {}
    }

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
      signature: sig,
      effectiveKind,
      documentType,
      statutoryAuthority: documentType === 'declaration' ? '12 O.S. § 426' : undefined,
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
        title: documentType === 'declaration' ? 'Declaration Document Ready' : 'Affidavit Document Ready',
        description: docs
          ? (documentType === 'declaration'
              ? 'Print window opened — all exhibit photos loaded. Executed under penalty of perjury (12 O.S. § 426).'
              : 'Print window opened — all exhibit photos loaded. Wet-ink: server (left), notary (right).')
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
    if (hasPendingOutbox) {
      toast({
        title: "Sync Pending — Print Blocked",
        description: `This case has ${pendingOutboxCount} offline attempt(s) waiting in your outbox. Upload and verify them before printing the affidavit.`,
        variant: "destructive",
      });
      return;
    }
    if (fetchFailed) {
      toast({
        title: "Server Records Required",
        description: "Could not load verified attempts from server. Printing blocked to prevent false affidavit.",
        variant: "destructive",
      });
      return;
    }
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
          if (Array.isArray(data.attempts)) {
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
          effectiveKind,
          documentType,
          statutoryAuthority: documentType === 'declaration' ? '12 O.S. § 426' : undefined,
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
  const handlePrintSigned = async (signedDocType: LegalDocumentType = documentType) => {
    if (hasPendingOutbox) {
      toast({
        title: "Sync Pending — Print Blocked",
        description: `This case has ${pendingOutboxCount} offline attempt(s) waiting in your outbox. Upload and verify them before printing the affidavit.`,
        variant: "destructive",
      });
      return;
    }
    if (fetchFailed) {
      toast({
        title: "Server Records Required",
        description: "Could not load verified attempts from server. Printing blocked to prevent false affidavit.",
        variant: "destructive",
      });
      return;
    }
    if (!caseId) return;
    setIsRenderingSigned(true);
    try {
      const res = await api.renderAffidavit(caseId, selectedRecipientId || undefined, signedDocType);
      let htmlToPrint = res.html;
      if (signedDocType === 'declaration' && !htmlToPrint.includes('DECLARATION OF SERVICE')) {
        const sigMatch = htmlToPrint.match(/src="(data:image\/[^;]+;base64,[^"]+)"/);
        const sig = sigMatch ? { dataUrl: sigMatch[1], mimeType: "image/png" } : undefined;
        htmlToPrint = generateAffidavitHtml({
          case: {
            case_number: caseNumber || '',
            case_name: caseName || '',
            court_name: resolvedCourt || '',
            plaintiff_petitioner: resolvedPlaintiff || '',
            defendant_respondent: resolvedDefendant || personBeingServed || '',
            documents_to_serve: resolvedDocs || '',
          },
          client: {
            name: client.name,
            email: client.email,
          },
          recipient: {
            id: selectedRecipientId || undefined,
            full_name: activeRecipientName || 'TARGET RECIPIENT',
            home_address: resolvedHome,
            work_address: resolvedWork,
          },
          attempts: resolvedAttempts,
          swornDate: new Date(),
          signature: sig,
          effectiveKind,
          documentType: 'declaration',
          statutoryAuthority: '12 O.S. § 426',
          notaryBlock: {
            serverName: assignedServer?.legalName || 'Joseph Iannazzi',
            licenseNumber: assignedServer?.licenseNumber || 'PSL-2026-2',
            state: 'OKLAHOMA',
            county: 'TULSA',
          },
        });
      } else if (signedDocType === 'affidavit' && htmlToPrint.includes('DECLARATION OF SERVICE')) {
        const sigMatch = htmlToPrint.match(/src="(data:image\/[^;]+;base64,[^"]+)"/);
        const sig = sigMatch ? { dataUrl: sigMatch[1], mimeType: "image/png" } : undefined;
        htmlToPrint = generateAffidavitHtml({
          case: {
            case_number: caseNumber || '',
            case_name: caseName || '',
            court_name: resolvedCourt || '',
            plaintiff_petitioner: resolvedPlaintiff || '',
            defendant_respondent: resolvedDefendant || personBeingServed || '',
            documents_to_serve: resolvedDocs || '',
          },
          client: {
            name: client.name,
            email: client.email,
          },
          recipient: {
            id: selectedRecipientId || undefined,
            full_name: activeRecipientName || 'TARGET RECIPIENT',
            home_address: resolvedHome,
            work_address: resolvedWork,
          },
          attempts: resolvedAttempts,
          swornDate: new Date(),
          signature: sig,
          effectiveKind,
          documentType: 'affidavit',
          notaryBlock: {
            serverName: assignedServer?.legalName || 'Joseph Iannazzi',
            licenseNumber: assignedServer?.licenseNumber || 'PSL-2026-2',
            state: 'OKLAHOMA',
            county: 'TULSA',
          },
        });
      }
      const printSuccess = printHtmlWithImages(htmlToPrint);
      if (printSuccess) {
        toast({
          title: documentType === 'declaration' ? 'Signed Declaration Ready' : 'Signed Affidavit Ready',
          description: documentType === 'declaration'
            ? 'Signed declaration printed — electronic signature applied under penalty of perjury (12 O.S. § 426). No notary required.'
            : 'Signed version printed — electronic signature applied (left). Notarization pending: notary wet-ink/stamp (right).',
        });
        setIsOpen(false);
      } else {
        toast({ title: 'Pop-up Blocked', description: 'Please allow pop-ups to print the signed document.', variant: 'destructive' });
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
    let finalHtml = renderedHtml;
    if (documentType === 'declaration' && !renderedHtml.includes('DECLARATION OF SERVICE')) {
      const sigMatch = renderedHtml.match(/src="(data:image\/[^;]+;base64,[^"]+)"/);
      const sig = sigMatch ? { dataUrl: sigMatch[1], mimeType: "image/png" } : undefined;
      finalHtml = generateAffidavitHtml({
        case: {
          case_number: caseNumber || '',
          case_name: caseName || '',
          court_name: resolvedCourt || '',
          plaintiff_petitioner: resolvedPlaintiff || '',
          defendant_respondent: resolvedDefendant || personBeingServed || '',
          documents_to_serve: resolvedDocs || '',
        },
        client: {
          name: client.name,
          email: client.email,
        },
        recipient: {
          id: selectedRecipientId || undefined,
          full_name: activeRecipientName || 'TARGET RECIPIENT',
          home_address: resolvedHome,
          work_address: resolvedWork,
        },
        attempts: resolvedAttempts,
        swornDate: new Date(),
        signature: sig,
        effectiveKind,
        documentType: 'declaration',
        statutoryAuthority: '12 O.S. § 426',
        notaryBlock: {
          serverName: assignedServer?.legalName || 'Joseph Iannazzi',
          licenseNumber: assignedServer?.licenseNumber || 'PSL-2026-2',
          state: 'OKLAHOMA',
          county: 'TULSA',
        },
      });
    }
    setSignedExecutions((prev) => [
      ...prev,
      { status: "signed_not_notarized", recipientId: selectedRecipientId, recipient_id: selectedRecipientId, documentType, document_type: documentType },
    ]);
    printHtmlWithImages(finalHtml);
  };

  const pbsName = personBeingServed || resolvedDefendant || defendantRespondent || caseName || 'Target Recipient';
  const activeRecipientObj = recipientsList.find((r) => String(r.id) === selectedRecipientId);
  const executionDocType = (e: { documentType?: string; document_type?: string }) =>
    String(e.documentType || e.document_type || "affidavit").toLowerCase() as LegalDocumentType;
  const hasSignedForDoc = (dt: LegalDocumentType) =>
    signedExecutions.some(
      (e) =>
        e.status === "signed_not_notarized" &&
        executionDocType(e) === dt &&
        (!selectedRecipientId || String(e.recipientId || e.recipient_id || "") === selectedRecipientId),
    );
  const hasActiveSigned = hasSignedForDoc(documentType);
  const activeRecipientName = activeRecipientObj?.full_name || pbsName;
  const inferredKind = effectiveKind;
  const servedAttempt = latestSuccessfulServe(resolvedAttempts, activeRecipientObj?.id, activeRecipientName);
  const methodRaw = String((servedAttempt as any)?.service_method || (servedAttempt as any)?.serviceMethod || '').toLowerCase();
  const acceptedRaw = String((servedAttempt as any)?.accepted_by || (servedAttempt as any)?.acceptedBy || '').trim();
  const methodLabelText = serviceMethodLabel(methodRaw);
  const docsPreview = resolvedDocs;
  const stopCount = physicalAttemptsForAffidavit(resolvedAttempts).length;
  const peopleCount = distinctPeopleCount(resolvedAttempts);
  const caseNoLabel = courtNumber || 'No case #';
  const serverLabel = assignedServer?.displayName || 'the assigned server';
  const isService = effectiveKind === 'service';
  const compactSelect = recipientsList.length > 2 || (typeof window !== 'undefined' && window.innerWidth < 640);

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
      <DialogContent
        hideClose
        className="w-[calc(100vw-1rem)] max-w-2xl max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col"
        onPointerDownOutside={(e) => {
          if (signOpen) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (signOpen) e.preventDefault();
        }}
      >
        <div className="sticky top-0 z-20 flex shrink-0 items-center justify-end border-b bg-background px-3 py-2">
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText className="w-5 h-5 text-blue-600" />
            <span>{documentType === 'declaration' ? 'Generate Court Declaration' : 'Generate Court Affidavit'}</span>
          </DialogTitle>
          <DialogDescription>
            {documentType === 'declaration'
              ? (assignedServer
                  ? `${assignedServer.legalName} (${assignedServer.licenseNumber}) signs under penalty of perjury (12 O.S. § 426). No notary required.`
                  : 'Physical attempts as date/time bars. Executed under penalty of perjury (12 O.S. § 426). No notary required.')
              : (assignedServer
                  ? `${assignedServer.legalName} (${assignedServer.licenseNumber}) signs left; notary wet-ink/stamp right. Swear date = print day.`
                  : 'Physical attempts as date/time bars; phone notes in Comments. Signature left; notary right. Swear date = print day.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 text-sm">
          {hasPendingOutbox && (
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-800 rounded-lg p-3 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <span className="font-semibold block">Sync Pending — Printing & Signing Blocked</span>
                This case has {pendingOutboxCount} attempt(s) waiting in this device's offline outbox.
                Only verified server rows may appear on a court affidavit. Upload them to the server before generating or signing this affidavit.
              </div>
            </div>
          )}
          {fetchFailed && (
            <div className="bg-red-50 dark:bg-red-950 border border-red-300 dark:border-red-800 rounded-lg p-3 text-red-900 dark:text-red-200 text-xs flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
              <div>
                <span className="font-semibold block">Server Records Unavailable</span>
                Failed to load verified attempts from the server. Printing and signing are blocked to prevent generating an affidavit from stale data.
              </div>
            </div>
          )}
          <div className="bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-slate-500 font-medium">Format:</span>
                <span className="text-[11px] text-slate-500 font-mono">
                  {documentType === 'declaration' ? '12 O.S. § 426 · No Notary' : 'Sworn Jurat · Notary Required'}
                </span>
              </div>
              <div className="flex gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={documentType === "affidavit" ? "default" : "outline"}
                  className="h-7 text-xs flex-1"
                  onClick={() => setDocumentType("affidavit")}
                >
                  Sworn Affidavit
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={documentType === "declaration" ? "default" : "outline"}
                  className="h-7 text-xs flex-1"
                  onClick={() => setDocumentType("declaration")}
                  disabled={!allowDeclarations}
                  title={!allowDeclarations ? "Unsworn declarations are disabled by Administrator in Settings" : undefined}
                >
                  Declaration (§ 426)
                </Button>
              </div>
              {!allowDeclarations && (
                <p className="text-[11px] text-amber-700 dark:text-amber-400 italic">
                  Declarations are currently disabled by Administrator in Settings.
                </p>
              )}
            </div>

            <div className="space-y-1 pt-1.5 border-t border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 font-medium">Type:</span>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {isService
                  ? documentType === "declaration"
                    ? "Declaration of Service"
                    : "Affidavit of Service"
                  : documentType === "declaration"
                    ? "Non-Service Declaration"
                    : "Affidavit of Non-Service"}
              </p>
              <p className="text-[11px] text-slate-500">Derived from recorded attempts for this recipient.</p>
            </div>
            {recipientsList.length > 1 ? (
              <div className="space-y-2 pt-1 border-t border-slate-200 dark:border-slate-700">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-medium">Affidavit For:</span>
                  <span className="font-semibold text-blue-600 dark:text-blue-400">
                    {activeRecipientObj?.full_name || pbsName}
                  </span>
                </div>
                {compactSelect ? (
                  <Select value={selectedRecipientId} onValueChange={setSelectedRecipientId}>
                    <SelectTrigger className="h-11 text-sm w-full mt-1">
                      <SelectValue placeholder="Select Recipient" />
                    </SelectTrigger>
                    <SelectContent>
                      {recipientsList.map((rec) => (
                        <SelectItem key={rec.id} value={rec.id}>
                          {rec.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {recipientsList.map((rec) => (
                      <Button
                        key={rec.id}
                        type="button"
                        size="sm"
                        variant={selectedRecipientId === rec.id ? "default" : "outline"}
                        className="h-11 text-xs flex-1 min-w-[120px]"
                        onClick={() => setSelectedRecipientId(rec.id)}
                      >
                        {rec.full_name}
                      </Button>
                    ))}
                  </div>
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
              <span className="font-semibold">{caseNoLabel}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 font-medium">Attempts:</span>
              <span className="font-semibold">
                {isLoadingCase
                  ? '…'
                  : `${stopCount} stop${stopCount === 1 ? '' : 's'}${
                      peopleCount > 1
                        ? ` (${peopleCount} people)`
                        : ''
                    }`}
              </span>
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
          ) : (
            <>
              {hasSignedForDoc("affidavit") && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-2.5 text-xs text-green-800">
                  Signed sworn affidavit on file (notarization pending).
                </div>
              )}
              {allowDeclarations && hasSignedForDoc("declaration") && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-2.5 text-xs text-green-800">
                  Signed declaration on file (12 O.S. § 426 — no notary).
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2 border-t mt-2">
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          {recipientsList.length > 1 && (
            <Button
              onClick={handlePrintAll}
              variant="outline"
              className="h-11 w-full sm:w-auto border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950 flex items-center justify-center gap-1.5"
              disabled={isLoadingCase || hasPendingOutbox || fetchFailed}
              title={hasPendingOutbox ? "Blocked: outbox sync pending" : fetchFailed ? "Blocked: server records unavailable" : "Prints all recipient affidavits in one continuous job, with exhibits once at the end"}
            >
              <Printer className="w-4 h-4 text-blue-600" />
              <span>Print All ({recipientsList.length} Packets)</span>
            </Button>
          )}
          <Button
            onClick={handlePrintOrSave}
            className="h-11 w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2"
            disabled={isLoadingCase || hasPendingOutbox || fetchFailed}
            title={hasPendingOutbox ? "Blocked: outbox sync pending" : fetchFailed ? "Blocked: server records unavailable" : undefined}
          >
            <Printer className="w-4 h-4" />
            <span>
              {recipientsList.length > 1
                ? `Print ${activeRecipientName.split(" ")[0]}`
                : documentType === "declaration"
                  ? "Print Declaration"
                  : "Print / Save PDF"}
            </span>
          </Button>
          {caseId && hasSignedForDoc("affidavit") && (
            <Button
              onClick={() => handlePrintSigned("affidavit")}
              disabled={isRenderingSigned || hasPendingOutbox || fetchFailed}
              className="h-11 w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white flex items-center justify-center gap-2"
            >
              {isRenderingSigned ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              <span>Print Signed Affidavit</span>
            </Button>
          )}
          {caseId && allowDeclarations && hasSignedForDoc("declaration") && (
            <Button
              onClick={() => handlePrintSigned("declaration")}
              disabled={isRenderingSigned || hasPendingOutbox || fetchFailed}
              className="h-11 w-full sm:w-auto bg-green-600 hover:bg-green-700 text-white flex items-center justify-center gap-2"
            >
              {isRenderingSigned ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              <span>Print Signed Declaration</span>
            </Button>
          )}
          {caseId && (isAdmin || assignedServer) && (
            <Button
              onClick={() => setSignOpen(true)}
              variant={hasActiveSigned ? "outline" : "secondary"}
              className="h-11 w-full sm:w-auto flex items-center justify-center gap-2"
              disabled={isLoadingCase || hasPendingOutbox || fetchFailed}
              title={
                hasPendingOutbox
                  ? "Blocked: outbox sync pending"
                  : fetchFailed
                    ? "Blocked: server records unavailable"
                    : allowDeclarations
                      ? "One tap signs sworn affidavit and §426 declaration"
                      : "Applies the assigned server's electronic signature only — does not notarize"
              }
            >
              <PenLine className="w-4 h-4" />
              <span>
                {allowDeclarations
                  ? hasSignedForDoc("affidavit") && hasSignedForDoc("declaration")
                    ? `Re-sign both as ${serverLabel}`
                    : recipientsList.length > 1
                      ? `Sign Affidavit + Declaration (all) as ${serverLabel}`
                      : `Sign Affidavit + Declaration as ${serverLabel}`
                  : hasActiveSigned
                    ? "Re-sign (new version)"
                    : recipientsList.length > 1
                      ? `Sign both as ${serverLabel}`
                      : `Sign Affidavit as ${serverLabel}`}
              </span>
            </Button>
          )}
        </div>

        {caseId && (
          <div className="pt-2">
            <AffidavitExecutionAudit caseId={caseId} />
          </div>
        )}
        </div>
      </DialogContent>

      {caseId && (
        <AffidavitSignatureDialog
          caseId={caseId}
          caseNumber={caseNumber || ''}
          personBeingServed={activeRecipientName}
          open={signOpen}
          onOpenChange={setSignOpen}
          onSigned={handleSigned}
          affidavitKind={effectiveKind}
          documentType={documentType}
          allowDeclarations={allowDeclarations}
          signBothFormats={allowDeclarations}
          recipientId={selectedRecipientId}
          allRecipients={recipientsList}
        />
      )}
    </Dialog>
  );
};

export default AffidavitGenerator;
