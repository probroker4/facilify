# Facilify Architecture

## System Overview

Facilify is structured into three clear tiers:
1. **Engine Layer (`src/lib/`)**: Pure TypeScript domain logic (ingest, routing, rendering, mail, pipeline, tickets, storage, auth, db).
2. **API Routes (`src/app/api/`)**: Next.js App Router endpoints exposing engine services to the client.
3. **User Interface (`src/app/` and `src/components/`)**: Modern responsive web UI built with Tailwind CSS.

```
                    ┌────────────────────────┐
                    │     Spreadsheet        │
                    │   (.xlsx/.xls/.csv)    │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │ Ingest & Header Match  │
                    └───────────┬────────────┘
                                │
                                ▼
                    ┌────────────────────────┐
                    │ Award Discovery/Route  │
                    └───────────┬────────────┘
                                │
                                ▼
            ┌─────────────────────────────────────────┐
            │        High-Fidelity PDF Overlay        │
            │  (Untouched Template + Text Auto-Fit)   │
            └───────────────────┬─────────────────────┘
                                │
                ┌───────────────┴───────────────┐
                ▼                               ▼
    ┌───────────────────────┐       ┌───────────────────────┐
    │     Google Drive      │       │     Email Sender      │
    │  (Organized Folders)  │       │ (Gmail / SMTP / EML)  │
    └───────────────────────┘       └───────────┬───────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │     Mapping Guard     │
                                    │ (Cryptographic Check) │
                                    └───────────┬───────────┘
                                                │
                                                ▼
                                    ┌───────────────────────┐
                                    │    Verified Send      │
                                    └───────────────────────┘
```

## Security & Verification
- **Identity Embedding**: Generated certificate PDFs carry `certId`, `personKey`, and `verifyCode` in their metadata.
- **Mapping Guard**: Refuses any send where attachment sha256 or identity metadata doesn't strictly match the designated recipient.
- **Problem Reporting**: Secure HMAC signatures tie problem report links to specific certificate records without requiring student login.
