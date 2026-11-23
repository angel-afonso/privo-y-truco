# Configuración de Backend Supabase (Persistencia + Reconexión + Anti-Trampa)

La app funciona automáticamente en **dos modos**:

1. **Modo Realtime Endurecido (activo de inmediato sin configuración adicional):**
   - Reconexión automática tras recargar pestaña (`sessionStorage` + recuperación de asiento).
   - Enmascaramiento por asiento (`sanitizeCanonicalStateForViewer`) en los envíos a invitados (los invitados nunca reciben las cartas ocultas ajenas por WebSocket).
   - **Bot suplente automático** si un jugador humano se desconecta más de 12 s (recupera su control al volver).
   - **Migración automática de Anfitrión** y recuperación local si el anfitrión recarga su pestaña.

2. **Modo Servidor Autoritativo (Postgres + Edge Function `truco-game`):**
   - **Persistencia real en Postgres** (`truco_rooms` y `truco_room_players`): la partida sobrevive incluso si el anfitrión cierra el navegador.
   - **Anti-trampa total:** RLS bloquea el acceso directo a las tablas; el motor corre en el servidor y ningún cliente (ni siquiera el anfitrión) recibe jamás cartas ocultas de otro jugador por red.
   - La app detecta automáticamente la Edge Function `truco-game` apenas la despliegues.

---

## Pasos para activar el Modo Servidor Autoritativo (2 minutos)

### Paso 1: Crear las tablas y políticas RLS en Postgres
Aplica las migraciones pendientes en este orden desde **Supabase Dashboard → SQL Editor** o ejecuta `supabase db push` con el proyecto vinculado.

1. `supabase/migrations/001_truco_multiplayer.sql` crea las salas y los jugadores.
2. `supabase/migrations/002_public_rooms.sql` habilita las salas abiertas. Las salas existentes conservan acceso privado por código.
3. `supabase/migrations/003_host_invitations.sql` separa el código de invitación del identificador de sala y renueva la invitación tras cada uso.
4. `supabase/migrations/004_room_chat.sql` habilita el chat de la mesa y conserva sus últimos 50 mensajes.
5. `supabase/migrations/005_close_empty_room.sql` elimina la sala y su chat cuando el último jugador elige salir.

### Paso 2: Desplegar la Edge Function `truco-game`
Desde la raíz del proyecto (con la CLI de Supabase):

```bash
supabase login
supabase link --project-ref wdkjsgpluzhhqpnrskqx
supabase functions deploy truco-game --no-verify-jwt
```

> Nota: `--no-verify-jwt` permite jugar salas rápidas con invitados anónimos autenticados por `clientId + playerSecret` por sesión; la función valida internamente cada token en `truco_room_players` usando `SUPABASE_SERVICE_ROLE_KEY`.

### Paso 3: Verificar
Desde **Crear sala**, elige **Abierta**. Abre la portada en otro navegador y entra desde **Salas abiertas**. Para jugar por invitación, elige **Privada**. Desde la mesa, el anfitrión puede copiar un enlace o compartir el código de un uso con el siguiente jugador. El directorio requiere la base de datos y la función actualizadas. El modo Realtime por sí solo admite las salas privadas.
