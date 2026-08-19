
import React, { useState, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Label } from "@/components/ui/label"
import { ServeAttemptData } from '@/types/ServeAttemptData';
import { useToast } from "@/hooks/use-toast"
import { Textarea } from "@/components/ui/textarea"
import { createUpdateNotificationEmail } from "@/utils/email";
import { api } from "@/lib/api";
import { PhotoUploader, PhotoSlot } from "@/components/PhotoUploader";
import { MapPin, ShieldCheck, Trash2 } from "lucide-react";

interface EditServeDialogProps {
  serve: ServeAttemptData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (serve: ServeAttemptData) => Promise<boolean>;
}

const MAX_PHOTOS = 5;

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

const EditServeDialog: React.FC<EditServeDialogProps> = ({ serve, open, onOpenChange, onSave }) => {
  const { toast } = useToast();
  const [status, setStatus] = useState<"completed" | "failed">(serve.status === "completed" || serve.status === "failed" ? serve.status : "completed");
  const [notes, setNotes] = useState(serve.notes || "");
  const [newPhotos, setNewPhotos] = useState<PhotoSlot[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [serviceMethod, setServiceMethod] = useState<string>(serve.serviceMethod || serve.service_method || "");
  const [acceptedBy, setAcceptedBy] = useState<string>(serve.acceptedBy || serve.accepted_by || "");
  const [refusedToIdentify, setRefusedToIdentify] = useState(false);
  const [postingLocation, setPostingLocation] = useState<string>(serve.postingLocation || serve.posting_location || "");
  const [corporateAgent, setCorporateAgent] = useState<string>(serve.corporateAgent || serve.corporate_agent || "");

  const photosFromServe = (): Array<{ id: string; position: number; imageUrl?: string }> => {
    if (serve.photos && serve.photos.length > 0) {
      return serve.photos.map((p, idx) => ({
        id: String(p.id || ""),
        position: p.position || idx + 1,
        imageUrl: p.imageUrl || p.image_url,
      }));
    }
    const legacyUrl = serve.imageUrl || serve.image_url;
    if (legacyUrl) {
      return [{ id: "legacy-1", position: 1, imageUrl: legacyUrl }];
    }
    return [];
  };

  const [existingPhotos, setExistingPhotos] = useState(photosFromServe);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);

  const originalCoords = serve.coordinates;
  const gpsSource = serve.gpsSource || serve.gps_source;
  const slotsRemaining = Math.max(0, MAX_PHOTOS - existingPhotos.length);

  useEffect(() => {
    setStatus(serve.status === "completed" || serve.status === "failed" ? serve.status : "completed");
    setNotes(serve.notes || "");
    setNewPhotos([]);
    setExistingPhotos(photosFromServe());
    setDeletingPhotoId(null);
    setServiceMethod(serve.serviceMethod || serve.service_method || "");
    setAcceptedBy(serve.acceptedBy || serve.accepted_by || "");
    setRefusedToIdentify(false);
    setPostingLocation(serve.postingLocation || serve.posting_location || "");
    setCorporateAgent(serve.corporateAgent || serve.corporate_agent || "");
  }, [serve, open]);

  const handleDeleteExistingPhoto = async (photoId: string) => {
    const serveId = serve.id;
    if (!serveId || !photoId || photoId.startsWith("legacy")) {
      toast({
        title: "Cannot delete photo",
        description: "This photo has no saved id. Re-open the attempt and try again.",
        variant: "destructive",
      });
      return;
    }
    try {
      setDeletingPhotoId(photoId);
      await api.deleteServePhoto(serveId, photoId);
      setExistingPhotos((prev) =>
        prev.filter((p) => p.id !== photoId).map((p, idx) => ({ ...p, position: idx + 1 }))
      );
      toast({ title: "Photo deleted", description: "Removed from this attempt." });
    } catch (err) {
      toast({
        title: "Could not delete photo",
        description: err instanceof Error ? err.message : "Delete failed",
        variant: "destructive",
      });
    } finally {
      setDeletingPhotoId(null);
    }
  };

  const handleSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();

    const serveId = serve.id;
    if (!serveId) {
      toast({
        title: "Error updating serve",
        description: "Missing serve attempt ID",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSaving(true);

      // PUT: only notes/status — never coordinates or gps_source
      const payload: ServeAttemptData = {
        ...serve,
        id: serveId,
        status,
        notes: notes || "",
        serviceMethod,
        service_method: serviceMethod,
        acceptedBy: refusedToIdentify ? "" : acceptedBy,
        accepted_by: refusedToIdentify ? "" : acceptedBy,
      };
      // Strip GPS fields so parents cannot accidentally overwrite them
      delete (payload as any).coordinates;
      delete (payload as any).gpsSource;
      delete (payload as any).gps_source;
      delete (payload as any).imageData;
      delete (payload as any).image_data;
      delete (payload as any).photos;

      const success = await onSave(payload);

      if (!success) {
        toast({
          title: "Error updating serve",
          description: "Failed to update serve attempt",
          variant: "destructive",
        });
        return;
      }

      // POST any newly added photos into remaining slots
      if (newPhotos.length > 0 && slotsRemaining > 0) {
        const toUpload = newPhotos.filter((p) => p.imageData).slice(0, slotsRemaining);
        let nextPosition = existingPhotos.length + 1;
        for (const photo of toUpload) {
          if (nextPosition > MAX_PHOTOS) break;
          try {
            await api.uploadServePhoto(serveId, nextPosition, photo.imageData!);
            nextPosition++;
          } catch (photoErr) {
            console.error("Failed to upload photo at position", nextPosition, photoErr);
            toast({
              title: "Photo upload issue",
              description: `Status/notes saved, but photo #${nextPosition} failed to upload.`,
              variant: "destructive",
            });
          }
        }
      }

      try {
        const emailBody = createUpdateNotificationEmail(
          serve.clientName || "Unknown Client",
          serve.caseNumber || serve.case_number || "Unknown Case",
          new Date(),
          serve.status || "unknown",
          status,
          notes,
          serve.caseName || serve.case_name
        );

        await api.sendEmailViaFunction({
          to: [
            serve.clientEmail || "info@justlegalsolutions.org",
            "info@justlegalsolutions.org",
          ],
          subject: `Serve Attempt Updated - ${serve.caseNumber || serve.case_number || "Unknown Case"}`,
          html: emailBody,
        });
      } catch (emailError) {
        console.error("Error sending update notification email:", emailError);
      }

      toast({
        title: "Serve updated",
        description: "Serve attempt has been updated successfully",
      });
      onOpenChange(false);
    } catch (error) {
      console.error("Error updating serve:", error);
      toast({
        title: "Error updating serve",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit Serve Attempt</AlertDialogTitle>
          <AlertDialogDescription>
            Update status, notes, and add photos. Original GPS coordinates cannot be changed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4 py-2">
          {/* Read-only original GPS — never editable */}
          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3 space-y-1">
            <Label className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <MapPin className="h-3.5 w-3.5" />
              Original GPS Coordinates
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 ml-1">(locked)</span>
            </Label>
            <p className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100">
              {formatCoordinates(originalCoords)}
            </p>
            <p className="text-[11px] text-slate-500 flex items-center gap-1">
              {gpsSource === "captured" ? (
                <>
                  <ShieldCheck className="h-3 w-3 text-blue-600" />
                  Captured at serve time — cannot be overwritten
                </>
              ) : gpsSource === "manual" ? (
                "Manually entered at serve time — cannot be overwritten"
              ) : (
                "No GPS source recorded — coordinates remain read-only"
              )}
            </p>
          </div>

          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="status" className="text-right">
              Status
            </Label>
            <select
              id="status"
              value={status}
              onChange={(e) => {
                const newStatus = e.target.value;
                if (newStatus === "completed" || newStatus === "failed") {
                  setStatus(newStatus);
                }
              }}
              className="col-span-3 rounded-md border shadow-sm focus:border-primary-500 focus:ring-primary-500 h-10 px-2"
            >
              <option value="completed">Successful</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {status === "completed" && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="serviceMethod" className="text-right">
                Method
              </Label>
              <select
                id="serviceMethod"
                value={serviceMethod}
                onChange={(e) => setServiceMethod(e.target.value)}
                className="col-span-3 rounded-md border shadow-sm focus:border-primary-500 focus:ring-primary-500 h-10 px-2"
              >
                <option value="">— Select method —</option>
                <option value="personal">Personal Service</option>
                <option value="substituted-residence">Substitute (Residence)</option>
                <option value="substituted-business">Substitute (Business)</option>
                <option value="corporate">Corporate / Registered Agent</option>
                <option value="posting">Posting</option>
                <option value="non-service">Non-Service</option>
              </select>
            </div>
          )}

          {status === "completed" && ["substituted-residence", "substituted-business", "corporate"].includes(serviceMethod) && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="acceptedBy" className="text-right">
                Accepted By
              </Label>
              <div className="col-span-3 space-y-1">
                <input
                  id="acceptedBy"
                  type="text"
                  className="w-full rounded-md border shadow-sm focus:border-primary-500 focus:ring-primary-500 h-10 px-2"
                  placeholder="Name of person who received papers"
                  value={acceptedBy}
                  onChange={(e) => setAcceptedBy(e.target.value)}
                  disabled={refusedToIdentify}
                />
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={refusedToIdentify}
                    onChange={(e) => {
                      setRefusedToIdentify(e.target.checked);
                      if (e.target.checked) setAcceptedBy("");
                    }}
                    className="h-3.5 w-3.5"
                  />
                  Won't identify / refused
                </label>
              </div>
            </div>
          )}

          {status === "completed" && serviceMethod === "posting" && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="postingLocation" className="text-right">
                Posting
              </Label>
              <select
                id="postingLocation"
                value={postingLocation}
                onChange={(e) => setPostingLocation(e.target.value)}
                className="col-span-3 rounded-md border shadow-sm focus:border-primary-500 focus:ring-primary-500 h-10 px-2"
              >
                <option value="">Select location</option>
                <option value="front_door">Front door</option>
                <option value="conspicuous_place">Conspicuous place</option>
              </select>
            </div>
          )}

          {status === "completed" && serviceMethod === "corporate" && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="corporateAgent" className="text-right">
                Agent/Company
              </Label>
              <input
                id="corporateAgent"
                type="text"
                className="col-span-3 rounded-md border shadow-sm focus:border-primary-500 focus:ring-primary-500 h-10 px-2"
                placeholder="Registered agent / company name"
                value={corporateAgent}
                onChange={(e) => setCorporateAgent(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[100px] w-full"
              placeholder="Enter detailed notes about this serve attempt..."
            />
          </div>

          {/* Existing photos (read-only display) */}
          {existingPhotos.length > 0 && (
            <div className="space-y-2">
              <Label>
                Existing Photos{" "}
                <span className="text-xs font-normal text-slate-500">
                  ({existingPhotos.length}/{MAX_PHOTOS})
                </span>
              </Label>
              <div className="grid grid-cols-5 gap-2">
                {existingPhotos.map((photo) => (
                  <div
                    key={photo.id || photo.position}
                    className="relative aspect-square rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-900 overflow-hidden"
                  >
                    <img
                      src={photo.imageUrl}
                      alt={`Existing photo ${photo.position}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] text-center font-bold">
                      #{photo.position}
                    </div>
                    {photo.id && !String(photo.id).startsWith("legacy") && (
                      <button
                        type="button"
                        disabled={deletingPhotoId === photo.id}
                        onClick={() => handleDeleteExistingPhoto(photo.id)}
                        className="absolute top-1 right-1 bg-red-600/90 text-white p-1 rounded-full hover:bg-red-700 transition disabled:opacity-50"
                        aria-label={`Delete photo ${photo.position}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new photos up to 5 total */}
          {slotsRemaining > 0 && (
            <PhotoUploader
              photos={newPhotos}
              onChange={setNewPhotos}
              maxPhotos={slotsRemaining}
            />
          )}
          {slotsRemaining === 0 && (
            <p className="text-xs text-slate-500">Maximum of {MAX_PHOTOS} photos reached for this attempt.</p>
          )}
        </form>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isSaving} onClick={handleSubmit}>
            {isSaving ? "Saving..." : "Save"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default EditServeDialog;
