# Facilify Test Datasets

This folder contains realistic test datasets generated in both Excel (`.xlsx`) and CSV (`.csv`) formats. You can drag and drop any of these files into Facilify at `/upload`.

| File | Scenario | What it tests |
|---|---|---|
| `01-clean-participants` | Clean Event (20 rows) | 1st, 2nd, 3rd, Best UI/UX, Best Pitch, Honourable Mention, Participation. Standard clean run. |
| `02-multi-award-recipients` | Multi-Award Students | Students with multiple certificates (e.g. 1st Prize + Best UI/UX). Tests bundling into 1 email without duplicate errors. |
| `03-long-names-autofit-test` | Extreme Long Names & Accents | 40–65 character names and non-Latin scripts (Devanagari, French, Spanish). Tests the automatic font-shrink & wrap algorithm. |
| `04-dirty-data-needs-fixing` | Data with Errors | Seeded missing names, invalid email formats, and duplicate rows. Tests the inline interactive fix table at `/fix`. |
| `05-unconventional-headers` | Random Column Order & Synonyms | Headings like "Prize / Category Won", "Attendee Full Name", "Registration #". Tests automatic fuzzy column header matching. |
