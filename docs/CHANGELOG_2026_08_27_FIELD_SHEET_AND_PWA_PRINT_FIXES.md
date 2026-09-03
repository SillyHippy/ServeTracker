# Changelog: Field Sheet PDF Engine, Mobile Card Layout & PWA Native Printing Fixes

**Date:** August 27, 2026  
**Target:** ServeTracker (Production & Staging)

---

## Summary of Fixes

This change fixes three high-impact UI / UX and PDF layout issues in ServeTracker:

1. **Field Sheet Contact & Phone Truncation Fix:**  
   Resolves contact phone numbers being chopped off (e.g. `(918)` with missing digits).
2. **Field Sheet "Docs to Serve" Truncation Fix:**  
   Resolves long document lists / multi-pleading titles being cut off at 80 characters.
3. **PWA Standalone Mode Native Printing & Sharing:**  
   Resolves PDF downloads failing to open the native system Print / PDF Viewer app on mobile PWAs (Android/iOS).
4. **Client Cases Responsive Card Layout:**  
   Resolves action buttons and text overflowing/getting cut off on mobile viewports under Clients → Cases.

---

## Detailed File-by-File Changes

### 1. `src/utils/fieldSheetPdfEngine.ts`
* **Contact & Phone Box (`CONTACT / PHONE`):**
  * Removed hardcoded `.slice(0, 24)` truncation.
  * Increased contact box width from `160pt` to `175pt`.
  * Implemented multi-line text wrapping using `wrapText()` at `9pt fontBold` so full names and 10-digit phone numbers wrap onto 2 lines cleanly.
* **Documents to Serve (`Docs to Serve`):**
  * Removed hardcoded `.slice(0, 80)` truncation.
  * Expanded Section 4 (Case Caption & Instructions) height from `68pt` to `76pt`.
  * Implemented dynamic wrapping across full page width (`contentWidth - 14`) with up to 2 wrapped lines so multi-pleading cases (e.g. 3+ motions, notices, orders) render fully without truncation.
* **Requirements & Caption:**
  * Adjusted court name and parties slice limits from 80 to 110 characters at 8.5pt font.
  * Dynamically positioned the requirements line based on wrapped document lines count.

### 2. `src/utils/packetEngine.ts`
* **`openPdfInViewer(pdfBytes, filename)`:**
  * Added detection for Standalone PWA mode (`display-mode: standalone` / `window.navigator.standalone`).
  * Integrated **Web Share API (`navigator.share({ files: [file] })`)** when available on mobile devices:
    * In PWA mode on Android/iOS, this triggers the native system intent sheet directly, allowing the user to select **Print**, **Drive PDF Viewer**, **Adobe Acrobat**, or their wireless printer in 1 tap without browser window sandboxing.
  * Retained tab-opening and direct-download fallback for desktop browsers and unsupported devices.

### 3. `src/components/FieldSheetButton.tsx`
* **Dialog Toolbar Updates:**
  * Added **"Print / Open PDF"** button calling `generateFieldSheetPdf` and `openPdfInViewer` directly from the Field Sheet preview dialog.
  * Ensures field servers and admins can instantly open/print the pixel-perfect 1-page PDF Letter document on mobile devices without relying on fragile HTML `window.print()` DOM overlays.

### 4. `src/components/ClientCases.tsx`
* **Mobile Card & Button Grid Layout:**
  * Replaced rigid 3-button horizontal flex containers with a responsive grid: `grid grid-cols-2 sm:grid-cols-3 gap-1.5 w-full min-w-0`.
  * Added `w-full min-w-0 overflow-hidden shadow-sm` and `break-words` to `Card`, `CardHeader`, and `CardContent` so case titles, service addresses, and action buttons never overflow or clip on narrow mobile screens.

---

## How to Port to Staging

To apply these specific fixes to the staging environment without stomping on independent staging-only features:
1. Apply the updated `src/utils/fieldSheetPdfEngine.ts` (wrapping logic).
2. Apply the updated `src/utils/packetEngine.ts` (Web Share / PWA print integration).
3. Apply the updated `src/components/FieldSheetButton.tsx` (PDF button trigger).
4. Apply the updated `src/components/ClientCases.tsx` (responsive card grid).
5. Run `bun test` and `bun run build`.
