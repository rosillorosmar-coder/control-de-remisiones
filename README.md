# Control de remisiones

Aplicación web interna para controlar clientes, remisiones, pagos y saldos.

## Ejecutar

```bash
npm start
```

Luego abre:

```text
http://localhost:8000
```

Usuario inicial:

```text
admin / admin123
```

Cambia esa contraseña antes de publicar la aplicación en internet. Los datos compartidos se guardan en `data/remisiones.db` usando SQLite.

Si existe un archivo viejo `data/store.json`, el servidor lo migra automáticamente a SQLite la primera vez que crea la base.

El administrador puede crear y modificar usuarios desde el módulo `Usuarios` dentro de la app.

## Agregar usuarios

También puedes crear usuarios desde terminal. Con el servidor creado al menos una vez, ejecuta:

```bash
node scripts/add-user.js vendedor "Juan Perez" clave123 captura
```

Roles sugeridos: `admin`, `captura`, `cobranza`, `consulta`.

## Seguridad antes de publicar

La app incluye:

- Sesiones con cookie `HttpOnly` y `SameSite=Strict`.
- Cookie `Secure` cuando se ejecuta en producción o detrás de HTTPS.
- Bloqueo temporal después de 5 intentos fallidos de login.
- Cabeceras de seguridad como CSP, `X-Frame-Options`, `nosniff` y política de permisos.
- Bloqueo para no servir archivos internos como `server.js`, `README.md`, `data/` o `.git/`.
- Aviso para cambiar la contraseña inicial `admin / admin123`.

Para publicar, ejecuta detrás de HTTPS y usa:

```bash
NODE_ENV=production node server.js
```

Si usas un proxy como Nginx/Caddy/Cloudflare, configura `X-Forwarded-Proto: https` para que la cookie salga como segura.

## Publicacion

Variables principales:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=8000
DATA_DIR=/ruta/persistente/data
```

La ruta `DATA_DIR` debe ser persistente porque ahi vive `remisiones.db`.

Health check:

```text
GET /api/health
```

Respaldar la base:

```bash
npm run db:backup
```

Por defecto los respaldos se guardan en `backups/`. Puedes cambiarlo con `BACKUP_DIR=/ruta/backups`.

### Docker

Construir imagen:

```bash
docker build -t control-remisiones .
```

Ejecutar con volumen persistente:

```bash
docker run -d \
  --name control-remisiones \
  -p 8000:8000 \
  -v remisiones-data:/app/data \
  control-remisiones
```

En produccion, publica el contenedor detras de HTTPS con Nginx, Caddy, Cloudflare Tunnel o el proxy del hosting.

## Publicacion recomendada con HTTPS

Esta es la ruta sugerida para que varios usuarios entren por internet con usuario y contrasena:

```text
https://remisiones.tunegocio.com
```

### Requisitos

- Un dominio o subdominio, por ejemplo `remisiones.tunegocio.com`.
- Un servidor Linux/VPS con Docker y Docker Compose.
- Puertos `80` y `443` abiertos hacia internet.
- El DNS del dominio apuntando a la IP publica del servidor.

### Configurar variables

En el servidor, copia la plantilla:

```bash
cp .env.production.example .env.production
```

Edita `.env.production`:

```text
DOMAIN=remisiones.tunegocio.com
ACME_EMAIL=admin@tunegocio.com
```

`DOMAIN` debe ser el dominio real que usaran tus usuarios. `ACME_EMAIL` se usa para emitir el certificado HTTPS automatico.

### Levantar la aplicacion

```bash
docker compose --env-file .env.production up -d --build
```

Caddy publica la app con HTTPS automatico y redirige el trafico al contenedor Node. Los datos quedan en el volumen persistente `remisiones-data`.

Verificar estado:

```bash
docker compose --env-file .env.production ps
curl https://remisiones.tunegocio.com/api/health
```

### Primer acceso

Entra al dominio configurado y usa el usuario administrador. Cambia la contrasena inicial antes de entregar accesos:

```text
admin / admin123
```

Despues crea usuarios desde el modulo `Usuarios`.

Roles sugeridos:

- `admin`: usuarios y administracion general.
- `captura`: clientes, remisiones y solicitudes.
- `cobranza`: confirma solicitudes y genera pagos.
- `consulta`: solo lectura.

### Respaldos en produccion

La base vive dentro del volumen `remisiones-data`. Para generar un respaldo desde el contenedor:

```bash
docker compose --env-file .env.production exec app npm run db:backup
```

Para copiar respaldos fuera del contenedor, monta una carpeta externa o usa una tarea programada del servidor. Recomendacion minima: respaldo diario y copia fuera del servidor.

### Actualizar la aplicacion

Despues de subir cambios al servidor:

```bash
docker compose --env-file .env.production up -d --build
```

No borres el volumen `remisiones-data`, porque ahi estan los clientes, remisiones, solicitudes y pagos.

## Publicacion en Vercel

La app tambien puede publicarse en Vercel. Para Vercel se usa una base Postgres externa, porque el archivo SQLite local (`data/remisiones.db`) no es adecuado para funciones serverless.

Para el flujo recomendado con Supabase, GitHub y Vercel, usa la guia:

```text
PUBLICACION_SUPABASE_GITHUB_VERCEL.md
```

La app mantiene ambos modos:

- Local o VPS: SQLite.
- Vercel: Postgres usando `DATABASE_URL` o `POSTGRES_URL`.

### Archivos para Vercel

- `vercel.json`: dirige todas las rutas hacia la funcion serverless.
- `api/index.js`: entrada serverless que reutiliza `server.js`.
- `server.js`: detecta `DATABASE_URL` o `POSTGRES_URL` y usa Postgres.
- `public/`: copia estatica de `index.html`, `app.js` y `styles.css` para que Vercel sirva la pantalla principal.

### Requisitos en Vercel

1. Crear un proyecto en Vercel conectado al repositorio.
2. Agregar una base Postgres desde Marketplace, por ejemplo Neon.
3. Configurar variables de entorno:

```text
NODE_ENV=production
DATABASE_URL=postgres://...
SESSION_SECRET=un-secreto-largo-y-aleatorio
```

`SESSION_SECRET` se usa para firmar la cookie de sesion. Usa un valor largo, privado y diferente para produccion.

Puedes generar uno con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Desplegar con Vercel CLI

Si tienes Vercel CLI:

```bash
vercel
vercel env add DATABASE_URL production
vercel env add SESSION_SECRET production
vercel --prod
```

Despues agrega tu dominio en el panel de Vercel y apunta el DNS segun las instrucciones que muestre Vercel.

### Primer acceso

Al abrir el dominio de produccion, la app creara el usuario inicial si la base esta vacia:

```text
admin / admin123
```

Cambia esa contrasena de inmediato y crea los usuarios reales desde el modulo `Usuarios`.
