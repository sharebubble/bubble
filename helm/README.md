# Bubble Helm Chart

A Helm chart for deploying the Bubble Community Network application to Kubernetes.

## Prerequisites

- Kubernetes 1.23+
- Helm 3.8+
- PV provisioner support in the underlying infrastructure (for persistence)

## Installing the Chart

```bash
# Add your values file
helm install bubble ./helm -f my-values.yaml

# Or with inline values
helm install bubble ./helm \
  --set backend.secrets.secretKey="your-secret-key" \
  --set postgresql.auth.password="db-password" \
  --set postgresql.auth.postgresPassword="postgres-password"
```

## Configuration

### Global Settings

| Parameter                 | Description                               | Default |
| ------------------------- | ----------------------------------------- | ------- |
| `global.imagePullSecrets` | Image pull secrets for private registries | `[]`    |
| `global.storageClass`     | Default storage class for PVCs            | `""`    |

### Frontend

| Parameter                   | Description                 | Default                                                        |
| --------------------------- | --------------------------- | -------------------------------------------------------------- |
| `frontend.enabled`          | Enable frontend deployment  | `true`                                                         |
| `frontend.replicaCount`     | Number of frontend replicas | `1`                                                            |
| `frontend.image.repository` | Frontend image repository   | `ghcr.io/treibhausdonaufeld/bubble-frontend`                   |
| `frontend.image.tag`        | Frontend image tag          | `latest`                                                       |
| `frontend.ingress.enabled`  | Enable ingress for frontend | `true`                                                         |
| `frontend.ingress.hosts`    | Ingress hosts configuration | `[{host: bubble.local, paths: [{path: /, pathType: Prefix}]}]` |

### Backend

| Parameter                       | Description                  | Default                                     |
| ------------------------------- | ---------------------------- | ------------------------------------------- |
| `backend.enabled`               | Enable backend deployment    | `true`                                      |
| `backend.replicaCount`          | Number of backend replicas   | `1`                                         |
| `backend.image.repository`      | Backend image repository     | `ghcr.io/treibhausdonaufeld/bubble-backend` |
| `backend.image.tag`             | Backend image tag            | `latest`                                    |
| `backend.django.settingsModule` | Django settings module       | `config.settings.production`                |
| `backend.django.allowedHosts`   | Django allowed hosts         | `localhost`                                 |
| `backend.secrets.secretKey`     | Django secret key (required) | `""`                                        |

### Celery Worker

| Parameter                    | Description                     | Default |
| ---------------------------- | ------------------------------- | ------- |
| `worker.enabled`             | Enable Celery worker deployment | `true`  |
| `worker.replicaCount`        | Number of worker replicas       | `1`     |
| `worker.autoscaling.enabled` | Enable HPA for workers          | `false` |

### Celery Beat

| Parameter      | Description                   | Default |
| -------------- | ----------------------------- | ------- |
| `beat.enabled` | Enable Celery beat deployment | `true`  |

### PostgreSQL (Internal)

| Parameter                        | Description                  | Default             |
| -------------------------------- | ---------------------------- | ------------------- |
| `postgresql.enabled`             | Use internal PostgreSQL      | `true`              |
| `postgresql.image.repository`    | PostgreSQL image             | `pgvector/pgvector` |
| `postgresql.image.tag`           | PostgreSQL image tag         | `pg17`              |
| `postgresql.auth.database`       | Database name                | `bubble`            |
| `postgresql.auth.username`       | Database username            | `bubble`            |
| `postgresql.auth.password`       | Database password (required) | `""`                |
| `postgresql.persistence.enabled` | Enable persistence           | `true`              |
| `postgresql.persistence.size`    | PVC size                     | `10Gi`              |

### External PostgreSQL

Use these settings when `postgresql.enabled=false`:

| Parameter                           | Description                      | Default  |
| ----------------------------------- | -------------------------------- | -------- |
| `externalPostgresql.host`           | External PostgreSQL host         | `""`     |
| `externalPostgresql.port`           | External PostgreSQL port         | `5432`   |
| `externalPostgresql.database`       | Database name                    | `bubble` |
| `externalPostgresql.username`       | Database username                | `bubble` |
| `externalPostgresql.password`       | Database password                | `""`     |
| `externalPostgresql.existingSecret` | Use existing secret for password | `""`     |

### Redis (Internal - DragonflyDB)

| Parameter                | Description                      | Default                         |
| ------------------------ | -------------------------------- | ------------------------------- |
| `redis.enabled`          | Use internal Redis (DragonflyDB) | `true`                          |
| `redis.image.repository` | Redis image                      | `ghcr.io/dragonflydb/dragonfly` |
| `redis.image.tag`        | Redis image tag                  | `latest`                        |

### External Redis

Use these settings when `redis.enabled=false`:

| Parameter                      | Description                      | Default |
| ------------------------------ | -------------------------------- | ------- |
| `externalRedis.host`           | External Redis host              | `""`    |
| `externalRedis.port`           | External Redis port              | `6379`  |
| `externalRedis.password`       | Redis password                   | `""`    |
| `externalRedis.db`             | Redis database number            | `0`     |
| `externalRedis.existingSecret` | Use existing secret for password | `""`    |

## Examples

### Minimal Production Setup

```yaml
# values-production.yaml
frontend:
  ingress:
    enabled: true
    className: nginx
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    hosts:
      - host: bubble.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: bubble-tls
        hosts:
          - bubble.example.com

backend:
  django:
    allowedHosts: 'bubble.example.com'
  secrets:
    secretKey: 'your-very-secret-key-here'

postgresql:
  auth:
    password: 'secure-db-password'
    postgresPassword: 'secure-postgres-password'
```

### Using External PostgreSQL and Redis

```yaml
# values-external.yaml
postgresql:
  enabled: false

externalPostgresql:
  host: 'my-postgres.example.com'
  port: 5432
  database: bubble
  username: bubble
  existingSecret: my-postgres-secret
  existingSecretPasswordKey: password

redis:
  enabled: false

externalRedis:
  host: 'my-redis.example.com'
  port: 6379
  password: ''
  db: 0
```

## Upgrading

```bash
helm upgrade bubble ./helm -f my-values.yaml
```

## Uninstalling

```bash
helm uninstall bubble
```

Note: PVCs are not deleted by default. To delete them:

```bash
kubectl delete pvc -l app.kubernetes.io/instance=bubble
```
