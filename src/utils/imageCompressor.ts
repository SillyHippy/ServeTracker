/**
 * Shared Image Normalization & Canvas Compression Engine
 * Enforces max dimension (1600px) and JPEG quality (0.75) across both in-app camera & native pickers.
 */

export interface CompressionOptions {
  maxDimension?: number;
  quality?: number;
}

export async function compressImage(
  input: string | File | Blob,
  options: CompressionOptions = {}
): Promise<string> {
  const maxDimension = options.maxDimension || 1600;
  const quality = options.quality || 0.75;

  let dataUrl = "";
  if (typeof input === "string") {
    dataUrl = input;
  } else {
    dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(input);
    });
  }

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl); // Fallback if 2d context unavailable
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL("image/jpeg", quality);
      resolve(compressed);
    };

    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}
