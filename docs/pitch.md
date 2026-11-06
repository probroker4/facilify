# Facilify — Hackathon Pitch & Evaluation Criteria

## 1. Problem
Student event organizers (hackathons, symposiums, conferences, university clubs) spend countless hours manually generating, organizing, and emailing certificates. Standard mail-merge tools often fail on:
- Formatting and design consistency (names overflowing borders or wrapping badly).
- Multi-award recipients (students winning both 1st Prize and Best UI getting duplicate or conflicting emails).
- Security and recipient matching: attaching the wrong student's certificate is a critical data breach.
- Certificate persistence: certificates are lost in chat threads instead of organized into Drive folders.

## 2. Functionality
Facilify provides a comprehensive, end-to-end solution:
- Drag-and-drop ingestion of spreadsheets (`.xlsx`, `.xls`, `.csv`) with typo-tolerant header matching.
- Visual certificate editor overlaying text boxes onto untouched vector PDF or image templates.
- 1,600+ Google Fonts search + 30 offline bundled fonts with native eyedropper color picker.
- Dynamic multi-award categorization routing any prize or special mention.
- Automated name auto-fitting (letter-spacing tightening, font shrinking down to minimum size, line wrapping, middle name abbreviation).
- Direct delivery through Gmail API, SMTP, or offline test outbox.
- Public certificate verification page with QR code and LinkedIn "Add to profile" button.
- Correction ticket system allowing students to report typos and hosts to reissue certificates in one click.

## 3. Accuracy & Critical Safety
- **Mapping Guard**: Every outbound email passes a cryptographic validation check before dispatch. It verifies that attachments match the recipient's identity, the SHA-256 fingerprint equals the generated certificate, and no swapped or extraneous attachments exist.
- **Pixel-Perfect Integrity**: Uploaded template backgrounds are never modified or re-compressed; high-resolution vector text is overlaid on top.

## 4. UX & Novice-Friendly Design
- Step-by-step 8-step guided wizard (Upload → Match columns → Fix → Awards → Design → Email → Preview → Test and send).
- Inline spreadsheet correction table highlighting invalid rows, missing fields, or duplicates.
- Plain-language interface with contextual help tooltips on every screen and downloadable sample sheets.

## 5. Innovation
- Intelligent name auto-fit algorithm handling 60+ character extreme names and non-Latin scripts (Devanagari, accented European characters) without manual tweaking.
- Built-in student typo correction inbox: students click a signed link in their email to submit corrections, and organizers reissue corrected PDFs with replaced Drive storage and audited resend logs.

## 6. Technical Excellence
- Clean Next.js 15 App Router architecture with TypeScript strict mode.
- Local-first design: runs completely offline using `node:sqlite` without external cloud dependencies, Docker, or native build tools.
- Modular adapter pattern for storage (Google Drive REST API / local filesystem) and email (Gmail OAuth 2.0 / Nodemailer SMTP / atomic `.eml` test outbox).

## 7. Scalability & Resilience
- Designed to handle batches from tens to thousands of recipients.
- Resumable pipeline: persistent batch status tracking (Pending, Generated, Saved, Sending, Sent, Failed) with automatic pause on Gmail/SMTP daily quota limits.
- Idempotent operations ensuring network retries never create duplicate files or duplicate emails.

## 8. Presentation & Demo Kit
- `npm run demo` sets up a ready-to-use demo account and sample sheets in one command.
- Bundled fixture datasets (`fixtures/clean25.csv`, `fixtures/dirty.csv`, `fixtures/awards.csv`, `fixtures/long-names.csv`).
- Comprehensive automated verification suite verifying all core engine requirements.
