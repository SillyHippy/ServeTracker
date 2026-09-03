import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import {
  FileText,
  Upload,
  Download,
  Trash2,
  Cloud,
  Loader2,
  Plus,
  Paperclip,
  CheckSquare,
  Square,
  Printer,
  ClipboardList,
  Files,
} from "lucide-react";
import { mergePdfDocuments, openPdfInViewer } from "@/utils/packetEngine";
import { generateFieldSheetHtml, printFieldSheetInPage, FieldSheetPayload } from "@/utils/fieldSheetEngine";
import { generateFieldSheetPdf } from "@/utils/fieldSheetPdfEngine";
import { API_BASE } from "@/lib/api";

interface DocumentItem {
  id: string;
  caseId: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  description: string;
  isArchived: boolean;
  hasDriveBackup: boolean;
  createdAt: string;
}

interface Props {
  caseId: string;
  caseNumber: string;
  defendantName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldSheetData?: FieldSheetPayload;
}

export const CaseDocumentsDialog: React.FC<Props> = ({
  caseId,
  caseNumber,
  defendantName,
  open,
  onOpenChange,
  fieldSheetData,
}) => {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { toast } = useToast();

  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [merging, setMerging] = useState(false);
  const [resolvedSheetData, setResolvedSheetData] = useState<FieldSheetPayload | undefined>(fieldSheetData);

  // Checkbox selections for packet generation
  const [includeFieldSheet, setIncludeFieldSheet] = useState(true);
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());

  const [description, setDescription] = useState("Court Document");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  useEffect(() => {
    if (fieldSheetData) {
      setResolvedSheetData(fieldSheetData);
      return;
    }
    if (!caseId || !open) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/cases/${caseId}`, { credentials: "include" });
        if (res.ok) {
          const c = await res.json();
          setResolvedSheetData({
            caseNumber: c.case_number,
            caseName: c.case_name,
            courtName: c.court_name,
            plaintiff: c.plaintiff_petitioner,
            defendant: c.defendant_respondent,
            documents: c.documents_to_serve || "",
            notes: c.notes,
            requirements: c.service_requirements || "",
            contactInfo: c.contact_info || "",
            homeAddress: c.home_address,
            workAddress: c.work_address,
            personToServe: c.defendant_respondent || c.case_name || defendantName,
            assignedServer: c.assigned_name || (user?.role === "server" ? (user?.displayName || user?.username) : ""),
            hideClient: user?.role === "server",
          });
        }
      } catch {
        // ignore
      }
    })();
  }, [caseId, open, fieldSheetData, user, defendantName]);

  const fetchDocs = async () => {
    if (!caseId || !open) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/cases/${caseId}/documents`, { credentials: "include" });
      if (res.ok) {
        const list: DocumentItem[] = await res.json();
        setDocs(list);
        setSelectedDocIds(new Set(list.map((d) => d.id)));
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDocs();
  }, [caseId, open]);

  const toggleDoc = (id: string) => {
    setSelectedDocIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setIncludeFieldSheet(true);
    setSelectedDocIds(new Set(docs.map((d) => d.id)));
  };

  const deselectAll = () => {
    setIncludeFieldSheet(false);
    setSelectedDocIds(new Set());
  };

  const handleUploadMultiple = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) {
      toast({ title: "Files required", description: "Select at least one file to upload", variant: "destructive" });
      return;
    }

    setUploading(true);
    let successCount = 0;

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadProgress(`Uploading ${i + 1} of ${selectedFiles.length}: ${file.name}`);

        const form = new FormData();
        form.append("file", file);
        form.append("description", description || "Court Document");

        const res = await fetch(`${API_BASE}/api/cases/${caseId}/documents`, {
          method: "POST",
          body: form,
          credentials: "include",
        });

        if (res.ok) {
          successCount++;
        }
      }

      toast({
        title: "Uploads Complete 📄",
        description: `Successfully attached ${successCount} document(s) to case ${caseNumber}.`,
      });

      setSelectedFiles([]);
      setDescription("Court Document");
      setUploadProgress("");
      void fetchDocs();
    } catch (err: any) {
      toast({
        title: "Upload Issue",
        description: err.message || "Some files could not be uploaded",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setUploadProgress("");
    }
  };

  const handleDelete = async (docId: string, fileName: string) => {
    if (!confirm(`Delete ${fileName}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/cases/${caseId}/documents/${docId}`, { method: "DELETE", credentials: "include" });
      if (res.ok) {
        toast({ title: "Document deleted", description: `${fileName} removed.` });
        setDocs((prev) => prev.filter((d) => d.id !== docId));
        setSelectedDocIds((prev) => {
          const next = new Set(prev);
          next.delete(docId);
          return next;
        });
      }
    } catch {
      // ignore
    }
  };

  const handleDownloadMergedPacket = async () => {
    const chosenDocs = docs.filter((d) => selectedDocIds.has(d.id));

    if (chosenDocs.length === 0 && !includeFieldSheet) {
      toast({
        title: "Nothing selected",
        description: "Please check at least one document or the Field Sheet.",
        variant: "destructive",
      });
      return;
    }

    setMerging(true);
    try {
      const buffers: Uint8Array[] = [];

      // 1. Prepend Field Sheet as Page 1 if selected
      if (includeFieldSheet) {
        const sheetData: FieldSheetPayload = resolvedSheetData || {
          caseNumber,
          personToServe: defendantName,
          assignedServer: user?.role === "server" ? (user?.displayName || user?.username) : "",
          hideClient: user?.role === "server",
        };
        try {
          const sheetPdfBytes = await generateFieldSheetPdf(sheetData);
          buffers.push(sheetPdfBytes);
        } catch (sheetErr) {
          console.warn("[CaseDocumentsDialog] Field sheet PDF generation fallback:", sheetErr);
        }
      }

      // 2. Fetch selected court documents
      for (const doc of chosenDocs) {
        const res = await fetch(`${API_BASE}/api/cases/${caseId}/documents/${doc.id}/download`, { credentials: "include" });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          buffers.push(new Uint8Array(buf));
        }
      }

      if (buffers.length === 0) {
        throw new Error("Could not retrieve documents or field sheet");
      }

      // 3. If ONLY the field sheet was selected and generated
      if (buffers.length === 1 && includeFieldSheet && chosenDocs.length === 0) {
        openPdfInViewer(buffers[0], `${caseNumber}_Field_Sheet.pdf`);
        toast({ title: "Field Sheet Ready 📄", description: "Opened printable Field Sheet PDF." });
        return;
      }

      // 4. Merge all selected PDFs (Field Sheet on Page 1 + Court Documents)
      const mergedBytes = await mergePdfDocuments(buffers);
      const filename = includeFieldSheet ? `${caseNumber}_Job_Packet.pdf` : `${caseNumber}_Court_Documents.pdf`;
      openPdfInViewer(mergedBytes, filename);
      toast({
        title: "Job Packet Ready 📦",
        description: `Merged ${buffers.length} document section(s) into single PDF.`,
      });
    } catch (err: any) {
      toast({
        title: "Could not merge packet",
        description: err.message || "Failed to merge PDFs",
        variant: "destructive",
      });
    } finally {
      setMerging(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const totalSelectedCount = selectedDocIds.size + (includeFieldSheet ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            Service Documents & Job Packet
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {caseNumber} {defendantName ? `• ${defendantName}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Action header with Checkbox controls */}
          <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={selectAll}
                className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700"
              >
                <CheckSquare className="h-3.5 w-3.5 mr-1" /> Select All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={deselectAll}
                className="h-7 px-2 text-xs text-slate-500 hover:text-slate-700"
              >
                <Square className="h-3.5 w-3.5 mr-1" /> Deselect All
              </Button>
            </div>

            <Button
              variant="default"
              size="sm"
              onClick={handleDownloadMergedPacket}
              disabled={merging || totalSelectedCount === 0}
              className="h-8 text-xs bg-blue-600 hover:bg-blue-700 font-semibold shadow-xs"
            >
              {merging ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" /> Merging...
                </>
              ) : (
                <>
                  <Printer className="h-3.5 w-3.5 mr-1" /> Download / Print Selected ({totalSelectedCount})
                </>
              )}
            </Button>
          </div>

          {/* Document selection list */}
          <div className="space-y-2">
            {/* 1. Page 1: Field Sheet Checkbox Row */}
            <div
              onClick={() => setIncludeFieldSheet(!includeFieldSheet)}
              className={`p-3 flex items-center justify-between gap-3 transition rounded-lg border cursor-pointer ${
                includeFieldSheet
                  ? "bg-amber-50/70 border-amber-300 ring-1 ring-amber-300 dark:bg-amber-950/40 dark:border-amber-800"
                  : "bg-slate-50/50 border-slate-200 opacity-60 hover:opacity-100"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <Checkbox
                  checked={includeFieldSheet}
                  onCheckedChange={(checked) => setIncludeFieldSheet(Boolean(checked))}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-amber-600 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      Page 1: Case Field Sheet
                    </span>
                    <Badge className="bg-amber-100 text-amber-800 text-[10px] h-4 font-semibold">
                      Summary Header
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Includes party banner, addresses, phone box, physical attempt rows, and instructions.
                  </p>
                </div>
              </div>

              <span className="text-[11px] font-semibold text-amber-700 shrink-0">
                {includeFieldSheet ? "Included" : "Excluded"}
              </span>
            </div>

            {/* 2. Attached Court Documents */}
            {loading ? (
              <div className="py-6 text-center text-xs text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-1" />
                Loading documents...
              </div>
            ) : docs.length === 0 ? (
              <div className="p-5 text-center border border-dashed rounded-lg bg-slate-50 text-muted-foreground text-xs">
                <Paperclip className="h-6 w-6 mx-auto mb-1 text-slate-300" />
                <p className="font-medium text-slate-600">No attached court documents</p>
                {isAdmin && <p className="text-[11px] mt-0.5">Upload Summons, Petition, or Exhibits below.</p>}
              </div>
            ) : (
              <div className="divide-y border rounded-lg overflow-hidden bg-white shadow-2xs">
                {docs.map((doc, idx) => {
                  const isChecked = selectedDocIds.has(doc.id);
                  return (
                    <div
                      key={doc.id}
                      onClick={() => toggleDoc(doc.id)}
                      className={`p-3 flex items-center justify-between gap-3 transition cursor-pointer hover:bg-slate-50 ${
                        isChecked ? "bg-blue-50/40" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleDoc(doc.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                            <span className="text-xs font-semibold text-slate-800 truncate">
                              Page {includeFieldSheet ? idx + 2 : idx + 1}+: {doc.fileName}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                            <span>{doc.description || "Document"}</span>
                            <span>•</span>
                            <span>{formatBytes(doc.fileSize)}</span>
                            <span>•</span>
                            <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                            {doc.hasDriveBackup && (
                              <Badge variant="outline" className="text-[9px] h-4 text-emerald-600 border-emerald-300">
                                <Cloud className="h-2.5 w-2.5 mr-0.5" /> Drive
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="h-8 px-2 text-xs text-blue-600 hover:text-blue-700"
                        >
                          <a
                            href={`/api/cases/${caseId}/documents/${doc.id}/download`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Download className="h-3.5 w-3.5 mr-1" /> View
                          </a>
                        </Button>

                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleDelete(doc.id, doc.fileName)}
                            className="h-8 w-8 p-0 text-slate-400 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Admin multi-file upload box */}
          {isAdmin && (
            <form onSubmit={handleUploadMultiple} className="p-3 bg-slate-50 border rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5 text-blue-600" />
                Upload Court Documents / Summons (Multi-file allowed)
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Category / Description</Label>
                  <Input
                    placeholder="e.g. Summons, Petition, Notice"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="h-8 text-xs bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">
                    Select Files (select 1 or multiple PDFs)
                  </Label>
                  <Input
                    type="file"
                    multiple
                    accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                    onChange={(e) => {
                      if (e.target.files) {
                        setSelectedFiles(Array.from(e.target.files));
                      }
                    }}
                    className="h-8 text-xs bg-white file:text-xs file:py-0"
                  />
                </div>
              </div>

              {selectedFiles.length > 0 && (
                <div className="text-[11px] text-blue-700 font-medium flex items-center gap-1">
                  <Files className="h-3.5 w-3.5" />
                  {selectedFiles.length} file(s) selected: {selectedFiles.map((f) => f.name).join(", ")}
                </div>
              )}

              {uploadProgress && (
                <div className="text-[11px] text-amber-700 font-semibold flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> {uploadProgress}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  size="sm"
                  disabled={uploading || selectedFiles.length === 0}
                  className="h-8 text-xs bg-blue-600 hover:bg-blue-700 font-semibold"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin mr-1" /> Uploading {selectedFiles.length} file(s)...
                    </>
                  ) : (
                    <>
                      <Upload className="h-3 w-3 mr-1" /> Attach {selectedFiles.length > 1 ? `${selectedFiles.length} Files` : "Document"}
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </div>

        <DialogFooter className="p-3 border-t bg-slate-50/50">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="text-xs">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
