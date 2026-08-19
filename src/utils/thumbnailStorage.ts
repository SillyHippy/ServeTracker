import { generateThumbnail } from "./thumbnailGenerator";
import { v4 as uuidv4 } from "uuid";
import { API_BASE } from "@/lib/publicBase";

export const uploadThumbnailAndGetUrl = async (
  base64Image: string,
  filename?: string
): Promise<{ fileId: string; fileUrl: string }> => {
  const thumbnailBlob = await generateThumbnail(base64Image, {
    maxWidth: 400,
    maxHeight: 300,
    quality: 0.8,
    format: "jpeg",
  });

  const fileId = uuidv4().replace(/-/g, "");
  const finalFilename = filename || `thumbnail_${fileId}.jpg`;
  const file = new File([thumbnailBlob], finalFilename, { type: "image/jpeg" });

  const form = new FormData();
  form.append("file", file);
  form.append("clientId", "thumbnails");
  form.append("description", "thumbnail");

  const res = await fetch(`${API_BASE}/api/documents`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  const doc = await res.json();
  return {
    fileId: doc.file_path || fileId,
    fileUrl: `${API_BASE}/uploads/documents/${doc.file_path}`,
  };
};

export const deleteThumbnail = async (_fileId: string): Promise<boolean> => {
  return true;
};

export const getThumbnailUrl = (filePath: string): string => {
  if (filePath.startsWith("http")) return filePath;
  if (filePath.startsWith("/uploads/")) return `${API_BASE}${filePath}`;
  return `${API_BASE}/uploads/serves/${filePath}.jpg`;
};

export const processAndStoreThumbnail = async (
  imageData: string,
  serveId: string
): Promise<string> => {
  const filename = `serve_${serveId}_thumb.jpg`;
  const { fileUrl } = await uploadThumbnailAndGetUrl(imageData, filename);
  return fileUrl;
};
