# Client Portal & Project Management Hub

A white-label client portal for agencies, freelancers and law firms. Files, milestone approvals,
messages and invoices all live in one branded place, so nobody has to chase clients over email.

| | |
|---|---|
| **File sharing** | Drag-and-drop multi-file uploads that go **straight to AWS S3 / Cloudflare R2** via presigned URLs. You get per-file progress, previews, downloads through signed links that expire after 5 minutes, and attachments on tasks and milestones. |
| **Milestone approvals** | Timeline of deliverables. Staff submit a milestone for approval, and the client **approves** or **requests changes** with a note. Everyone is notified instantly. |
| **Real-time messaging** | Project discussion plus a comment thread on every task, delivered over **WebSockets (Socket.IO)**, with a typing indicator, editing and deleting, and live notifications with a toast and a bell. |
| **Invoices & payments** | Line-item invoices with draft → send → paid states, and **one-click Stripe Checkout** for clients. Payment is confirmed by both a webhook and a check on return. Offline payments can be recorded manually, and invoices print to PDF. |
| **White-label** | Each agency sets its name, logo and brand color, which appear across the whole UI, on invoices and on a **branded sign-in page** (`/login?org=<slug>`). |
| **Projects & tasks** | Kanban board with drag-and-drop, assignees and due dates. **Internal tasks** are fully hidden from clients, including their comments and files. |
| **Roles** | Owner / Admin / Member (agency staff) and Client users, who only see their own company's projects and sent invoices. |

---

## Quick start (local)

Requirements: **Node 20+** and **Docker**.

```bash
npm install                       # installs server + client workspaces
npm run infra:up                  # starts Postgres (port 5433) + MinIO S3 storage (port 9010)
cp server/.env.example server/.env
#   then set JWT_SECRET in server/.env   (openssl rand -hex 32)
npm run db:migrate                # creates the database schema
npm run db:seed                   # optional: demo workspace with sample data
npm run dev                       # API on :4000, web app on http://localhost:5173
```

Demo accounts (after `db:seed`, password `password123` for all):

| Email | Role |
|---|---|
| `owner@demo.test` | Agency owner |
| `sam@demo.test` | Team member |
| `client@acme.test` | Client (Acme Corp) |
| `maria@globex.test` | Client (Globex Inc) |

Open two browsers (e.g. a normal and a private window), sign in as the owner in one and the client in
the other, and watch messages, uploads and approvals appear live.

> The MinIO console is at http://localhost:9011 (user `portal-minio`, password `portal-minio-secret`).

---

## Configuration

All settings live in `server/.env` (see `server/.env.example` for every option).

### File storage: AWS S3, Cloudflare R2 or local disk

The browser uploads directly to the bucket using short-lived presigned `PUT` URLs. The API then
verifies the object exists before publishing it. Downloads use presigned `GET` URLs that expire after 5 minutes.

**AWS S3**
```env
STORAGE_DRIVER=s3
S3_BUCKET=my-portal-files
S3_REGION=eu-west-1
S3_ENDPOINT=
S3_ACCESS_KEY_ID=AKIA...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
S3_AUTO_CREATE_BUCKET=false
```

**Cloudflare R2**
```env
STORAGE_DRIVER=s3
S3_BUCKET=my-portal-files
S3_REGION=auto
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=...            # R2 API token (Object Read & Write)
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=true
S3_AUTO_CREATE_BUCKET=false
```

**Bucket CORS (required for S3 and R2)**: browsers upload directly to the bucket, so allow your app's origin.
The server tries to set this automatically on startup. If your key lacks permission, add it yourself:

```json
[
  {
    "AllowedOrigins": ["https://portal.youragency.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
(R2: *Bucket → Settings → CORS Policy*. S3: *Bucket → Permissions → CORS*.)

**No cloud at all?** Set `STORAGE_DRIVER=local`. Files are stored in `server/uploads/` using the same
signed-URL flow, so nothing else changes.

### Stripe payments

1. Get test keys at https://dashboard.stripe.com/test/apikeys and set `STRIPE_SECRET_KEY=sk_test_...`.
2. Webhooks (recommended):
   - **Local:** `stripe listen --forward-to localhost:4000/api/webhooks/stripe`, then copy the `whsec_...` it prints into `STRIPE_WEBHOOK_SECRET`.
   - **Production:** add an endpoint at `https://<your-domain>/api/webhooks/stripe` for the events
     `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
3. Restart the server. Clients now see a **Pay** button on open invoices. Test card: `4242 4242 4242 4242`.

Payments are confirmed in two ways that don't depend on each other: the signed webhook, and a server-side session
check when the customer returns from Checkout. So payments still register even if the webhook isn't set up
yet. Marking an invoice paid is idempotent.

Without Stripe keys the app still works: the Pay button explains that online payments aren't enabled,
and admins can use **Mark paid** for bank transfers.

### Email (optional)

Set `SMTP_URL` (e.g. `smtp://user:pass@smtp.mailgun.org:587`) and `EMAIL_FROM` to email invitations and
new invoices. Without it, invitation links are shown in the UI to copy and share.

---

## Testing

The test suites run against a running server (`npm run dev`):

```bash
npm run test:e2e                      # 94 API checks: auth, tenancy isolation, permissions,
                                      # WebSocket delivery, presigned uploads, approvals, invoices
STRIPE_WEBHOOK_SECRET=whsec_x npm run test:stripe -w server
                                      # signed-webhook → invoice paid (server must use the same secret)
npm run typecheck
```

---

## Production deployment

**Docker** (single container: API + web app):

```bash
docker build -t client-portal .
docker run -p 4000:4000 --env-file server/.env \
  -e APP_URL=https://portal.youragency.com client-portal
```
The container runs `prisma migrate deploy` on start. You need a PostgreSQL database and an S3/R2 bucket.

**Without Docker**

```bash
npm ci
npm run build
cd server && npx prisma migrate deploy && NODE_ENV=production node dist/index.js
```

In production the API serves the built React app from `client/dist`, so you deploy one process on one port.
Put it behind HTTPS (any reverse proxy or platform load balancer) with WebSocket upgrades enabled, and
set `APP_URL` to the public `https://` URL. Secure cookies and strict CSP switch on automatically.

---

## Architecture

```
client/  React 19 + Vite + Tailwind 4 + TanStack Query + socket.io-client
  src/pages/          Dashboard, Projects, ProjectDetail, Clients, Invoices, Team, Settings, Auth
  src/components/     UI kit, layout, project/ (Milestones, Tasks board + drawer, Files, Thread)
  src/lib/            api client, realtime hooks, uploader, formatters

server/  Express 5 + TypeScript + Prisma (PostgreSQL) + Socket.IO + AWS SDK v3 + Stripe
  prisma/schema.prisma   data model (organizations, users, clients, projects, milestones,
                         tasks, comments, files, invoices, notifications, activity)
  src/lib/storage.ts     S3/R2/MinIO + local drivers behind one interface
  src/lib/realtime.ts    Socket.IO rooms: user:<id>, project:<id>:all, project:<id>:staff
  src/lib/access.ts      every query is scoped by organization and client
  src/routes/            REST endpoints
```

**Security**
- httpOnly session cookies (JWT, 14 days) and bcrypt password hashing.
- CSRF protection (a custom-header requirement on writes) and rate-limited auth endpoints.
- Helmet with strict CSP in production.
- Every query is scoped to the user's organization, and for clients to their own company.
- Internal tasks, plus their comments and files, never reach client sockets or API responses.
- Invitation tokens are stored hashed and work only once.
- Uploaded files are served as downloads, and inline preview is limited to safe types. Removed users are deactivated, not deleted, so history stays intact.
