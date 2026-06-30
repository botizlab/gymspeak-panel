# GymSpeak — Panel web (MVP)

Panel de PC para gestionar **rutinas** y revisar **entrenamientos** de GymSpeak,
conectado al **mismo Supabase** que la app móvil. Todo se sincroniza solo.

Sitio estático (HTML/CSS/JS, sin build) → GitHub Pages. Usa `@supabase/supabase-js`
desde CDN (esm.sh). Solo la clave **anon** pública; la seguridad la da el **RLS**
de Supabase (cada usuario solo ve y edita lo suyo).

## Funciones (MVP)
- **Login** con la misma cuenta de la app (email + contraseña).
- **Rutinas**: ver, crear, editar (nombre + ejercicios con series/reps/peso) y borrar.
  - Guardar usa la RPC `replace_routine_exercises` (reemplazo atómico, igual que la app).
- **Entrenamientos**: lista de los últimos registros, agrupados por día.

## Publicar (GitHub Pages)
Repo `botizlab/gymspeak-panel` → URL `https://botizlab.github.io/gymspeak-panel/`.
1. Sube estos archivos a `main`.
2. Settings → Pages → Deploy from branch → `main` / root.

## Pendiente / ideas futuras
- Progreso (gráficas) en la web.
- Editar peso/unidad por serie y grupo muscular de la rutina.
- Marcar entrenamientos como completados desde la web.
- "Login con BotizLab" (cuenta compartida entre apps).

## Esquema usado (referencia)
- `routines(id, user_id, name, muscle_group, scheduled_days, created_at)`
- `routine_items(routine_id, exercise_name, sets, reps, weight, weight_unit, duration, distance, sets_details, position, notes)`
- `workout_logs(id, user_id, exercise_name, sets_details, weight_unit, duration, notes, logged_at, completed)`
