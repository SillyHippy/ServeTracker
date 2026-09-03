import { PDFDocument } from "pdf-lib";

/**
 * Concatenates multiple PDF byte arrays into a single combined PDF.
 */
export async function mergePdfDocuments(pdfByteArrays: (Uint8Array | ArrayBuffer)[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const bytes of pdfByteArrays) {
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const copiedPages = await mergedPdf.copyPages(doc, doc.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    } catch (err) {
      console.warn("[PacketEngine] Skipping damaged/invalid PDF during merge:", err);
    }
  }

  return await mergedPdf.save();
}

/**
 * Triggers native browser print / view / share for a generated PDF buffer.
 * In standalone PWA mode on mobile (Android/iOS), navigator.share opens the
 * native system sheet / print app directly without sandboxing.
 */
export async function openPdfInViewer(pdfBytes: Uint8Array, filename = "job_packet.pdf") {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const isPWA =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes("android-app://"));

  // On Mobile / PWA: Try Web Share API with File so Android/iOS opens the Print / PDF viewer app directly
  if (typeof navigator !== "undefined" && navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: filename,
          text: `Court Document / Field Sheet: ${filename}`,
        });
        return;
      }
    } catch (err: any) {
      // User cancelled share or share failed; proceed to browser window / download fallback
      if (err?.name !== "AbortError") {
        console.warn("[PacketEngine] Web Share fallback:", err);
      }
    }
  }

  const url = URL.createObjectURL(blob);

  // If not standalone PWA, attempt opening in new window/tab
  if (!isPWA) {
    const win = window.open(url, "_blank");
    if (win) {
      return;
    }
  }

  // Direct download link trigger (works reliably across desktop & mobile PWA)
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
