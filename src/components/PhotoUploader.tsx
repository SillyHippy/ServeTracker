import React, { useRef } from "react";
import { Camera, Trash2, ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { compressImage } from "@/utils/imageCompressor";

export interface PhotoSlot {
  position: number;
  imageData?: string;
  imageUrl?: string;
  /** When THIS photo was taken/added (ISO). Each exhibit gets its own stamp. */
  capturedAt?: string;
}

interface PhotoUploaderProps {
  photos: PhotoSlot[];
  onChange: (photos: PhotoSlot[]) => void;
  maxPhotos?: number;
}

export const PhotoUploader: React.FC<PhotoUploaderProps> = ({
  photos,
  onChange,
  maxPhotos = 5,
}) => {
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleMultiFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const available = maxPhotos - photos.length;
    const filesToProcess = Array.from(files).slice(0, available);

    const newSlots: PhotoSlot[] = [];
    let nextPos = photos.length + 1;

    for (const file of filesToProcess) {
      try {
        // Stamp each file as it's processed so multi-select still gets distinct times
        // if the user adds more photos later after waiting outside.
        const capturedAt = new Date().toISOString();
        const compressed = await compressImage(file, { maxDimension: 1600, quality: 0.75 });
        newSlots.push({ position: nextPos, imageData: compressed, capturedAt });
        nextPos++;
      } catch (err) {
        console.error("Failed to compress image:", err);
      }
    }

    if (newSlots.length > 0) {
      onChange([...photos, ...newSlots]);
    }

    if (e.target) e.target.value = "";
  };

  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photos.length >= maxPhotos) return;

    try {
      const capturedAt = new Date().toISOString();
      const compressed = await compressImage(file, { maxDimension: 1600, quality: 0.75 });
      const nextPos = photos.length + 1;
      onChange([...photos, { position: nextPos, imageData: compressed, capturedAt }]);
    } catch (err) {
      console.error("Failed to compress camera image:", err);
    }

    if (e.target) e.target.value = "";
  };

  const handleRemovePhoto = (pos: number) => {
    const remaining = photos.filter((p) => p.position !== pos);
    const repacked = remaining.map((p, idx) => ({ ...p, position: idx + 1 }));
    onChange(repacked);
  };

  const slotsRemaining = maxPhotos - photos.length;

  return (
    <div className="space-y-3">
      <input
        type="file"
        ref={galleryInputRef}
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleMultiFileSelect}
      />
      <input
        type="file"
        ref={cameraInputRef}
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraCapture}
      />

      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <span>Photos & Exhibits</span>
          <span className="text-xs font-normal text-slate-500">({photos.length}/{maxPhotos})</span>
        </label>
      </div>

      {slotsRemaining > 0 && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-11 text-xs font-bold gap-2"
            onClick={() => galleryInputRef.current?.click()}
          >
            <ImagePlus className="w-4 h-4 text-blue-600" />
            Choose Photos ({slotsRemaining} left)
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-11 text-xs font-bold gap-2"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera className="w-4 h-4 text-emerald-600" />
            Take Photo
          </Button>
        </div>
      )}

      {photos.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {photos.map((photo) => {
            const imgSrc = photo.imageData || photo.imageUrl;
            const when = photo.capturedAt
              ? new Date(photo.capturedAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : "";
            return (
              <div
                key={photo.position}
                className="relative aspect-square rounded-lg border-2 border-emerald-500 bg-slate-900 overflow-hidden"
              >
                <img src={imgSrc} alt={`ServeTracker Photo ${photo.position}`} className="w-full h-full object-cover rounded" />
                <div className="absolute top-1 left-1 bg-black/70 text-white font-bold text-[10px] px-1.5 py-0.5 rounded">
                  #{photo.position}
                </div>
                {when && (
                  <div className="absolute bottom-1 left-1 right-1 bg-black/70 text-white text-[9px] px-1 py-0.5 rounded truncate text-center">
                    {when}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => handleRemovePhoto(photo.position)}
                  className="absolute top-1 right-1 bg-red-600/90 text-white p-1 rounded-full hover:bg-red-700 transition"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
