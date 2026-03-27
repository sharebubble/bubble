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
Backend fullname
*/}}
{{- define "bubble.backend.fullname" -}}
{{- printf "%s-backend" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Worker fullname
*/}}
{{- define "bubble.worker.fullname" -}}
{{- printf "%s-worker" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Beat fullname
*/}}
{{- define "bubble.beat.fullname" -}}
{{- printf "%s-beat" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Scheduler fullname
*/}}
{{- define "bubble.scheduler.fullname" -}}
{{- printf "%s-scheduler" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
PostgreSQL fullname
*/}}
{{- define "bubble.postgresql.fullname" -}}
{{- printf "%s-postgresql" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Redis fullname
*/}}
{{- define "bubble.redis.fullname" -}}
{{- printf "%s-redis" (include "bubble.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
PostgreSQL host
*/}}
{{- define "bubble.postgresql.host" -}}
{{- if .Values.postgresql.enabled }}
{{- include "bubble.postgresql.fullname" . }}
{{- else }}
{{- .Values.externalPostgresql.host }}
{{- end }}
{{- end }}

{{/*
PostgreSQL port
*/}}
{{- define "bubble.postgresql.port" -}}
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
{{- if .Values.postgresql.enabled }}
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
{{- if .Values.postgresql.enabled -}}
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
{{- if .Values.redis.enabled }}
redis://{{ include "bubble.redis.fullname" . }}:{{ .Values.redis.service.port }}/0
{{- else if .Values.externalRedis.password }}
redis://:$(REDIS_PASSWORD)@{{ .Values.externalRedis.host }}:{{ .Values.externalRedis.port }}/{{ .Values.externalRedis.db }}
{{- else }}
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
