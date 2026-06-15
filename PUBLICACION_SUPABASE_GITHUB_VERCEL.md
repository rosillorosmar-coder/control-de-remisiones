# Publicacion con Supabase, GitHub y Vercel

Esta guia publica la aplicacion como web privada usando:

- Supabase: base de datos Postgres.
- GitHub: repositorio del codigo.
- Vercel: hosting y dominio HTTPS.

## 1. Supabase

1. Entra a Supabase y crea un proyecto nuevo.
2. Ve a `Connect`.
3. Copia el connection string de `Transaction pooler`.
4. Usa el puerto `6543`.
5. Guarda esa cadena para configurarla en Vercel como `DATABASE_URL`.

Ejemplo de formato:

```text
postgres://postgres.xxxxx:TU_PASSWORD@aws-0-region.pooler.supabase.com:6543/postgres
```

Para Vercel conviene `Transaction pooler` porque Vercel usa funciones serverless y abre conexiones temporales.

## 2. GitHub

1. Crea un repositorio nuevo en GitHub.
2. Sube esta carpeta al repositorio.
3. No subas estos archivos:

```text
data/remisiones.db
data/remisiones.db-wal
data/remisiones.db-shm
backups/
.env
.env.production
.vercel/
```

Ya estan incluidos en `.gitignore`.

Comandos sugeridos desde esta carpeta:

```bash
git init
git add .
git commit -m "Publicar control de remisiones"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPOSITORIO.git
git push -u origin main
```

## 3. Vercel

1. Entra a Vercel.
2. Crea un proyecto nuevo importando el repositorio de GitHub.
3. En `Environment Variables`, agrega:

```text
NODE_ENV=production
DATABASE_URL=connection-string-de-supabase
SESSION_SECRET=secreto-largo-aleatorio
```

Genera `SESSION_SECRET` con:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

4. Despliega el proyecto.

La app detecta `DATABASE_URL` y usa Supabase/Postgres automaticamente. Si no existe `DATABASE_URL`, usa SQLite local.

## 4. Dominio

En Vercel:

1. Abre el proyecto.
2. Ve a `Settings > Domains`.
3. Agrega tu dominio o subdominio, por ejemplo:

```text
remisiones.tudominio.com
```

4. Vercel te mostrara los registros DNS que debes configurar.
5. Espera la propagacion DNS y confirma que el dominio quede con HTTPS activo.

## 5. Primer acceso

Cuando la base de Supabase este vacia, la app creara el usuario inicial:

```text
admin / admin123
```

Cambia esa contrasena en el primer ingreso y crea los usuarios reales desde el modulo `Usuarios`.

Roles:

- `admin`: usuarios y administracion general.
- `captura`: clientes, remisiones y solicitudes.
- `cobranza`: confirma solicitudes y genera pagos.
- `consulta`: solo lectura.

## 6. Verificacion

Abre:

```text
https://tu-dominio/api/health
```

Debe responder algo parecido a:

```json
{
  "ok": true,
  "storage": "postgres",
  "environment": "production"
}
```

Si `storage` dice `sqlite`, significa que falta `DATABASE_URL` en Vercel.
