# ServeTracker — Subject/Defendant Photo: Upload, UI Viewer, and PDF Packet Embedding Architecture

Status: **Design (not yet implemented)** — verified against `PDFUSAEDIT-zo` (prod checkout) and `PDFUSAEDIT-staging` on 2026-08-20. Implement in **staging first** (Joseph's staging-only rule), deploy to prod only on explicit promote.

## 1. Verified current state (file:line)

| Concern | Where | What actually happens |
|---|---|---|
| Upload accepts images | `server/routes.ts:2638` `POST /api/cases/:id/documents`; UI `accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"` (`CaseDocumentsDialog.tsx:516`) | Any file accepted. `file_type` stored from **browser MIME, defaulting to `application/pdf`** when empty (`routes.ts:2693`). No magic-byte check, no image validation, no thumbnail, no EXIF handling. |
| **Packet merge drops images silently** | `src/utils/packetEngine.ts:6` `mergePdfDocuments` | Calls `PDFDocument.load()` on **every** buffer. JPEG/PNG throw → caught → `console.warn` → **silently skipped**. A subject photo selected for the Job Packet vanishes with no user-visible error. This is the core defect. (`.doc/.docx` are silently skipped the same way.) |
| No image UI | `CaseDocumentsDialog.tsx:437` | Every doc row renders a `FileText` icon. No thumbnail, no "View Picture", no photo badge. |
| **Bare `/api` href bug** | `CaseDocumentsDialog.tsx:465` | "View" link is `<a href="/api/cases/...">` — violates the API_BASE rule; 404s / hits the wrong backend under the `/servetracker-staging/` subpath proxy. |
| No server-facing photo | `ServeAttempt.tsx` | Has `PhotoUploader` (**proof-of-service** photos, max 5, GPS-stamped) — **not** subject photos. Case-select step (`ServeAttempt.tsx:590-605`) shows only address buttons. |
| No photo on admin cards | `ActiveCasesPanel.tsx:255-362` | Address links, `documents_to_serve` text, status select, FieldSheet/Nudge buttons. No photo affordance. |
| Direct image serving blocked | `server/index.ts:91` | `/uploads/documents/*` → 403. Documents only stream via authenticated download route (`routes.ts:2760`, IDOR + path-traversal guarded, `Content-Disposition: inline`). |
| Reusable pieces | `src/utils/thumbnailGenerator.ts` (canvas→Blob, ≤400×300, jpeg), `src/utils/imageCompressor.ts`, serve-photo pattern `/uploads/serves/...`, `addCol()` migration helper (`server/db.ts:236`), `documentRow()` alias serializer (`routes.ts:442`) | All exist and are proven patterns. |
| Skill reference claims this is done | `servetracker-codebase-work/references/2026-08-20-mobile-toast-ux-webpush-stacking-and-photo-exhibits.md` §3 | Describes magic-byte detection + `embedJpg/embedPng` + photo badges as shipped. **Not in either checkout.** Reference corrected to "planned" (see notes at end). |

## 2. Design decisions (rationale in one line each)

1. **One document store, no new table.** Photos are `client_documents` rows with `kind='photo'`; the existing case-scoped RBAC/IDOR/download/delete pipeline applies unchanged.
2. **Server trusts magic bytes, never client MIME.** Uploader sniffs `%PDF-`, `FF D8 FF` (JPEG), `89 50 4E 47` (PNG), `RIFF....WEBP`.
3. **Thumbnails + packet variants generated client-side at upload.** `sharp` on the Bun VPS is heavy; the codebase already has canvas thumbnail/compress utils, and canvas auto-applies EXIF orientation (browser default `image-orientation: from-image`), which also fixes the pdf-lib rotated-photo pitfall.
4. **`kind` drives UI labeling only; embedding is driven by sniffed bytes.** A scanned JPEG with `description="Petition"` still embeds as an image page — correct either way.
5. **WebP/HEIC never reach pdf-lib.** Upload normalizes a packet-ready JPEG (`{id}_packet.jpg`, ≤1600px, q0.85) client-side; the packet engine therefore only ever embeds JPEG/PNG/PDF. WebP is still viewable in the browser from the original file.
6. **Skipped files are reported, not hidden.** Packet merge returns `{ pdf, skipped: string[] }`; the dialog toasts the skipped names (doc/docx etc.) instead of silently dropping them.
7. **"Primary" photo** (one per case, newest wins by default, admin can re-pin) gives the UI a single canonical face.

## 3. Schema — additive migration (`server/db.ts` `runMigrations()`)

Mirror the existing `addCol` pattern (`db.ts:236`, guarded by `PRAGMA table_info`), targeting `client_documents`:

```ts
addCol("client_documents", "kind",             "TEXT DEFAULT 'document'"); // 'document' | 'photo'
addCol("client_documents", "thumb_file_path",  "TEXT DEFAULT ''");         // {caseId}/{fileId}_thumb.jpg (400px, EXIF-normalized)
addCol("client_documents", "packet_file_path", "TEXT DEFAULT ''");         // {caseId}/{fileId}_packet.jpg (≤1600px q0.85)
addCol("client_documents", "is_primary",       "INTEGER DEFAULT 0");       // 1 for the case's canonical subject photo
```

No data backfill needed: the serializer derives `isImage` from `kind`/`file_type`/extension; legacy image rows get `kind='photo'` lazily on next read or a one-time `UPDATE ... WHERE file_type LIKE 'image/%'` (optional).

## 4. API design

### 4.1 `POST /api/cases/:id/documents` (extend, admin-only as today)

Multipart fields: `file` (required), `description` (default `"Court Document"`), `kind` (`photo` | `document`, default `document`), `thumb` (optional JPEG Blob), `packet` (optional JPEG Blob).

Server logic (after the existing PDF preflight):
1. Sniff magic bytes → `sniffed: 'pdf' | 'jpeg' | 'png' | 'webp' | 'other'`.
2. `kind = sniffed === 'jpeg'|'png'|'webp' ? 'photo' : (kind || 'document')`. Reject `kind='photo'` when `sniffed` is not an image → `400 { error: "File is not a supported image (JPEG/PNG/WebP)" }`.
3. Write original to `UPLOADS_DIR/documents/{caseId}/{fileId}_{cleanName}` as today; write `thumb` → `{fileId}_thumb.jpg`, `packet` → `{fileId}_packet.jpg` (skip gracefully if absent — legacy clients).
4. `file_type` = sniffed MIME (`image/jpeg|image/png|image/webp|application/pdf|application/octet-stream`), never the raw browser string.
5. If `kind='photo'` and `is_primary` is unset for this case: `UPDATE client_documents SET is_primary = 0 WHERE case_id = ?;` then insert with `is_primary=1` (newest photo becomes primary automatically; first photo on a case becomes primary).
6. Return `documentRow(row)` (201).

Also apply the same sniffing to the webhook twin `POST /api/cases/by-number/:caseNumber/documents` (`routes.ts:2705`) so Hermes/Apps Script uploads of photos behave identically.

### 4.2 `GET /api/cases/:id/documents` (extend serializer)

Add to each row (both camelCase + snake_case, per `documentRow` convention):
```json
{ "kind": "photo", "isImage": true, "isPrimary": true,
  "thumbPath": "…/_thumb.jpg", "packetPath": "…/_packet.jpg" }
```
`isImage` derived server-side (kind/sniff); `thumbPath`/`packetPath` only when the variant file exists.

### 4.3 `GET /api/cases/:id/documents/:docId/download` (extend with `?variant=`)

Same RBAC gate, IDOR guard, and path-traversal check as today (`routes.ts:2760-2803`). Add:
- `?variant=thumb` → stream `thumb_file_path` as `image/jpeg`, `Cache-Control: private, max-age=3600` (path is content-addressed via fileId → safe to cache).
- `?variant=packet` → stream `packet_file_path` as `image/jpeg`.
- Default (no variant): unchanged.
- This route is the **only** way to serve these files (static `/uploads/documents/*` stays 403).

### 4.4 `PATCH /api/cases/:id/documents/:docId` (new, admin-only) — "Set as Primary"

Body `{ isPrimary: true }` → `UPDATE client_documents SET is_primary=0 WHERE case_id=?` then `... SET is_primary=1 WHERE id=?`. Returns updated row. (Field servers never write; they only view.)

### 4.5 `DELETE /api/cases/:id/documents/:docId` (extend)

`deleteDocumentFile()` must also unlink `thumb_file_path` and `packet_file_path` (today it only removes the main file, `routes.ts:2813`). Drive backup (original only) is unaffected.

## 5. Client utility changes (`src/utils/`)

### 5.1 New `src/utils/fileType.ts`
```ts
export type SniffedType = "pdf" | "jpeg" | "png" | "webp" | "other";
export function sniffFileType(bytes: Uint8Array): SniffedType; // magic bytes only
export function isImageType(t: SniffedType): boolean;
```

### 5.2 New `src/utils/subjectPhoto.ts` (reuses `thumbnailGenerator.ts` + canvas)
- `makeThumb(file: File): Promise<Blob>` — canvas re-encode ≤400px JPEG q0.8 (EXIF-corrected by browser).
- `makePacketJpeg(file: File): Promise<Blob>` — canvas re-encode ≤1600px long edge, JPEG q0.85, white-composited (flattens PNG alpha/WebP).
- Both used in the upload form; `packet` only sent for images.

### 5.3 `src/utils/packetEngine.ts` — rewrite merge with image embedding

```ts
export interface PacketSection { bytes: Uint8Array; name: string; }
export interface PacketResult { pdf: Uint8Array; skipped: { name: string; reason: string }[]; }

export async function buildJobPacket(sections: PacketSection[]): Promise<PacketResult>;
// legacy wrapper kept: mergePdfDocuments = (a) => buildJobPacket(a.map(...)).pdf
```

Per-section algorithm:
1. `sniffFileType(bytes)`.
2. **pdf** → `PDFDocument.load(bytes, { ignoreEncryption: true })` → `copyPages` (today's behavior, unchanged).
3. **jpeg** → `doc.embedJpg(bytes)`; **png** → `doc.embedPng(bytes)`; then for each image add a **new Letter page** (612×792) and:
   - caption bar: `SUBJECT PHOTO — {section.name}` (Helvetica-Bold 10, gray) at top, y≈756;
   - `const { width, height } = img.scaleToFit(540, 720)`; center: `x = (612 - width)/2`, `y = 36 + (720 - height)/2` (pdf-lib y-origin is bottom-left; keep the caption above via `y + height ≤ 756`);
   - thin border rectangle around the image (`drawRectangle`, 0.75pt, `rgb(0.7,0.7,0.7)`).
   - One image per page (print clarity for field use).
4. **webp / other** (doc, docx, corrupted) → push `{ name, reason }` to `skipped` — never throw, never silently drop.
5. Return `{ pdf: await merged.save(), skipped }`.

`openPdfInViewer` unchanged.

## 6. UI design

### 6.1 `CaseDocumentsDialog.tsx` (admin intake + everyone's case view)
- **Upload box** (`L492-559`): add a small preset row — `[ 📄 Court Document ] [ 📸 Subject Photo ]` — setting `kind` + prefilled description. When `kind=photo`, the accept attr becomes `image/jpeg,image/png,image/webp` and `makeThumb`/`makePacketJpeg` run per file before the multipart POST (append `thumb`, `packet`, `kind` parts).
- **Doc rows** (`L418-486`):
  - `kind === 'photo'` → 48px rounded `<img src={`${API_BASE}/api/cases/${caseId}/documents/${doc.id}/download?variant=thumb`}>` thumbnail (replace `FileText` icon); badge `📸 Subject Photo` (amber); `isPrimary` → `★ Primary` badge (emerald).
  - Button becomes `[ 👁 View Picture ]` (admin + assigned field servers) linking `${API_BASE}/api/cases/${caseId}/documents/${doc.id}/download` — **fixes the bare-`/api` href bug (L465)**; `target="_blank"`.
  - Admin extra: star-toggle `Set as Primary` (calls the new PATCH) and existing trash (deletes variants via 4.5).
  - PDF/doc rows keep `FileText` + `View` (href also switched to `API_BASE`).
- **Packet generation** (`handleDownloadMergedPacket` L230-299): switch to `buildJobPacket`; fetch per-doc bytes with `?variant=packet` when `doc.kind === 'photo' && doc.packetPath` (else full download — legacy rows); on result, if `skipped.length` → toast `Skipped: a.docx, b.doc (not PDF or image)` (destructive-ish, amber); else existing success toast. Filename logic unchanged.

### 6.2 `ServeAttempt.tsx` (field server — the money shot)
- **select step** (L590-605 area): render a 64×72px subject-photo thumbnail card beside the address buttons: `<img src={…?variant=thumb}>` (primary photo first, else newest photo), tap → full-res in new tab (`?variant=` default). If no photo, nothing renders (no empty-state noise in the field).
- **confirm step** (L622+ header, next to "Person Being Served"): 88px inline thumbnail of the selected recipient's case photo — the server confirms identity **at the moment of logging**. Data source: extend the case payload already fetched by ServeAttempt (case object gains `subjectPhoto?: { id, thumbUrl, url }` from a lightweight `GET /api/cases/:id` serializer addition or from `GET /api/cases/:id/documents`).

### 6.3 `ActiveCasesPanel.tsx` (admin dashboard)
- Card top-right (L322 action column start): 40px rounded avatar thumbnail when a primary/non-archived photo exists; `onClick` opens the full image (new tab). No photo → 36px ghost `[ + 📸 ]` button opening `CaseDocumentsDialog` (already mounted for admins). One element, `shrink-0`.

### 6.4 Field sheet photo (Phase 2, optional but high value)
`fieldSheetPdfEngine.ts`: add optional `subjectPhotoBytes?: Uint8Array` to `FieldSheetPayload`; when present, draw a 56×56pt `embedJpg` image inside the amber TARGET banner (right side; widen banner from 64→72pt and shift server line left to fit). `CaseDocumentsDialog` fetch of `?variant=packet` bytes happens before `generateFieldSheetPdf` when `includeFieldSheet` and a primary photo exists. Result: printed job packet page 1 shows the face.

## 7. Security checklist (carry over from existing patterns)
- Magic-byte sniffing server-side; **reject SVG/HTML masquerading as images** (SVG XSS via `<img>` is avoided by never storing/serving it; accept-list: jpeg/png/webp only for `kind=photo`).
- Thumb/packet variants served **only** via the authenticated download route (same RBAC + IDOR + traversal guards). `/uploads/documents/*` static stays 403 (`index.ts:91`).
- Response `Content-Type` from sniffed MIME, not client string.
- `Cache-Control: private` on image variants (auth-cookie dependent).
- Field servers: view-only; PATCH/DELETE remain admin-only. Listing/download keep the assigned-to gate (`routes.ts:2615`, `2767`).

## 8. Implementation order & verification

**Phase 1 (core):** db.ts cols → routes.ts (sniffing, variants, PATCH, delete-cascade) → `fileType.ts`/`subjectPhoto.ts` → `packetEngine.ts` rewrite → `CaseDocumentsDialog` (upload presets + thumbnails + View Picture + API_BASE fix + buildJobPacket) → `ServeAttempt` select/confirm thumbnails.
**Phase 2:** `ActiveCasesPanel` avatar → primary pin UI → field-sheet photo → `docs/` note updates.
**Phase 3 (optional):** server-side conversion (sharp) for legacy WebP/HEIC originals and doc/docx→PDF conversion.

Verify (staging, `:3153`):
1. curl multipart upload JPEG / PNG / WebP / PDF / .doc → check `kind`, `is_primary`, `thumb_file_path` files on disk, 201 body.
2. `GET …/documents` shows `isImage/isPrimary/thumbPath`; `GET …/download?variant=thumb` returns `image/jpeg`; unassigned field-server → 403 on all three; traversal docId → 400.
3. Browser: mixed selection (Field Sheet + PDF + JPEG + PNG + WebP + .doc) → packet has Field Sheet p1, PDF pages, one page per photo (correct orientation — use an EXIF-orientation-6 test image), WebP + .doc reported in the skipped toast, no silent loss.
4. ServeAttempt select/confirm thumbnails for assigned server; admin star-toggle re-pins primary; delete removes all three files.
5. Extend `scripts/e2e-field-server.py` with a photo-upload + packet-open step.

## 9. Files touched (exact)
- `server/db.ts` — 4 `addCol` lines
- `server/routes.ts` — POST ×2 (sniff/variants/primary), GET list serializer, download `?variant=`, new PATCH, DELETE cascade
- `server/index.ts` — unchanged
- `src/utils/packetEngine.ts` — `buildJobPacket` rewrite (+ kept `mergePdfDocuments` wrapper)
- `src/utils/fileType.ts` — new
- `src/utils/subjectPhoto.ts` — new
- `src/components/CaseDocumentsDialog.tsx`, `src/components/ServeAttempt.tsx`, `src/components/ActiveCasesPanel.tsx`
- `src/utils/fieldSheetPdfEngine.ts` (+ `fieldSheetEngine.ts` payload type) — Phase 2
- `src/types/…` — DocumentItem gains `kind/isImage/isPrimary/thumbPath/packetPath`
