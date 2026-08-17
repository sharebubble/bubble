{{/*
Expand the name of the chart.
*/}}
{{- define "bubble.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "bubble.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "bubble.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "bubble.labels" -}}
helm.sh/chart: {{ include "bubble.chart" . }}
{{ include "bubble.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "bubble.selectorLabels" -}}
app.kubernetes.io/name: {{ include "bubble.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "bubble.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "bubble.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Frontend fullname
*/}}
{{- define "bubble.frontend.fullname" -}}
{{- printf "%s-frontend" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Frontend Gateway fullname
*/}}
{{- define "bubble.frontend.gateway.fullname" -}}
{{- printf "%s-frontend-gateway" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}


{{/*
Backend fullname
*/}}
{{- define "bubble.backend.fullname" -}}
{{- printf "%s-backend" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Backend Django secret — when backend.secrets.existingSecret is set, render a
secretKeyRef env entry for DJANGO_SECRET_KEY pointing at the external Secret.
Renders nothing when existingSecret is empty (the chart generates its own
Secret loaded via envFrom in that case). Usage:
  {{- include "bubble.backend.djangoSecretEnv" . | nindent 12 }}
*/}}
{{- define "bubble.backend.djangoSecretEnv" -}}
{{- if .Values.backend.secrets.existingSecret }}
- name: DJANGO_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.backend.secrets.existingSecret | quote }}
      key: {{ (.Values.backend.secrets.existingSecretKey | default "DJANGO_SECRET_KEY") | quote }}
{{- end }}
{{- end }}

{{/*
Worker fullname
*/}}
{{- define "bubble.worker.fullname" -}}
{{- printf "%s-worker" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
PostgreSQL fullname
*/}}
{{- define "bubble.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
PgBouncer fullname
*/}}
{{- define "bubble.pgbouncer.fullname" -}}
{{- printf "%s-pgbouncer" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Redis fullname
*/}}
{{- define "bubble.redis.fullname" -}}
{{- printf "%s-redis" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
ISBN Lookup fullname
*/}}
{{- define "bubble.isbnLookup.fullname" -}}
{{- printf "%s-isbn-search" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
ISBN Lookup internal base URL
*/}}
{{- define "bubble.isbnLookup.url" -}}
http://{{ include "bubble.isbnLookup.fullname" . }}:{{ .Values.isbnLookup.service.port }}
{{- end }}

{{/*
PostgreSQL host
Returns PgBouncer host when pgbouncer is enabled, otherwise direct PostgreSQL/external host.
*/}}
{{- define "bubble.postgresql.host" -}}
{{- if .Values.pgbouncer.enabled }}
{{- include "bubble.pgbouncer.fullname" . }}
{{- else if .Values.postgresql.enabled }}
{{- include "bubble.postgresql.fullname" . }}
{{- else }}
{{- .Values.externalPostgresql.host }}
{{- end }}
{{- end }}

{{/*
PostgreSQL port
Returns PgBouncer port when pgbouncer is enabled, otherwise direct PostgreSQL/external port.
*/}}
{{- define "bubble.postgresql.port" -}}
{{- if .Values.pgbouncer.enabled }}
{{- .Values.pgbouncer.service.port }}
{{- else if .Values.postgresql.enabled }}
{{- .Values.postgresql.service.port }}
{{- else }}
{{- .Values.externalPostgresql.port }}
{{- end }}
{{- end }}

{{/*
PostgreSQL direct host (bypasses PgBouncer — used by PgBouncer itself to reach Postgres)
*/}}
{{- define "bubble.postgresql.direct.host" -}}
{{- if .Values.postgresql.enabled }}
{{- include "bubble.postgresql.fullname" . }}
{{- else }}
{{- .Values.externalPostgresql.host }}
{{- end }}
{{- end }}

{{/*
PostgreSQL direct port (bypasses PgBouncer — used by PgBouncer itself to reach Postgres)
*/}}
{{- define "bubble.postgresql.direct.port" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.service.port }}
{{- else }}
{{- .Values.externalPostgresql.port }}
{{- end }}
{{- end }}

{{/*
PostgreSQL database
*/}}
{{- define "bubble.postgresql.database" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.database }}
{{- else }}
{{- .Values.externalPostgresql.database }}
{{- end }}
{{- end }}

{{/*
PostgreSQL username
*/}}
{{- define "bubble.postgresql.username" -}}
{{- if .Values.postgresql.enabled }}
{{- .Values.postgresql.auth.username }}
{{- else }}
{{- .Values.externalPostgresql.username }}
{{- end }}
{{- end }}

{{/*
PostgreSQL password secret name
*/}}
{{- define "bubble.postgresql.secretName" -}}
{{- if .Values.postgresql.auth.existingSecret }}
{{- .Values.postgresql.auth.existingSecret }}
{{- else if .Values.postgresql.enabled }}
{{- include "bubble.fullname" . }}-postgresql
{{- else if .Values.externalPostgresql.existingSecret }}
{{- .Values.externalPostgresql.existingSecret }}
{{- else }}
{{- include "bubble.fullname" . }}-external-postgresql
{{- end }}
{{- end }}

{{/*
PostgreSQL password secret key
*/}}
{{- define "bubble.postgresql.secretKey" -}}
{{- if .Values.postgresql.auth.existingSecret -}}
{{- .Values.postgresql.auth.existingSecretPasswordKey -}}
{{- else if .Values.postgresql.enabled -}}
password
{{- else if .Values.externalPostgresql.existingSecret -}}
{{- .Values.externalPostgresql.existingSecretPasswordKey -}}
{{- else -}}
password
{{- end -}}
{{- end }}

{{/*
Redis host
*/}}
{{- define "bubble.redis.host" -}}
{{- if .Values.redis.enabled }}
{{- include "bubble.redis.fullname" . }}
{{- else }}
{{- .Values.externalRedis.host }}
{{- end }}
{{- end }}

{{/*
Redis port
*/}}
{{- define "bubble.redis.port" -}}
{{- if .Values.redis.enabled }}
{{- .Values.redis.service.port }}
{{- else }}
{{- .Values.externalRedis.port }}
{{- end }}
{{- end }}

{{/*
Redis URL
*/}}
{{- define "bubble.redis.url" -}}
{{- if .Values.redis.enabled -}}
redis://{{ include "bubble.redis.fullname" . }}:{{ .Values.redis.service.port }}/0
{{- else if .Values.externalRedis.password -}}
redis://:$(REDIS_PASSWORD)@{{ .Values.externalRedis.host }}:{{ .Values.externalRedis.port }}/{{ .Values.externalRedis.db }}
{{- else -}}
redis://{{ .Values.externalRedis.host }}:{{ .Values.externalRedis.port }}/{{ .Values.externalRedis.db }}
{{- end }}
{{- end }}

{{/*
Database URL
*/}}
{{- define "bubble.database.url" -}}
postgres://{{ include "bubble.postgresql.username" . }}:$(DATABASE_PASSWORD)@{{ include "bubble.postgresql.host" . }}:{{ include "bubble.postgresql.port" . }}/{{ include "bubble.postgresql.database" . }}
{{- end }}

{{/*
Image pull secrets
*/}}
{{- define "bubble.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Optional envFrom entry for a shared existing secret.
Renders a secretRef block when .Values.secretsFrom.existingSecret is non-empty.
Usage: {{- include "bubble.secretsFrom" . | nindent <N> }}
*/}}
{{- define "bubble.secretsFrom" -}}
{{- if .Values.secretsFrom.existingSecret }}
- secretRef:
    name: {{ .Values.secretsFrom.existingSecret }}
  {{- if .Values.secretsFrom.envPrefix }}
  prefix: {{ .Values.secretsFrom.envPrefix }}
  {{- end }}
{{- end }}
{{- end }}

{{/*
RustFS subchart service name.
When deployed as a subchart the StatefulSet Service follows the pattern
"<release>-rustfs".  The S3 API is exposed on port 9000.
*/}}
{{- define "bubble.rustfs.serviceName" -}}
{{- printf "%s-rustfs" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
RustFS secret name — prefers existingSecret when set.
When externalS3 is used instead, returns the externalS3 secret name.
*/}}
{{- define "bubble.rustfs.secretName" -}}
{{- if .Values.rustfs.enabled -}}
  {{- if .Values.rustfs.existingSecret -}}
    {{- .Values.rustfs.existingSecret -}}
  {{- else -}}
    {{- include "bubble.rustfs.serviceName" . -}}
  {{- end -}}
{{- else if .Values.externalS3.enabled -}}
  {{- if .Values.externalS3.existingSecret -}}
    {{- .Values.externalS3.existingSecret -}}
  {{- else -}}
    {{- include "bubble.fullname" . -}}-external-s3
  {{- end -}}
{{- end -}}
{{- end }}

{{/*
S3 endpoint URL — returns the internal RustFS endpoint when rustfs.enabled,
otherwise the operator-supplied externalS3.endpointUrl.
*/}}
{{- define "bubble.s3.endpointUrl" -}}
{{- if .Values.rustfs.enabled -}}
http://{{ include "bubble.rustfs.serviceName" . }}:9000
{{- else -}}
{{- .Values.externalS3.endpointUrl -}}
{{- end }}
{{- end }}

{{/*
S3 bucket name
*/}}
{{- define "bubble.s3.bucket" -}}
{{- if .Values.rustfs.enabled -}}
{{- .Values.rustfs.defaultBucket -}}
{{- else -}}
{{- .Values.externalS3.bucket -}}
{{- end }}
{{- end }}

{{/*
S3 custom domain (used for public media URLs).
When RustFS is enabled and no customDomain override is given, we leave this
empty so django-storages builds the URL from endpoint + bucket.
*/}}
{{- define "bubble.s3.customDomain" -}}
{{- if .Values.rustfs.enabled -}}
{{- .Values.rustfs.customDomain | default "" -}}
{{- else -}}
{{- .Values.externalS3.customDomain | default "" -}}
{{- end }}
{{- end }}
