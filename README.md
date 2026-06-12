# CICSA Comedor — Bot de Pedidos por WhatsApp

Sistema de pedidos de menú para comedor industrial vía WhatsApp Business.

## Arquitectura

```
WhatsApp Cloud API → Railway (este backend) → Supabase (Postgres)
                                    ↑
                     Panel Admin (GitHub Pages / public/)
```

## Parámetros de este proyecto

- **Hora de corte:** 20:00 hrs (8:00 PM)
- **Zona horaria:** America/Mexico_City (Lázaro Cárdenas, Michoacán)
- **Servicio Railway:** cicsa-comedor (separado de TallerConnect)

---

## Pasos de despliegue

### 1. Base de datos (Supabase)
1. Crea un proyecto nuevo en tu organización **Roca Talleres**
2. Ve a **SQL Editor → New Query**
3. Pega el contenido de `schema.sql` y haz **Run**
4. Ve a **Project Settings → API** y copia:
   - `Project URL` → será `SUPABASE_URL`
   - `service_role` key → será `SUPABASE_KEY`

### 2. Backend (Railway)
1. Sube este repositorio a GitHub
2. En Railway: **New Project → Deploy from GitHub repo → cicsa-comedor**
3. En **Variables**, agrega todas las del archivo `.env.example`
4. Railway despliega automáticamente. Copia la URL pública generada.

### 3. Webhook (Meta Business)
Cuando Meta apruebe la verificación:
1. WhatsApp → Configuration → Webhook
2. **Callback URL:** `https://<tu-app>.up.railway.app/webhook`
3. **Verify Token:** el mismo valor que pusiste en `VERIFY_TOKEN`
4. Suscríbete al evento **messages**
5. Conecta el número 6144053902 a la app

### 4. Panel de administración
1. Edita `public/admin.html` y cambia `API_BASE` por la URL de Railway
2. Sube la carpeta `public/` a GitHub Pages (o ábrela localmente)
3. Ingresa la `ADMIN_KEY` al entrar al panel

---

## Endpoints del backend

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servicio |
| GET/POST | `/webhook` | WhatsApp (Meta) |
| GET | `/api/empleados` | Lista empleados |
| POST | `/api/empleados` | Crea/actualiza empleado |
| PUT | `/api/empleados/:tel/activo` | Activa/desactiva |
| GET | `/api/menu/:fecha` | Consulta menú |
| POST | `/api/menu` | Publica menú |
| GET | `/api/pedidos/:fecha` | Pedidos de un día |
| GET | `/api/pedidos?ini=&fin=` | Pedidos por rango |
| GET | `/api/resumen-cocina/:fecha` | Conteo por platillo |
| POST | `/api/enviar-menu` | Envío masivo del menú de mañana |

Todas las rutas `/api/*` requieren el header `x-admin-key`.

---

## Flujo del bot

1. Empleado envía cualquier mensaje → recibe el menú de **mañana** como lista interactiva
2. Selecciona una opción → se registra el pedido (UPSERT)
3. Puede cambiar su pedido las veces que quiera antes de las **20:00 hrs**
4. Después del corte → mensaje de "sistema cerrado"

## Pruebas antes de la aprobación de Meta

Usa el número **sandbox** gratuito que Meta proporciona en *API Setup* para probar
el flujo completo sin esperar la verificación del negocio.
