# Storage Migration Runbook

This document describes how to migrate Bubble's media files from the local
filesystem (default) to S3-compatible object storage, and how to operate both
backends going forward.

## Background

By default Bubble stores uploaded media (item images, profile pictures) on the
local filesystem at `bubble/media/`.  This works fine for single-server
setups, but has limitations for federation:

- Image URLs embedded in ActivityPub objects must be publicly reachable from
  other instances.  A `localhost`-relative URL is useless to a remote server.
- Multiple backend/worker pods cannot share a local filesystem PVC with
  `ReadWriteOnce` access mode.
- Scaling horizontally requires all pods to see the same files.

S3-compatible storage solves all three problems.  Bubble supports **any**
S3-compatible provider via `django-storages`:

| Provider | Notes |
|---|---|
| **MinIO** (in-cluster) | Easiest for self-hosting; optional Helm subchart |
| **AWS S3** | Native; set `S3_ADDRESSING_STYLE=auto`, omit `S3_ENDPOINT_URL` |
| **Cloudflare R2** | No egress fees; set `S3_ADDRESSING_STYLE=path` |
| **Backblaze B2** | Cost-effective; use B2's S3-compatible endpoint |
| **Hetzner Object Storage** | EU-hosted; S3-compatible endpoint |

---

## Environment variables

| Variable | Required for S3 | Default | Description |
|---|---|---|---|
| `STORAGE_BACKEND` | — | `local` | `local` or `s3` |
| `S3_ACCESS_KEY` | ✅ | — | Access key ID |
| `S3_SECRET_KEY` | ✅ | — | Secret access key |
| `S3_BUCKET` | ✅ | — | Bucket name |
| `S3_ENDPOINT_URL` | for non-AWS | — | Override endpoint (MinIO, R2, …) |
| `S3_CUSTOM_DOMAIN` | optional | — | CDN / public domain (`cdn.example.com/bucket`) |
| `S3_MEDIA_PREFIX` | optional | `media` | Key prefix inside the bucket |
| `S3_USE_SSL` | optional | `true` | Use HTTPS for S3 API calls |
| `S3_ADDRESSING_STYLE` | optional | `path` | `path` (MinIO/R2) or `auto` (AWS S3) |
| `S3_SIGNATURE_VERSION` | optional | `s3v4` | Signature version |

---

## Local development with MinIO

The `compose.yaml` includes an optional MinIO service under the `minio`
profile.

```bash
# Start all services including MinIO
docker compose --profile minio up -d

# Add to backend/.env-docker.local:
STORAGE_BACKEND=s3
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=bubble
S3_ENDPOINT_URL=http://minio:9000
# Public URL that your browser can reach:
S3_CUSTOM_DOMAIN=localhost:9000/bubble
S3_USE_SSL=false
```

MinIO console: http://localhost:9001 (user: `minioadmin` / `minioadmin`)

The `minio-init` container creates the `bubble` bucket automatically on first
start and sets it to anonymous-read so media URLs are publicly accessible
without presigned tokens.

---

## Kubernetes with the MinIO subchart

Enable MinIO in your `values.yaml` override:

```yaml
minio:
  enabled: true
  rootUser: "your-access-key"
  rootPassword: "your-secret-key"  # or use existingSecret
  defaultBucket: "bubble"
  persistence:
    size: 20Gi
  # Optional: expose via ingress for public access
  customDomain: "media.yourdomain.example"

# Disable the local media PVC (no longer needed)
backend:
  persistence:
    media:
      enabled: false
```

When `minio.enabled=true`, the Helm chart automatically sets `STORAGE_BACKEND=s3`
and injects all S3 credentials into the backend and worker pods.

---

## Migrating existing media from local FS to S3

> **Before you start:** take a snapshot of the media PVC and a Postgres backup.

### Step 1 — Install `mc` (MinIO Client)

```bash
# macOS
brew install minio/stable/mc

# Linux
curl -O https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc && sudo mv mc /usr/local/bin/
```

### Step 2 — Copy files from the existing PVC

If running on Kubernetes, exec into the backend pod (which still has the media
PVC mounted at `/app/bubble/media`) and use `mc` or `aws s3 cp`:

```bash
kubectl exec -it deploy/<release>-backend -- bash

# Inside the pod — copy to MinIO (adjust endpoint/credentials):
mc alias set myminio http://<release>-minio:9000 <access-key> <secret-key>
mc mirror /app/bubble/media myminio/bubble/media/
```

For AWS S3:

```bash
aws s3 sync /app/bubble/media s3://your-bucket/media/ \
  --endpoint-url https://... \   # omit for native AWS
  --acl public-read
```

### Step 3 — Verify URLs resolve

Pick a few image paths from the database and confirm they load from the new
storage URL:

```bash
# Get a sample image path
kubectl exec -it deploy/<release>-backend -- python manage.py shell -c \
  "from bubble.items.models import Image; print(Image.objects.first().thumbnail.url)"
```

The URL should now start with `https://` (S3 endpoint or CDN).

### Step 4 — Switch storage backend

Set `STORAGE_BACKEND=s3` (and the other `S3_*` vars) in your deployment, then
perform a rolling restart:

```bash
helm upgrade <release> ./helm -f your-overrides.yaml
```

### Step 5 — Remove the old media PVC (optional)

Once you've confirmed new uploads go to S3 and old images resolve, you can
disable the media PVC:

```yaml
backend:
  persistence:
    media:
      enabled: false
```

---

## Rollback

If you need to revert to local storage:

1. Set `STORAGE_BACKEND=local` and remove the `S3_*` vars.
2. Re-enable the media PVC.
3. Copy files back from S3 to the PVC (reverse of step 2 above).
4. Rolling restart.

---

## Security notes

- Set bucket ACL to **public-read** only for the `media/` prefix.  Never
  make the entire bucket public.
- Use **pre-signed URLs** (configure `AWS_QUERYSTRING_AUTH=True` in Django
  settings) if you need access-controlled media — at the cost of URL
  stability for federation (pre-signed URLs expire).  For federation, keep
  media public or proxy via a CDN with token auth at the edge.
- Rotate `S3_ACCESS_KEY` / `S3_SECRET_KEY` regularly; prefer IAM roles with
  minimal permissions (s3:GetObject, s3:PutObject, s3:DeleteObject on the
  bucket only) over root credentials.
- Store credentials in Kubernetes Secrets or your secret manager — never in
  `values.yaml` committed to git.  Use `minio.existingSecret` or
  `externalS3.existingSecret` to reference them.
