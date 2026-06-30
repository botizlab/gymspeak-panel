// ============================================================
// GymSpeak — Panel web (MVP)
// Mismo backend que la app (Supabase): login con tu cuenta y
// gestión de rutinas + ver entrenamientos. Todo sincronizado.
// Solo se usa la clave anon pública; la seguridad la garantiza
// el RLS de Supabase (cada usuario solo ve lo suyo).
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPA_URL = 'https://datuqilcshjvapujdool.supabase.co';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdHVxaWxjc2hqdmFwdWpkb29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDgxMzIsImV4cCI6MjA5NDYyNDEzMn0.q6AZirRR1UsKKdkxvnmlmPDVQx09T-FckLl03aRh5Gw';

const supabase = createClient(SUPA_URL, SUPA_ANON);

// ─── Utilidades ───────────────────────────────────────────
const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2200);
}

function parseSets(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; } }
  return [];
}

// ─── Estado ───────────────────────────────────────────────
let state = { tab: 'routines', routines: [], logs: [], editing: null, loading: false };

// ─── Arranque ─────────────────────────────────────────────
(async function init() {
  const { data } = await supabase.auth.getSession();
  if (data.session) renderApp(); else renderLogin();
  supabase.auth.onAuthStateChange((_e, session) => {
    if (session) { if (!document.querySelector('.topbar')) renderApp(); }
    else renderLogin();
  });
})();

// ─── Login ────────────────────────────────────────────────
function renderLogin() {
  view.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <div class="auth-logo">Gym<i>Speak</i></div>
        <div class="auth-sub">Panel · gestiona tus rutinas desde el PC</div>
        <form id="loginForm">
          <div class="field">
            <label>Email</label>
            <input class="input" type="email" id="email" autocomplete="email" required />
          </div>
          <div class="field">
            <label>Contraseña</label>
            <input class="input" type="password" id="password" autocomplete="current-password" required />
          </div>
          <button class="btn btn-primary" type="submit" id="loginBtn">Entrar</button>
          <div class="auth-error" id="loginError"></div>
        </form>
        <div class="auth-note">Usa la misma cuenta que en la app de GymSpeak.<br/>Tus rutinas y entrenamientos se sincronizan solos.</div>
      </div>
    </div>`;

  document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('loginBtn');
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = 'Entrando…';
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = error.message === 'Invalid login credentials'
        ? 'Email o contraseña incorrectos.'
        : (error.message || 'No se pudo iniciar sesión.');
      btn.disabled = false; btn.textContent = 'Entrar';
    } else {
      renderApp();
    }
  });
}

// ─── App (cabecera + tabs) ───────────────────────────────
async function renderApp() {
  const { data } = await supabase.auth.getUser();
  const email = data?.user?.email ?? '';
  view.innerHTML = `
    <div class="topbar">
      <div class="topbar-inner">
        <div class="logo">Gym<i>Speak</i></div>
        <div class="right">
          <span class="email">${esc(email)}</span>
          <button class="btn btn-ghost btn-sm" id="logoutBtn">Salir</button>
        </div>
      </div>
    </div>
    <div class="tabs">
      <div class="tab ${state.tab === 'routines' ? 'active' : ''}" data-tab="routines">Rutinas</div>
      <div class="tab ${state.tab === 'workouts' ? 'active' : ''}" data-tab="workouts">Entrenamientos</div>
    </div>
    <div class="wrap" id="content"></div>`;

  document.getElementById('logoutBtn').addEventListener('click', () => supabase.auth.signOut());
  view.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => { state.tab = t.dataset.tab; state.editing = null; renderApp(); })
  );

  if (state.tab === 'routines') renderRoutines();
  else renderWorkouts();
}

// ─── Rutinas ──────────────────────────────────────────────
async function loadRoutines() {
  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  const { data, error } = await supabase
    .from('routines')
    .select('id, name, muscle_group, created_at, routine_items(id, exercise_name, sets, reps, weight, weight_unit, sets_details, position, notes)')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });
  if (error) { toast('Error al cargar rutinas', true); return []; }
  return (data ?? []).map((r) => ({
    id: r.id, name: r.name, muscleGroup: r.muscle_group,
    items: ((r.routine_items) ?? []).sort((a, b) => a.position - b.position).map((it) => ({
      exerciseName: it.exercise_name, sets: it.sets, reps: it.reps, weight: it.weight,
      weightUnit: it.weight_unit ?? 'kg', setsDetails: parseSets(it.sets_details), notes: it.notes,
    })),
  }));
}

async function renderRoutines() {
  const content = document.getElementById('content');

  if (state.editing) return renderEditor();

  content.innerHTML = `<div class="loading">Cargando rutinas…</div>`;
  state.routines = await loadRoutines();

  const list = state.routines.map((r) => `
    <div class="card routine-card">
      <div class="info">
        <h3>${esc(r.name)}</h3>
        <div class="meta">${r.items.length} ${r.items.length === 1 ? 'ejercicio' : 'ejercicios'}${r.muscleGroup ? ' · ' + esc(r.muscleGroup) : ''}</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-edit="${r.id}">Editar</button>
      </div>
    </div>`).join('');

  content.innerHTML = `
    <div class="head">
      <h1>Rutinas</h1>
      <button class="btn btn-primary btn-sm" id="newRoutine">+ Nueva rutina</button>
    </div>
    ${state.routines.length ? list : `<div class="empty"><div class="big">Aún no tienes rutinas</div>Crea tu primera rutina y aparecerá también en la app.</div>`}`;

  document.getElementById('newRoutine').addEventListener('click', () => {
    state.editing = { id: null, name: '', items: [] };
    renderRoutines();
  });
  content.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      state.editing = JSON.parse(JSON.stringify(state.routines.find((r) => r.id === b.dataset.edit)));
      renderRoutines();
    })
  );
}

function renderEditor() {
  const content = document.getElementById('content');
  const r = state.editing;
  const isNew = !r.id;

  const rows = r.items.map((it, i) => `
    <div class="ex-row" data-i="${i}">
      <input class="input" data-f="exerciseName" placeholder="Ejercicio" value="${esc(it.exerciseName ?? '')}" />
      <input class="input" data-f="sets" inputmode="numeric" placeholder="Series" value="${it.sets ?? ''}" />
      <input class="input" data-f="reps" inputmode="numeric" placeholder="Reps" value="${it.reps ?? ''}" />
      <input class="input" data-f="weight" inputmode="decimal" placeholder="Peso" value="${it.weight ?? ''}" />
      <button class="del" data-del="${i}" title="Quitar">✕</button>
    </div>`).join('');

  content.innerHTML = `
    <div class="head">
      <h1>${isNew ? 'Nueva rutina' : 'Editar rutina'}</h1>
    </div>
    <div class="card">
      <label style="display:block;font-size:13px;color:var(--muted);margin-bottom:6px">Nombre de la rutina</label>
      <input class="input" id="routineName" placeholder="Ej. Pierna, Push, Full body…" value="${esc(r.name ?? '')}" />
    </div>
    <div style="margin-top:18px">
      <div class="ex-head"><span>Ejercicio</span><span>Series</span><span>Reps</span><span>Peso</span><span></span></div>
      <div id="exRows">${rows}</div>
      <button class="btn btn-ghost btn-sm" id="addEx" style="margin-top:6px">+ Añadir ejercicio</button>
    </div>
    <div class="editor-actions">
      <button class="btn btn-primary" id="saveRoutine">Guardar</button>
      <button class="btn btn-ghost" id="cancelEdit">Cancelar</button>
      <span class="spacer"></span>
      ${isNew ? '' : '<button class="btn btn-danger" id="deleteRoutine">Borrar rutina</button>'}
    </div>`;

  // Mantener el estado del editor sincronizado con los inputs
  function syncFromInputs() {
    r.name = document.getElementById('routineName').value;
    r.items = [...document.querySelectorAll('#exRows .ex-row')].map((row) => ({
      exerciseName: row.querySelector('[data-f="exerciseName"]').value,
      sets: row.querySelector('[data-f="sets"]').value,
      reps: row.querySelector('[data-f="reps"]').value,
      weight: row.querySelector('[data-f="weight"]').value,
    }));
  }

  document.getElementById('addEx').addEventListener('click', () => {
    syncFromInputs();
    r.items.push({ exerciseName: '', sets: '', reps: '', weight: '' });
    renderEditor();
  });
  content.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', () => { syncFromInputs(); r.items.splice(+b.dataset.del, 1); renderEditor(); })
  );
  document.getElementById('cancelEdit').addEventListener('click', () => { state.editing = null; renderRoutines(); });
  document.getElementById('saveRoutine').addEventListener('click', () => { syncFromInputs(); saveRoutine(); });
  const delBtn = document.getElementById('deleteRoutine');
  if (delBtn) delBtn.addEventListener('click', () => deleteRoutine(r.id));
}

async function saveRoutine() {
  const r = state.editing;
  const name = (r.name || '').trim();
  if (!name) { toast('Ponle un nombre a la rutina', true); return; }

  const items = r.items
    .filter((it) => (it.exerciseName || '').trim())
    .map((it) => ({
      exercise_name: it.exerciseName.trim(),
      sets: num(it.sets), reps: num(it.reps), weight: num(it.weight),
      weight_unit: 'kg', duration: null, distance: null, sets_details: [], notes: null,
    }));

  const btn = document.getElementById('saveRoutine');
  btn.disabled = true; btn.textContent = 'Guardando…';

  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  let routineId = r.id;

  if (!routineId) {
    const { data, error } = await supabase
      .from('routines').insert({ user_id: uid, name, scheduled_days: [] }).select('id').single();
    if (error) { toast('No se pudo crear la rutina', true); btn.disabled = false; btn.textContent = 'Guardar'; return; }
    routineId = data.id;
  } else {
    const { error } = await supabase.from('routines').update({ name }).eq('id', routineId);
    if (error) { toast('No se pudo guardar', true); btn.disabled = false; btn.textContent = 'Guardar'; return; }
  }

  const { error: rpcErr } = await supabase.rpc('replace_routine_exercises', { p_routine_id: routineId, p_items: items });
  if (rpcErr) { toast('Error al guardar los ejercicios', true); btn.disabled = false; btn.textContent = 'Guardar'; return; }

  toast('Rutina guardada');
  state.editing = null;
  renderRoutines();
}

async function deleteRoutine(id) {
  if (!confirm('¿Borrar esta rutina? No se puede deshacer.')) return;
  const { error } = await supabase.from('routines').delete().eq('id', id);
  if (error) { toast('No se pudo borrar', true); return; }
  toast('Rutina borrada');
  state.editing = null;
  renderRoutines();
}

// ─── Entrenamientos ──────────────────────────────────────
async function renderWorkouts() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading">Cargando entrenamientos…</div>`;

  const { data: u } = await supabase.auth.getUser();
  const uid = u?.user?.id;
  const { data, error } = await supabase
    .from('workout_logs')
    .select('id, exercise_name, sets_details, weight_unit, notes, logged_at, completed')
    .eq('user_id', uid)
    .order('logged_at', { ascending: false })
    .limit(200);

  if (error) { content.innerHTML = `<div class="empty">Error al cargar.</div>`; return; }
  const logs = data ?? [];
  if (!logs.length) {
    content.innerHTML = `<div class="head"><h1>Entrenamientos</h1></div><div class="empty"><div class="big">Todavía no hay entrenamientos</div>Cuando registres en la app, aparecerán aquí.</div>`;
    return;
  }

  // Agrupar por día
  const groups = {};
  for (const l of logs) {
    const key = (l.logged_at || '').slice(0, 10);
    (groups[key] ??= []).push(l);
  }

  const html = Object.keys(groups).map((day) => `
    <div class="day-group">
      <div class="day-label">${esc(formatDay(day))}</div>
      ${groups[day].map((l) => {
        const sd = parseSets(l.sets_details);
        return `
        <div class="log">
          <div class="check ${l.completed ? 'done' : ''}">${l.completed ? '✓' : ''}</div>
          <div class="info">
            <div class="name">${esc(l.exercise_name ?? '')}</div>
            <div class="sum">${esc(setsSummary(sd, l.weight_unit))}</div>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('');

  content.innerHTML = `<div class="head"><h1>Entrenamientos</h1></div>${html}`;
}

function setsSummary(sd, unit) {
  if (!sd.length) return 'Sin series registradas';
  const n = sd.length;
  const parts = [`${n} ${n === 1 ? 'serie' : 'series'}`];
  const first = sd[0];
  if (first.reps != null) parts.push(`${first.reps} reps`);
  const weights = sd.map((s) => s.weight).filter((w) => w != null);
  if (weights.length) parts.push(`${Math.max(...weights)} ${unit || 'kg'}`);
  return parts.join(' · ');
}

function formatDay(key) {
  if (!key) return '';
  const d = new Date(key + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}
