import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Eraser, Upload } from "lucide-react";

interface SignatureCaptureProps {
  /** data URL (PNG preferred) or null */
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  /** @default "Sign above" — the baseline label */
  baselineLabel?: string;
  disabled?: boolean;
}

/**
 * Touch/mouse signature pad with an image-upload fallback.
 * Emits a PNG data URL on a transparent background (black ink).
 */
export const SignatureCapture: React.FC<SignatureCaptureProps> = ({
  value,
  onChange,
  baselineLabel = "Sign above",
  disabled,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 340;
    const h = canvas.clientHeight || 120;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#000";

    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
      };
      img.src = value;
    }
  }, [value]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handleDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return;
    e.preventDefault();
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = getPos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
  };

  const handleMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext("2d");
    const { x, y } = getPos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    setHasDrawn(true);
  };

  const handleUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawn(false);
    onChange(null);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-2">
      <div
        className="relative rounded-lg border border-slate-300 bg-white touch-none select-none"
        style={{ height: 130 }}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerLeave={handleUp}
        />
        {!hasDrawn && !value && (
          <div className="absolute inset-0 flex items-end justify-center pb-3 pointer-events-none">
            <span className="text-xs text-slate-400 border-b border-slate-300 w-4/5 text-center pb-0.5">
              {baselineLabel}
            </span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={clear} disabled={disabled}>
          <Eraser className="h-3.5 w-3.5 mr-1" /> Clear
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={disabled}>
          <Upload className="h-3.5 w-3.5 mr-1" /> Upload image
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  );
};

export default SignatureCapture;
