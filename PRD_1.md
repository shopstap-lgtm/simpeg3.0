# PRD — SIMPEG Korwil Cibitung 2.0 (Rebuild)

## 0. Document purpose

This PRD covers the rebuild of the existing Google Apps Script + Google Sheets/Drive
web app ("SIMPEG Korwil Cibitung 2.0") into a professional, mobile-first, non-Google
stack. Section 6 contains ready-to-use prompts, meant to be pasted **in order** into
an AI IDE (Antigravity, Cursor, Windsurf, etc.) to scaffold and build the app
incrementally.

---

## 1. Reference site — what it actually does

Reverse-engineered from the uploaded `Code.gs` / `Code.js` (Apps Script backend,
~2,400 lines) and `Index.html` (Alpine.js SPA, ~4,200 lines):

**Domain:** attendance (absensi) and performance (e-kinerja) reporting system for
school staff under a sub-district education coordination office (Korwil Cibitung),
covering ~1,000+ employees across several `unit_kerja` (schools/units).

**Public-facing menus (no login):**
1. **Dashboard Publik** — headline stats (total pegawai, % kehadiran, breakdown by
   employment status: PNS / PPPK / PPPK-PW / Outsourcing), filterable by unit
   kerja, hero banner + announcement text driven by an admin-editable CMS.
2. **Rekap Absensi** — monthly attendance grid per employee (1 row per employee,
   1 column per day 1–31), color-coded cells (red = alpha/absent, green = hadir,
   blue = dinas luar/other), searchable, filterable by unit and month. Employees
   can open a modal and submit a **klarifikasi** (clarification) for a specific
   date or date range: a reason + a PDF proof file, which goes into a pending
   queue for admin approval.
3. **Laporan E-Kinerja** — monthly performance report per employee. Employees
   upload two PDFs (laporan harian + laporan bulanan) which go into a pending
   queue for admin scoring (nilai harian / nilai bulanan).

**Admin panel (login required, role-gated):**
- Roles: `Admin` and `Super Admin`.
- **Klarifikasi tab**: list of pending clarifications → approve/reject with a
  note; also a bulk **Excel upload/sync** tool — admins upload one or many daily
  attendance `.xlsx` exports, the backend auto-detects the date (multiple regex
  patterns against filename and cell contents), auto-detects which spreadsheet
  columns represent days 1–31 (`findDayColumns`), and merges the data into the
  master recap sheet.
- **E-Kinerja tab**: list of pending reports → review, assign `nilaiHarian` /
  `nilaiBulanan`, approve/reject with a note.
- **CMS Dashboard tab** (Super Admin only): edit the public dashboard's hero
  text, announcement banner, default selected month for absensi/e-kinerja, and
  other display config.
- **Kelola Admin tab** (Super Admin only): CRUD for admin accounts, including
  activate/deactivate.

**Current infra (being replaced):**
- Google Sheets as the database (`Pegawai`, `CMS`, `Klarifikasi`, `Kinerja`,
  `Admin` sheets, referenced via a `SHEETS` constants object not present in the
  uploaded files but implied by `getDB()` / `SHEETS.*` calls).
- Google Drive as file storage for clarification/e-kinerja PDFs and for
  ingested Excel files (`FOLDER_INPUT_ID`).
- Apps Script `doGet`/`google.script.run` as the entire API layer; Alpine.js SPA
  frontend (single `Index.html`, all menus as `x-show` toggled divs).
- Custom heuristics load-bearing for the whole system: `parseDaysFromTanggalStr`,
  `findDayColumns`, `isRedBg/isGreenBg/isBlueBg`, `extractDateInfoFromSource` —
  these exist purely to compensate for unstructured spreadsheet data and should
  **not** be ported as-is; see §4.5.

---

## 2. Goals

- Replace the Google Sheets/Drive/Apps Script stack with **Supabase** (Postgres +
  Auth + Storage) as the sole backend/data layer.
- Replace the single-file Alpine.js SPA with a **Multi-Page Application**: every
  menu (Dashboard, Rekap Absensi, Laporan E-Kinerja, Admin login, Admin
  Klarifikasi, Admin E-Kinerja, Admin CMS, Admin Users) is its own route and its
  own HTML/view file, server-rendered per request.
- Structure the codebase with a classic **MVC** separation: Models (data access,
  Supabase/Postgres), Views (server-rendered templates, one per page), Controllers
  (route handlers orchestrating Models → Views).
- **Mobile-first** responsive design — the attendance grid and admin tables are
  the hardest cases and must be designed for narrow viewports first (card/list
  layouts on mobile, full grid on desktop), not just a shrunk desktop layout.
- Preserve all functional behavior described in §1 (public dashboard, attendance
  recap + clarification workflow, e-kinerja submission + review workflow, admin
  roles, CMS-driven content, bulk Excel import).
- Normalize the data model (replace "day-of-month as spreadsheet column" with a
  proper relational schema) so the fragile column/date-detection heuristics are
  no longer required for day-to-day operation.

## 3. Non-goals

- Not migrating historical Google Sheets data automatically (a one-off import
  script is in scope; a general-purpose Sheets↔Postgres sync is not).
- Not building a native mobile app — mobile-first responsive web is sufficient.
- Not re-implementing Apps Script triggers/menus (`onOpen`, `menuProsesAbsensi`)
  — Excel ingestion becomes a normal authenticated admin upload feature.

---

## 4. New architecture

### 4.1 Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (LTS) + TypeScript | type safety across Models/Controllers |
| Web framework | Express.js | explicit MVC routing, no Google dependency |
| Views | EJS + Tailwind CSS | server-rendered, one file per page = literal MPA; Tailwind for fast mobile-first styling |
| Client-side interactivity | Alpine.js (small, per-page, no SPA router) | keeps modals/tabs/pagination snappy without adopting a full SPA framework |
| Database | Supabase Postgres | replaces Google Sheets; relational, queryable, RLS |
| ORM / query layer | Prisma (pointed at the Supabase Postgres connection string) | typed Models layer |
| Auth | Supabase Auth (email + password) for admin accounts | replaces the custom `authenticateAdminUser` sheet check |
| File storage | Supabase Storage (buckets: `klarifikasi-bukti`, `ekinerja-harian`, `ekinerja-bulanan`) | replaces Google Drive folders |
| Excel import | `xlsx` (SheetJS) parsed server-side on upload | replaces Apps Script Drive-triggered parsing |
| Validation | Zod | validate all form/API payloads |
| Deployment | Vercel or Railway (app) + Supabase Cloud (DB/Auth/Storage) | no Google infra anywhere |

### 4.2 MVC folder structure

```
/src
  /controllers
    dashboardController.ts
    absensiController.ts
    ekinerjaController.ts
    admin/
      authController.ts
      klarifikasiController.ts
      ekinerjaReviewController.ts
      cmsController.ts
      usersController.ts
  /models                      # Prisma-backed data access, one module per entity
    employeeModel.ts
    unitModel.ts
    attendanceModel.ts
    clarificationModel.ts
    ekinerjaModel.ts
    cmsModel.ts
    adminProfileModel.ts
  /services                    # cross-cutting logic that isn't pure data access
    excelImportService.ts       # replaces parseDaysFromTanggalStr/findDayColumns
    storageService.ts           # Supabase Storage upload/signed URL helpers
    statsService.ts             # dashboard aggregate calculations
  /views
    /partials (head.ejs, public-nav.ejs, admin-nav.ejs, footer.ejs, toast.ejs)
    dashboard.ejs               # menu: Dashboard Publik
    absensi.ejs                 # menu: Rekap Absensi
    ekinerja.ejs                # menu: Laporan E-Kinerja
    /admin
      login.ejs
      klarifikasi.ejs
      ekinerja-review.ejs
      cms.ejs
      users.ejs
  /routes
    publicRoutes.ts
    adminRoutes.ts
  /middleware
    requireAdmin.ts
    requireSuperAdmin.ts
  /lib
    prisma.ts
    supabaseClient.ts
/prisma
  schema.prisma
```

Each **menu = one route + one controller function + one view file** — this is
the literal MPA requirement (no client-side router, no single bundled
`index.html`).

### 4.3 Data model (Postgres / Prisma)

```
units (id, nama_unit)

employees (id, nip, nama, status_kepegawaian: PNS|PPPK|PPPK_PW|OUTSOURCING,
           unit_id -> units, aktif boolean)

attendance_periods (id, bulan, tahun, unique(bulan, tahun))

attendance_days (id, employee_id -> employees, period_id -> attendance_periods,
                 tanggal int, status: HADIR|ALPHA|DL|IZIN|SAKIT|CUTI,
                 keterangan text null, updated_at)
  -- replaces the "day-of-month = spreadsheet column" hack entirely;
  -- one row per employee per day, trivially queryable/aggregable.

clarifications (id, employee_id -> employees, tanggal_absen date,
                 status_awal text, status_pengganti text, alasan text,
                 file_url text, status_verifikasi: PENDING|APPROVED|REJECTED,
                 catatan_admin text null, reviewed_by -> admin_profiles null,
                 reviewed_at timestamptz null, created_at)

ekinerja_reports (id, employee_id -> employees, bulan, tahun,
                   file_harian_url text, file_bulanan_url text,
                   nilai_harian numeric null, nilai_bulanan numeric null,
                   status_review: PENDING|APPROVED|REJECTED,
                   catatan_admin text null, reviewed_by -> admin_profiles null,
                   reviewed_at timestamptz null, created_at)

cms_dashboard (id, hero_badge, hero_title, hero_subtitle, pengumuman_text,
               selected_month, selected_month_ekinerja, updated_at)
  -- single-row config table

admin_profiles (id -> auth.users.id, username, role: ADMIN|SUPER_ADMIN,
                is_active boolean)
  -- auth handled by Supabase Auth; this table only carries app-specific
  -- role/status, mirroring the old Admin sheet.
```

Row Level Security:
- `employees`, `attendance_days`, `attendance_periods`, `cms_dashboard`:
  public `SELECT` (anon) — the public dashboard/rekap must stay accessible
  without login, matching current `ANYONE_ANONYMOUS` behavior.
- `clarifications`, `ekinerja_reports`: public `INSERT` restricted to the
  submission columns only; `SELECT`/`UPDATE` of admin-only fields
  (`status_verifikasi`, `catatan_admin`, `nilai_*`) requires an authenticated
  `admin_profiles` row.
- `admin_profiles`: readable/writable only by `SUPER_ADMIN`.

### 4.4 Auth & roles

- Supabase Auth email/password for admin accounts (`Admin`, `Super Admin`).
- `middleware/requireAdmin.ts` and `requireSuperAdmin.ts` check the Supabase
  session + the `role`/`is_active` fields on `admin_profiles`, redirecting to
  `/admin/login` otherwise.
- No public-facing sign-up; admin accounts are created by a Super Admin from
  the Users page only.

### 4.5 What NOT to port literally

- `findDayColumns`, `parseDaysFromTanggalStr`, `isRedBg/isGreenBg/isBlueBg`,
  `extractDateInfoFromSource`: these all exist to reverse-engineer meaning out
  of unstructured spreadsheet cells/colors. With a normalized `attendance_days`
  table these become unnecessary for normal operation. They are only relevant
  in one place: the **Excel import service**, when an admin uploads a legacy
  daily attendance export and the system needs to figure out which date the
  file covers and which columns are which. Keep a **trimmed** version of the
  date-detection regexes there (filename + cell scan) but drop the
  color-based status detection — require the source Excel to encode status as
  text (e.g. `H`/`A`/`I`/`S`/`DL`) instead of cell background color.

---

## 5. Page-by-page spec (mobile-first)

| Route | View file | Mobile layout | Desktop layout |
|---|---|---|---|
| `GET /` | `dashboard.ejs` | stacked stat cards, unit filter as a select | stat cards in a 4-col grid |
| `GET /absensi` | `absensi.ejs` | one card per employee, days shown as a scrollable status list/badges | full day-1..31 grid table |
| `GET /ekinerja` | `ekinerja.ejs` | one card per employee w/ upload buttons | table with inline upload state |
| `GET /admin/login` | `admin/login.ejs` | centered single-column form | same, capped width |
| `GET /admin/klarifikasi` | `admin/klarifikasi.ejs` | stacked review cards + collapsible Excel-upload panel | table + upload panel side-by-side |
| `GET /admin/ekinerja-review` | `admin/ekinerja-review.ejs` | stacked review cards with score inputs | table with inline score inputs |
| `GET /admin/cms` (Super Admin) | `admin/cms.ejs` | single-column form | two-column form |
| `GET /admin/users` (Super Admin) | `admin/users.ejs` | stacked user cards + FAB to add | table + modal to add/edit |

All forms (klarifikasi submission, e-kinerja submission, CMS save, user CRUD)
post to controller actions that validate with Zod, write via the Models layer,
and re-render the page (or redirect) — no client-side SPA state management.

---

## 6. Ready-to-use IDE prompts

Paste these **in order** into your AI coding IDE (Antigravity, Cursor, etc.).
Each is self-contained and references the structure above. Run/verify each step
before moving to the next.

### Prompt 1 — Project scaffold

```
Scaffold a new Node.js + TypeScript project called "simpeg-cibitung" using
Express.js, EJS as the view engine, and Tailwind CSS. Set it up as a classic
MVC app with this exact folder structure:

/src
  /controllers
  /models
  /services
  /views
    /partials
    /admin
  /routes
  /middleware
  /lib
/prisma

Requirements:
- TypeScript strict mode, ts-node-dev for local dev, a `build`/`start` npm
  script for production.
- Express app in /src/app.ts, server entry in /src/server.ts.
- Tailwind configured mobile-first (default unprefixed utilities = mobile,
  use sm:/md:/lg: breakpoints for larger screens), output compiled to
  /public/css/styles.css, referenced from a shared /src/views/partials/head.ejs.
- Alpine.js included via CDN in head.ejs for lightweight per-page interactivity
  (no SPA router, no client-side page switching).
- A base layout convention: every view in /src/views includes
  partials/head.ejs, partials/public-nav.ejs OR partials/admin-nav.ejs, and
  partials/footer.ejs.
- .env.example with SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  DATABASE_URL (Prisma), SESSION_SECRET.
- Do not add any Google APIs, Google Sheets, or Google Drive dependencies
  anywhere in this project.
```

### Prompt 2 — Supabase schema, RLS, and Prisma models

```
Using the DATABASE_URL for a Supabase Postgres project, create a Prisma schema
at /prisma/schema.prisma with these models (use enums where noted):

- Unit(id, namaUnit)
- Employee(id, nip unique, nama, statusKepegawaian enum[PNS, PPPK, PPPK_PW,
  OUTSOURCING], unitId -> Unit, aktif boolean default true)
- AttendancePeriod(id, bulan, tahun, unique on [bulan, tahun])
- AttendanceDay(id, employeeId -> Employee, periodId -> AttendancePeriod,
  tanggal Int, status enum[HADIR, ALPHA, DL, IZIN, SAKIT, CUTI],
  keterangan String?, updatedAt)
- Clarification(id, employeeId -> Employee, tanggalAbsen DateTime,
  statusAwal String, statusPengganti String, alasan String, fileUrl String,
  statusVerifikasi enum[PENDING, APPROVED, REJECTED] default PENDING,
  catatanAdmin String?, reviewedBy String?, reviewedAt DateTime?, createdAt)
- EkinerjaReport(id, employeeId -> Employee, bulan, tahun, fileHarianUrl,
  fileBulananUrl, nilaiHarian Decimal?, nilaiBulanan Decimal?,
  statusReview enum[PENDING, APPROVED, REJECTED] default PENDING,
  catatanAdmin String?, reviewedBy String?, reviewedAt DateTime?, createdAt)
- CmsDashboard(id, heroBadge, heroTitle, heroSubtitle, pengumumanText,
  selectedMonth, selectedMonthEkinerja, updatedAt) — this table will only
  ever hold a single row.
- AdminProfile(id String @id  -- matches Supabase auth.users.id, username,
  role enum[ADMIN, SUPER_ADMIN], isActive Boolean default true)

Then generate a separate raw SQL migration file (for the Supabase SQL editor)
that:
1. Enables Row Level Security on Employee, AttendanceDay, AttendancePeriod,
   CmsDashboard, Clarification, EkinerjaReport, AdminProfile.
2. Adds a public SELECT policy (role = anon, authenticated) on Employee,
   AttendanceDay, AttendancePeriod, CmsDashboard.
3. Adds a public INSERT policy on Clarification and EkinerjaReport limited to
   the submission columns (employeeId, tanggalAbsen/bulan/tahun, alasan,
   fileUrl/fileHarianUrl/fileBulananUrl) — status/review/nilai columns must
   default and not be settable by anon inserts.
4. Adds SELECT/UPDATE policies on Clarification and EkinerjaReport restricted
   to rows where the requester has a matching AdminProfile with isActive =
   true.
5. Restricts AdminProfile SELECT/INSERT/UPDATE/DELETE to requesters whose own
   AdminProfile.role = SUPER_ADMIN.

Also create three Supabase Storage buckets via SQL/API: `klarifikasi-bukti`,
`ekinerja-harian`, `ekinerja-bulanan`, all private, with a storage policy that
only allows authenticated admin uploads/reads and anon-insert-only for the
public submission flows (clarification/e-kinerja upload), mirroring the table
RLS above.
```

### Prompt 3 — Models layer

```
In /src/lib/prisma.ts, export a singleton PrismaClient. In /src/models/, create
one module per entity (employeeModel.ts, unitModel.ts, attendanceModel.ts,
clarificationModel.ts, ekinerjaModel.ts, cmsModel.ts, adminProfileModel.ts).
Each module only contains typed data-access functions built on the Prisma
client — no Express req/res objects, no view logic. At minimum implement:

- employeeModel: listByUnit(unitId?), findByNip(nip)
- attendanceModel: getMonthlyRecap(bulan, tahun, unitId?, search?) returning,
  per employee, an array of {tanggal, status, keterangan} for that month;
  upsertDay(employeeId, periodId, tanggal, status, keterangan)
- clarificationModel: create(data), listPending(), approve(id, catatanAdmin,
  reviewedBy), reject(id, catatanAdmin, reviewedBy)
- ekinerjaModel: create(data), listPending(), review(id, nilaiHarian,
  nilaiBulanan, statusReview, catatanAdmin, reviewedBy)
- cmsModel: get(), update(data)
- adminProfileModel: findById(id), list(), create(data), update(id, data),
  setActive(id, isActive), delete(id)

Also implement /src/services/statsService.ts with a getDashboardStats(unitId?)
function that computes totalPegawai, persenKehadiran, and counts per
statusKepegawaian directly from the Employee/AttendanceDay tables (replacing
the old getDashboardStats sheet-scanning logic) using Prisma aggregate/count
queries.
```

### Prompt 4 — Auth

```
Set up Supabase Auth in /src/lib/supabaseClient.ts (one client with the anon
key for session verification, one admin client with the service role key for
server-side privileged operations like creating admin users).

Implement /src/controllers/admin/authController.ts with:
- showLogin (renders views/admin/login.ejs)
- login (verifies credentials via Supabase Auth signInWithPassword, loads the
  matching AdminProfile, rejects if isActive is false, stores the session in
  an httpOnly cookie, redirects to /admin/klarifikasi)
- logout (clears the session, redirects to /admin/login)

Implement /src/middleware/requireAdmin.ts (redirects to /admin/login if no
valid session/AdminProfile) and /src/middleware/requireSuperAdmin.ts (same,
plus role check, else renders a 403 page). Wire these into
/src/routes/adminRoutes.ts so every /admin/* route except /admin/login is
protected, and /admin/cms + /admin/users additionally require Super Admin.
```

### Prompt 5 — Public pages (mobile-first)

```
Build the three public menus as fully separate pages (no SPA, no shared
client-side state):

1. GET / -> dashboardController.show -> views/dashboard.ejs
   Calls statsService.getDashboardStats and cmsModel.get(). Mobile: stat cards
   stacked full-width with large numbers; unit-kerja filter as a native
   <select> that submits via GET query param and re-renders server-side.
   Desktop (md: breakpoint up): 4-column stat grid.

2. GET /absensi -> absensiController.show -> views/absensi.ejs
   Calls attendanceModel.getMonthlyRecap with query params for bulan/tahun,
   unit, and search. Mobile: one collapsible card per employee showing a
   horizontally scrollable strip of day badges (color-coded by status).
   Desktop: a full table with one column per day 1-31, sticky first column
   (employee name). Include a "Klarifikasi" button per employee/day that opens
   an Alpine.js modal (no page reload) posting to
   POST /absensi/klarifikasi (multipart form: employeeId, tanggalAbsen,
   statusPengganti, alasan, file). Handle the file upload with multer into a
   temp buffer, then storageService uploads it to the `klarifikasi-bukti`
   Supabase bucket and clarificationModel.create() stores the returned URL.

3. GET /ekinerja -> ekinerjaController.show -> views/ekinerja.ejs
   Similar mobile-card / desktop-table split. Each employee row has an
   "Upload Laporan" action opening a modal requiring two PDF files (harian +
   bulanan), disabled if that employee already has a PENDING or APPROVED
   report for the selected month (reuse the old canUploadEKinerja rule: block
   if pending or approved). Submits to POST /ekinerja/submit, uploads both
   files via storageService to their respective buckets, then
   ekinerjaModel.create().

All three pages must render correctly down to a 360px viewport: no horizontal
overflow outside the intentionally scrollable table/day-strip regions, tap
targets at least 40px tall.
```

### Prompt 6 — Admin: klarifikasi review + Excel import

```
Build views/admin/klarifikasi.ejs + adminKlarifikasiController.ts:

- Top section: list of PENDING clarifications from clarificationModel.listPending(),
  each showing employee, tanggal, alasan, a link/preview to the uploaded PDF
  (signed URL from Supabase Storage), and Approve/Reject buttons that post to
  POST /admin/klarifikasi/:id/approve and /:id/reject with an optional
  catatanAdmin textarea. Mobile: stacked cards. Desktop: table.

- Below that, an "Import Rekap Absensi Harian" panel: a file input (accept
  .xlsx/.xls, multiple) posting to POST /admin/klarifikasi/import.

Implement /src/services/excelImportService.ts using the `xlsx` package:
1. For each uploaded file, parse it with SheetJS.
2. Detect the date the file covers using this priority order: (a) filename
   patterns like "14 Juli 2026", "DATA PER-14 JULI 2026", "14-07-2026",
   "2026-07-14"; (b) scan the first ~25 rows for a Date cell or a matching
   text pattern. Implement this as plain regex functions ported (simplified,
   Indonesian month names) from the legacy extractDateInfoFromSource logic —
   drop the color-detection branches entirely.
3. Detect which column holds each day 1-31 by scanning the first ~20 rows for
   a row containing many sequential integers in range 1-31 (port
   findDayColumns's row-scanning logic, dropping the hardcoded fallback
   offsets in favor of returning a clear error if no such header row is
   found).
4. Require each day's cell value to be one of HADIR/ALPHA/DL/IZIN/SAKIT/CUTI
   (or short codes H/A/DL/I/S/C mapped to those) as plain text — do not
   attempt to infer status from cell background color.
5. Upsert into AttendancePeriod + AttendanceDay via attendanceModel.upsertDay
   for every employee row matched by NIP.
6. Return a summary {filesProcessed, rowsUpserted, errors[]} that the
   controller flashes back to the admin as a toast/notice on page reload.
```

### Prompt 7 — Admin: e-kinerja review, CMS, and user management

```
Build these three Super-Admin/Admin pages:

1. views/admin/ekinerja-review.ejs + adminEkinerjaController.ts: list PENDING
   reports from ekinerjaModel.listPending(), show links to both uploaded PDFs
   (signed URLs), inputs for nilaiHarian/nilaiBulanan, Approve/Reject buttons
   posting to POST /admin/ekinerja-review/:id/review with the scores and an
   optional catatanAdmin. Mobile: stacked cards with inline number inputs.
   Desktop: table.

2. views/admin/cms.ejs + adminCmsController.ts (Super Admin only): a single
   form bound to cmsModel.get() with fields heroBadge, heroTitle,
   heroSubtitle, pengumumanText, selectedMonth, selectedMonthEkinerja (month
   dropdowns), posting to POST /admin/cms with Zod validation, saving via
   cmsModel.update(). Show a success toast and the previous saved values
   pre-filled.

3. views/admin/users.ejs + adminUsersController.ts (Super Admin only): list
   all AdminProfiles with role and active/inactive status. "Add admin" opens
   a form (username, email, password, role) that: creates a Supabase Auth user
   via the service-role client, then creates the matching AdminProfile row.
   Include Edit (change role/username) and a Deactivate/Activate toggle
   (adminProfileModel.setActive) instead of hard delete where possible;
   support hard delete too, calling both Supabase Auth admin.deleteUser and
   adminProfileModel.delete(). Mobile: stacked cards with an "Add admin"
   floating action button opening an Alpine.js modal. Desktop: table + modal.
```

### Prompt 8 — Deployment

```
Prepare this project for deployment:
1. Add a production build script that compiles TypeScript to /dist and
   compiles Tailwind to /public/css/styles.css (minified).
2. Add a vercel.json (or Railway/Render config, whichever host is chosen)
   routing all requests to the compiled Express server, keeping
   /public assets static.
3. Document required environment variables (SUPABASE_URL,
   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, SESSION_SECRET)
   in a DEPLOYMENT.md, including how to run `npx prisma migrate deploy`
   against the Supabase Postgres instance as part of the deploy step.
4. Confirm no code path references Google APIs, Google Sheets, Google Drive,
   or any Apps Script-specific globals (SpreadsheetApp, DriveApp, Utilities,
   Logger) — grep the codebase for these identifiers and remove any that
   remain.
```

---

## 7. Open questions to confirm before/while building

- Exact list of `unit_kerja` (school units) and their names — needed to seed
  the `units` table (not present in the uploaded files; likely lives in a
  `Pegawai`/employee sheet not provided).
- Whether historical attendance/clarification/e-kinerja data needs a one-time
  migration from the existing Google Sheets, and if so, export those sheets to
  CSV for an import script.
- Final list of attendance status codes to standardize on (the reference site
  implies at least Hadir, Alpha/TK, Dinas Luar, and a colored "Kuning"
  variant — confirm the definitive status enum before writing the Prisma
  schema in Prompt 2).
