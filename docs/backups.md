# Backups de FleetOS

Estrategia de **dos capas**. No dependas de una sola.

| Capa | Qué es | Dónde queda | Esfuerzo |
|------|--------|-------------|----------|
| **1. Render nativo** | Backups diarios automáticos del Postgres de Render | Dentro de Render | Confirmar 1 vez |
| **2. Email** | Cron Job que corre `pg_dump` y te manda el `.sql.gz` | Tu Gmail (fuera de Render) | Setup 1 vez |

La capa 1 te cubre ante un borrado accidental (restore con un click). La capa 2 te cubre ante un problema con la cuenta de Render (tenés tu propia copia).

---

## Capa 1 — Backups nativos de Render (confirmar)

1. Render Dashboard → tu base **PostgreSQL** → pestaña **Backups** (o **Recovery**).
2. En planes pagos, Render hace un backup diario automático con retención (~7 días) y permite *Point-in-Time Recovery*. Verificá que figure activo.
3. Si tu plan es gratuito y no muestra backups automáticos, la **capa 2 pasa a ser tu backup principal** (no opcional).

> No hace falta código para esto. Es solo confirmar en el panel.

---

## Capa 2 — Backup por email (Cron Job)

El script `scripts/backup-email.js` corre `pg_dump`, comprime y te manda el archivo adjunto.

### Paso 1 — Crear una "App Password" de Gmail
La contraseña normal de Gmail **no** sirve para SMTP. Hace falta una *App Password*:

1. La cuenta de Gmail necesita **Verificación en 2 pasos** activada
   (Cuenta de Google → Seguridad → Verificación en 2 pasos).
2. Cuenta de Google → Seguridad → **Contraseñas de aplicaciones**.
3. Creá una nueva (nombre: "FleetOS Backup"). Te da **16 caracteres**.
4. Esos 16 caracteres son el valor de `SMTP_PASS`.

### Paso 2 — Crear el Cron Job en Render
Render Dashboard → **New +** → **Cron Job**:

| Campo | Valor |
|-------|-------|
| **Repository** | el mismo repo de FleetOS |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Command** | `npm run backup` |
| **Schedule** | `0 6 * * *` (06:00 UTC = **03:00 Argentina**, diario) |

### Paso 3 — Variables de entorno del Cron Job
En el Cron Job, sección **Environment**, cargá:

| Variable | Valor |
|----------|-------|
| `DATABASE_URL` | la misma cadena que usa la web (usá la *Internal Database URL* de Render) |
| `BACKUP_EMAIL_TO` | el email donde querés recibir el backup |
| `SMTP_USER` | tu Gmail |
| `SMTP_PASS` | la App Password de 16 caracteres del Paso 1 |
| `SMTP_HOST` | `smtp.gmail.com` *(opcional, es el default)* |
| `SMTP_PORT` | `465` *(opcional, es el default)* |
| `BACKUP_MAX_MB` | `20` *(opcional)* |

### Paso 4 — Probar
- En el Cron Job de Render: botón **Trigger Run** (o **Run now**) → revisá los logs y tu casilla.
- En local (con un `.env` completo): `npm run backup`.

Deberías recibir un mail **✅ Backup FleetOS …** con el `.sql.gz` adjunto.

---

## Restaurar un backup

```bash
gunzip -c fleetos-backup-AAAA-MM-DD_HH-MM-SS.sql.gz | psql "TU_DATABASE_URL"
```

> Restaurá siempre sobre una base **vacía o de prueba** primero para verificar, nunca directo sobre producción sin estar seguro.

---

## Notas y límites

- **Tamaño**: Gmail corta adjuntos en ~25 MB. El script avisa (sin adjuntar) si el `.sql.gz` supera `BACKUP_MAX_MB` (20 por defecto). Cuando la base crezca y se acerque a ese límite, conviene migrar el destino a un bucket (S3 / Backblaze B2) en vez de email.
- **Seguridad**: el `.sql.gz` contiene **toda la base** (incluidos hashes de contraseñas). Tratá ese email como sensible; no lo reenvíes.
- **`pg_dump`**: el script lo invoca sin shell (a prueba de inyección). Necesita que el binario `pg_dump` esté disponible en el entorno del Cron Job (el runtime Node de Render normalmente lo incluye; es el mismo que usa el botón de backup de la app). Si el run falla con *"no se pudo ejecutar pg_dump"*, avisá y se arma una variante con `pg_dump` garantizado.
