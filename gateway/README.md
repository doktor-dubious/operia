# Operia SFTP gateway (SFTPGo)

Runs on **ftp.predictioninstitute.com** (AWS). It is a **stateless protocol
gateway**: it speaks SFTP to customers and streams uploads straight into
**Supabase Storage** over the S3 API. Nothing durable is stored on this box.

**Operia is the source of truth for logins.** SFTPGo does not store users; on each
login it calls the `sftp-auth` Edge Function, which verifies the username +
password (bcrypt) against `company_data_transfer_secret` and returns an S3-backed
user chrooted to `imports/{company_id}/`. After every successful upload SFTPGo
calls `sftp-uploaded`, which records the file in `inbound_files` and the audit log
(visible in **Operia → Logs**, action `data_transfer.received`).

```
customer ──SFTP──▶ SFTPGo (this box) ──S3──▶ Supabase Storage (bucket "imports")
                       │  login?  ▲                 imports/{company_id}/file.csv
                       ▼  sftp-auth │
                   Operia Edge Functions ──▶ inbound_files + audit log
                       ▲  sftp-uploaded
```

## One-time setup

### 1. Supabase edge secrets
Already set: `SFTP_S3_KEY_ID`, `SFTP_S3_SECRET` (Storage S3 access key). Add the
shared hook token (must match `gateway/.env`):

```bash
supabase secrets set SFTP_HOOK_SECRET='<same long random string as in gateway/.env>'
```

Optional overrides (sensible defaults are baked into `sftp-auth`):
`SFTP_S3_BUCKET` (default `imports`), `SFTP_S3_REGION` (default `eu-north-1`),
`SFTP_S3_ENDPOINT` (default `<SUPABASE_URL>/storage/v1/s3`).

The two functions are already deployed **with `--no-verify-jwt`** (SFTPGo sends no
Supabase JWT). They are guarded by `SFTP_HOOK_SECRET`, sent as the
`X-Operia-Hook-Secret` **header** (configured via `SFTPGO_HTTPCLIENT__HEADERS__*`
in `docker-compose.yml`); the legacy `?token=` query param is still accepted and
kept in the hook URLs as fallback — remove it once the header is verified in
production (query strings can leak via access logs/proxies).

### 2. DNS + firewall
- `ftp.predictioninstitute.com` → an **A record** to this box's public IP.
- The gateway listens on **TCP 2222** (port 22 is taken by the OS `sshd` / the
  existing SFTP for other clients). Open **2222** in the AWS security group, tell
  customers the port, and set the Operia address to
  **`ftp.predictioninstitute.com:2222`** (Operia → Data Transfer).

### 3. Start the gateway
```bash
cp .env.example .env      # then fill in SFTP_HOOK_SECRET + admin password
chmod 600 .env            # NIS2: hook secret + admin password must not be world-readable
docker compose up -d
docker compose logs -f    # watch the first login/upload
```

## Test (DCA Demo A/S, user `daniel`)

```bash
sftp -P 2222 daniel@ftp.predictioninstitute.com   # or daniel@localhost when testing on the box
# password = the one set on Operia → Customers → DCA Demo A/S → Data Transfer
put employees.csv
```

Then verify:
1. **Supabase Storage** → bucket `imports` → `imports/<DCA-Demo-company-id>/employees.csv`.
2. **Operia → Logs** → a `data_transfer.received` entry for DCA Demo A/S.
3. `select * from inbound_files order by received_at desc;` shows the row.

## Notes & caveats
- **Supabase S3 compatibility** is the one thing to actually verify here. If uploads
  fail against the S3 endpoint, the fallback is to switch SFTPGo to a **local**
  filesystem backend and have `sftp-uploaded` pull the file into Storage via the
  normal Storage API — same end state, one extra hop. (Ask and I'll wire it.)
- **Host key + sqlite**: persisted in the **named volume `sftpgo_data`** (mounted at
  `/var/lib/sftpgo`), so the fingerprint is stable across restarts. A *bind*-mount
  here fails — it's root-owned and SFTPGo (uid 1000) can't write its DB; the named
  volume inherits the image path's ownership. Don't delete the volume.
- **Admin UI** is bound to `127.0.0.1:8080`; reach it via an SSH tunnel
  (`ssh -L 8080:127.0.0.1:8080 <box>`). You shouldn't need it — users are external.
- **Auto-import**: this delivers transport only. Parsing the CSV and running the
  Flow 0 upsert (currently client-side) is the next step; `inbound_files.status`
  and `import_run_id` are already there to link a run.
- Keep `.env` and `sftpgo-data/` **out of git** (secrets + host keys).
