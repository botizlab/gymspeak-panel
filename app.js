// ============================================================
// GymSpeak — Panel web completo
// Mismo backend que la app (Supabase). Todo lo "gratis" de la
// app móvil, desde el PC: entrenamientos (crear/editar/borrar/
// completar), rutinas (CRUD + programación + aplicar a un día),
// progreso (gráfica), amigos (ranking, solicitudes, buscar) y
// perfil. Solo clave anon pública; la seguridad la da el RLS.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPA_URL = 'https://datuqilcshjvapujdool.supabase.co';
const SUPA_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhdHVxaWxjc2hqdmFwdWpkb29sIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNDgxMzIsImV4cCI6MjA5NDYyNDEzMn0.q6AZirRR1UsKKdkxvnmlmPDVQx09T-FckLl03aRh5Gw';

const supabase = createClient(SUPA_URL, SUPA_ANON);

// ─── Utilidades ───────────────────────────────────────────
const view = document.getElementById('view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);

function toast(msg, isErr = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (isErr ? ' err' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 2400);
}

function parseSets(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') { try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; } }
  return [];
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

// e1RM (Epley), igual que la app
const e1rm = (w, r) => (!w || !r) ? 0 : (r === 1 ? w : Math.round(w * (1 + r / 30) * 10) / 10);

// Tiers de fuerza (mismos umbrales que lib/strengthScore.ts de la app)
function scoreToTier(score) {
  if (score == null) return null;
  if (score >= 1.5) return { name: 'Maestro', color: '#b07cff' };
  if (score >= 1.3) return { name: 'Diamante', color: '#6ea8fe' };
  if (score >= 1.1) return { name: 'Platino', color: '#7fdbca' };
  if (score >= 0.9) return { name: 'Oro', color: '#f5c542' };
  if (score >= 0.7) return { name: 'Plata', color: '#c0c0c8' };
  return { name: 'Bronce', color: '#cd8f52' };
}

const avatarHtml = (url, emoji, size = 34) => url
  ? `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(url)}" alt="" />`
  : `<span class="avatar-emoji" style="font-size:${Math.round(size * .68)}px">${esc(emoji || '💪')}</span>`;

// ─── Estado ───────────────────────────────────────────────
let state = {
  tab: 'workouts',
  me: null,            // { id, email }
  profile: null,       // fila de profiles
  logs: [],
  routines: [],
  editingLog: null,    // editor de entrenamiento
  editingRoutine: null,
  progressExercise: null,
};

// ─── Navegación por hash (recordar pestaña, botón atrás del navegador) ──
const TAB_TITLES = { workouts: 'Entrenamientos', routines: 'Rutinas', progress: 'Progreso', friends: 'Amigos', profile: 'Perfil' };
function getTabFromHash() {
  const h = (location.hash || '').replace(/^#\/?/, '');
  return TAB_TITLES[h] ? h : 'workouts';
}

// ─── Sesión caducada → volver al login (en vez de "Error" genérico) ──
async function handleMaybeAuthError(error) {
  const m = `${error?.message ?? ''} ${error?.code ?? ''}`;
  if (/jwt|token|expired|not authenticated|refresh|PGRST301|invalid claim|401/i.test(m)) {
    toast('Tu sesión ha caducado, vuelve a entrar', true);
    await supabase.auth.signOut();
    return true;
  }
  return false;
}

// ─── Modal reutilizable (reemplaza a prompt()/confirm() nativos) ──
function openModal(title, bodyHtml, onConfirm, confirmLabel = 'Guardar') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>${title}</h3>
      <div class="modal-body">${bodyHtml}</div>
      <button class="btn btn-primary" data-ok>${esc(confirmLabel)}</button>
      <button class="btn btn-ghost" data-cancel>Cancelar</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); overlay.querySelector('[data-ok]').click(); }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-ok]').addEventListener('click', () => onConfirm(close));
  setTimeout(() => overlay.querySelector('input,textarea,select')?.focus(), 30);
  return close;
}

// ─── Autocompletado de ejercicios (nombres que el usuario ya usó) ──
function collectExerciseNames() {
  const set = new Set();
  for (const l of state.logs) { const n = (l.exercise_name || '').trim(); if (n) set.add(n); }
  for (const r of state.routines) for (const it of (r.items || [])) { const n = (it.exerciseName || '').trim(); if (n) set.add(n); }
  return [...set].sort((a, b) => a.localeCompare(b));
}
function exListHtml() {
  return `<datalist id="exList">${collectExerciseNames().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>`;
}

// ─── Arranque ─────────────────────────────────────────────
(async function init() {
  state.tab = getTabFromHash();
  const { data } = await supabase.auth.getSession();
  if (data.session) renderApp(); else renderLogin();
  supabase.auth.onAuthStateChange((_e, session) => {
    if (session) { if (!document.querySelector('.topbar')) renderApp(); }
    else renderLogin();
  });
  // Botón atrás/adelante del navegador y recarga: mantener la pestaña.
  window.addEventListener('hashchange', () => {
    const t = getTabFromHash();
    if (t !== state.tab && document.querySelector('.topbar')) {
      state.tab = t; state.editingLog = null; state.editingRoutine = null;
      renderApp();
    }
  });
})();

// ─── Login ────────────────────────────────────────────────
function renderLogin() {
  view.innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <div class="auth-logo">Gym<i>Speak</i></div>
        <div class="auth-sub">Panel · tu gimnasio, desde el PC</div>
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
        <div class="divider"><span>o</span></div>
        <button class="btn btn-google" id="googleBtn" type="button">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.5 24 4.5 13.2 4.5 4.5 13.2 4.5 24S13.2 43.5 24 43.5 43.5 34.8 43.5 24c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.5 29.3 4.5 24 4.5 16.3 4.5 9.7 8.9 6.3 14.7z"/><path fill="#4CAF50" d="M24 43.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39 16.2 43.5 24 43.5z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2c-.4.4 6.6-4.8 6.6-14.7 0-1.2-.1-2.3-.4-3.5z"/></svg>
          Continuar con Google
        </button>
        <div class="auth-note">Usa la misma cuenta que en la app de GymSpeak.<br/>Todo se sincroniza solo.</div>
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

  document.getElementById('googleBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('loginError');
    errEl.textContent = '';
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) errEl.textContent = error.message || 'No se pudo iniciar con Google.';
  });
}

// ─── Shell (cabecera + tabs) ─────────────────────────────
const TABS = Object.entries(TAB_TITLES);

async function renderApp() {
  const { data } = await supabase.auth.getUser();
  if (!data?.user) return renderLogin();
  state.me = { id: data.user.id, email: data.user.email ?? '' };
  document.title = `GymSpeak · ${TAB_TITLES[state.tab] ?? 'Panel'}`;

  view.innerHTML = `
    <div class="topbar">
      <div class="topbar-inner">
        <div class="logo">Gym<i>Speak</i></div>
        <div class="right">
          <span class="email">${esc(state.me.email)}</span>
          <button class="btn btn-ghost btn-sm" id="logoutBtn">Salir</button>
        </div>
      </div>
    </div>
    <div class="tabs">
      ${TABS.map(([k, l]) => `<div class="tab ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</div>`).join('')}
    </div>
    <div class="wrap" id="content"></div>`;

  document.getElementById('logoutBtn').addEventListener('click', () => supabase.auth.signOut());
  view.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      if (t.dataset.tab === state.tab) return;
      // Cambiar el hash dispara el render (listener de hashchange); así el
      // botón "atrás" del navegador y la recarga recuerdan la pestaña.
      location.hash = t.dataset.tab;
    })
  );

  const r = { workouts: renderWorkouts, routines: renderRoutines, progress: renderProgress, friends: renderFriends, profile: renderProfile }[state.tab];
  r();
}

// ═══════════════════════════════════════════════════════════
// ENTRENAMIENTOS — crear / editar / borrar / completar
// ═══════════════════════════════════════════════════════════

async function loadLogs(limit = 400) {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('id, exercise_name, sets_details, weight_unit, duration, notes, logged_at, completed')
    .eq('user_id', state.me.id)
    .order('logged_at', { ascending: false })
    .limit(limit);
  if (error) { if (!(await handleMaybeAuthError(error))) toast('Error al cargar entrenamientos', true); return []; }
  return (data ?? []).map((l) => ({ ...l, sets: parseSets(l.sets_details) }));
}

async function renderWorkouts() {
  const content = document.getElementById('content');
  if (state.editingLog) return renderLogEditor();

  content.innerHTML = `<div class="loading">Cargando…</div>`;
  state.logs = await loadLogs();

  // Agrupar por día (mismas referencias que state.logs)
  const byDay = {};
  for (const l of state.logs) {
    const key = (l.logged_at || '').slice(0, 10);
    (byDay[key] ??= []).push(l);
  }
  state._byDay = byDay;

  // Día y mes seleccionados (por defecto, el último día con datos)
  if (!state.selectedDay) {
    const latest = Object.keys(byDay).sort().pop();
    state.selectedDay = latest || todayKey();
  }
  if (!state.calMonth) state.calMonth = state.selectedDay.slice(0, 7);

  content.innerHTML = `
    <div class="head">
      <h1>Entrenamientos</h1>
      <button class="btn btn-primary btn-sm" id="newLog">+ Añadir ejercicio</button>
    </div>
    <div id="calendar"></div>
    <div id="dayDetail"></div>`;

  document.getElementById('newLog').addEventListener('click', openNewLog);
  renderCalendar();
  renderDayDetail();
}

function openNewLog() {
  state.editingLog = {
    id: null, exercise_name: '', notes: '', completed: true,
    date: state.selectedDay || todayKey(),
    sets: [{ id: `set_${uid()}`, reps: null, weight: null }],
    weight_unit: state.profile?.weight_unit ?? 'kg',
  };
  renderWorkouts();
}

function renderCalendar() {
  const el = document.getElementById('calendar');
  const [y, m] = state.calMonth.split('-').map(Number); // m: 1-12
  const first = new Date(y, m - 1, 1);
  const monthName = first.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const startOffset = (first.getDay() + 6) % 7; // lunes primero
  const daysInMonth = new Date(y, m, 0).getDate();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const has = !!state._byDay[key];
    const isToday = key === todayKey();
    const isSel = key === state.selectedDay;
    cells.push(`<button class="cal-cell ${has ? 'has' : ''} ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''}" data-day="${key}">
      <span class="d">${d}</span>${has ? '<span class="dot"></span>' : ''}
    </button>`);
  }

  el.innerHTML = `
    <div class="cal card">
      <div class="cal-head">
        <button class="cal-nav" data-nav="-1" aria-label="Mes anterior">‹</button>
        <span class="cal-title">${esc(monthName)}</span>
        <button class="cal-nav" data-nav="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="cal-grid cal-dow">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </div>`;

  el.querySelectorAll('[data-nav]').forEach((b) =>
    b.addEventListener('click', () => {
      let [yy, mm] = state.calMonth.split('-').map(Number);
      mm += +b.dataset.nav;
      if (mm < 1) { mm = 12; yy--; }
      if (mm > 12) { mm = 1; yy++; }
      state.calMonth = `${yy}-${String(mm).padStart(2, '0')}`;
      renderCalendar();
    })
  );
  el.querySelectorAll('[data-day]').forEach((b) =>
    b.addEventListener('click', () => {
      state.selectedDay = b.dataset.day;
      renderCalendar();
      renderDayDetail();
    })
  );
}

function renderDayDetail() {
  const el = document.getElementById('dayDetail');
  const logs = state._byDay[state.selectedDay] || [];
  const done = logs.filter((l) => l.completed).length;

  const rows = logs.map((l) => `
    <div class="log">
      <button class="check ${l.completed ? 'done' : ''}" data-toggle="${l.id}" title="${l.completed ? 'Hecho' : 'Pendiente'}">${l.completed ? '✓' : ''}</button>
      <div class="info" data-open="${l.id}">
        <div class="name">${esc(l.exercise_name ?? '')}</div>
        <div class="sum">${esc(setsSummary(l.sets, l.weight_unit))}${l.notes ? ' · 📝' : ''}</div>
      </div>
      <button class="mini-btn" data-open="${l.id}">Editar</button>
      <button class="mini-btn danger" data-del="${l.id}">✕</button>
    </div>`).join('');

  el.innerHTML = `
    <div class="day-detail-head">
      <span class="dd-title">${esc(formatDay(state.selectedDay))}</span>
      ${logs.length ? `<span class="dd-meta">${logs.length} ${logs.length === 1 ? 'ejercicio' : 'ejercicios'} · ${done} ${done === 1 ? 'hecho' : 'hechos'}</span>` : ''}
    </div>
    ${logs.length ? rows : `<div class="empty" style="padding:40px 20px">No hay ejercicios este día.<br/><button class="btn btn-ghost btn-sm" id="addHere" style="margin-top:14px">+ Añadir uno</button></div>`}`;

  const addHere = document.getElementById('addHere');
  if (addHere) addHere.addEventListener('click', openNewLog);

  el.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      const log = (state._byDay[state.selectedDay] || []).find((l) => l.id === b.dataset.toggle);
      // Un día futuro se puede planificar, pero no marcar hecho hasta que llegue.
      if (!log.completed && state.selectedDay > todayKey()) {
        return toast('Aún no ha llegado ese día', true);
      }
      const { error } = await supabase.from('workout_logs').update({ completed: !log.completed }).eq('id', log.id);
      if (error) return toast('No se pudo actualizar', true);
      log.completed = !log.completed; // misma referencia que state.logs
      renderDayDetail();
    })
  );
  el.querySelectorAll('[data-open]').forEach((elm) =>
    elm.addEventListener('click', () => {
      const l = state.logs.find((x) => x.id === elm.dataset.open);
      state.editingLog = {
        id: l.id, exercise_name: l.exercise_name ?? '', notes: l.notes ?? '',
        completed: !!l.completed, date: (l.logged_at || '').slice(0, 10),
        sets: l.sets.length ? l.sets.map((s) => ({ ...s })) : [{ id: `set_${uid()}`, reps: null, weight: null }],
        weight_unit: l.weight_unit ?? 'kg', logged_at: l.logged_at,
      };
      renderWorkouts();
    })
  );
  el.querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Borrar este ejercicio del historial?')) return;
      const { error } = await supabase.from('workout_logs').delete().eq('id', b.dataset.del);
      if (error) return toast('No se pudo borrar', true);
      toast('Borrado');
      renderWorkouts();
    })
  );
}

function setsSummary(sd, unit) {
  if (!sd.length) return 'Sin series registradas';
  const n = sd.length;
  const parts = [`${n} ${n === 1 ? 'serie' : 'series'}`];
  const reps = [...new Set(sd.map((s) => s.reps).filter((r) => r != null))];
  if (reps.length === 1) parts.push(`${reps[0]} reps`);
  const weights = sd.map((s) => s.weight).filter((w) => w != null);
  if (weights.length) parts.push(`${Math.max(...weights)} ${unit || 'kg'}`);
  return parts.join(' · ');
}

function renderLogEditor() {
  const content = document.getElementById('content');
  const l = state.editingLog;
  const isNew = !l.id;
  const unit = l.weight_unit || 'kg';

  const rows = l.sets.map((s, i) => `
    <div class="ex-row sets3" data-i="${i}">
      <span class="setn">Serie ${i + 1}</span>
      <input class="input" data-f="reps" inputmode="numeric" placeholder="Reps" value="${s.reps ?? ''}" />
      <input class="input" data-f="weight" inputmode="decimal" placeholder="Peso (${unit})" value="${s.weight ?? ''}" />
      <button class="del" data-del="${i}" title="Quitar serie">✕</button>
    </div>`).join('');

  content.innerHTML = `
    <div class="head"><h1>${isNew ? 'Añadir ejercicio' : 'Editar ejercicio'}</h1></div>
    <div class="card">
      <div class="form-grid">
        <div>
          <label class="lbl">Ejercicio</label>
          <input class="input" id="exName" list="exList" autocomplete="off" placeholder="Ej. Press de banca" value="${esc(l.exercise_name)}" />
        </div>${exListHtml()}
        <div>
          <label class="lbl">Fecha</label>
          <input class="input" type="date" id="exDate" value="${esc(l.date)}" max="${todayKey()}" />
        </div>
      </div>
      <div style="margin-top:16px">
        <label class="lbl">Series</label>
        <div id="setRows">${rows}</div>
        <button class="btn btn-ghost btn-sm" id="addSet" style="margin-top:4px">+ Añadir serie</button>
      </div>
      <div style="margin-top:16px">
        <label class="lbl">Notas</label>
        <textarea class="input" id="exNotes" rows="2" placeholder="Opcional: sensaciones, máquina, etc.">${esc(l.notes)}</textarea>
      </div>
      <label class="check-row" style="margin-top:14px">
        <input type="checkbox" id="exDone" ${l.completed ? 'checked' : ''} /> Marcado como hecho
      </label>
    </div>
    <div class="editor-actions">
      <button class="btn btn-primary" id="saveLog">Guardar</button>
      <button class="btn btn-ghost" id="cancelLog">Cancelar</button>
    </div>`;

  function syncInputs() {
    l.exercise_name = document.getElementById('exName').value;
    l.date = document.getElementById('exDate').value;
    l.notes = document.getElementById('exNotes').value;
    l.completed = document.getElementById('exDone').checked;
    l.sets = [...document.querySelectorAll('#setRows .ex-row')].map((row, i) => ({
      id: l.sets[i]?.id ?? `set_${uid()}`,
      ...l.sets[i],
      reps: row.querySelector('[data-f="reps"]').value,
      weight: row.querySelector('[data-f="weight"]').value,
    }));
  }

  document.getElementById('addSet').addEventListener('click', () => {
    syncInputs();
    const last = l.sets[l.sets.length - 1];
    l.sets.push({ id: `set_${uid()}`, reps: last?.reps ?? null, weight: last?.weight ?? null });
    renderLogEditor();
  });
  content.querySelectorAll('#setRows [data-del]').forEach((b) =>
    b.addEventListener('click', () => { syncInputs(); l.sets.splice(+b.dataset.del, 1); if (!l.sets.length) l.sets.push({ id: `set_${uid()}`, reps: null, weight: null }); renderLogEditor(); })
  );
  document.getElementById('cancelLog').addEventListener('click', () => { state.editingLog = null; renderWorkouts(); });
  document.getElementById('saveLog').addEventListener('click', async () => {
    syncInputs();
    const name = l.exercise_name.trim();
    if (!name) return toast('Ponle nombre al ejercicio', true);
    const sets = l.sets
      .map((s) => ({ id: s.id, reps: num(s.reps), weight: num(s.weight), time: s.time ?? null, distance: s.distance ?? null, ...(s.rir != null ? { rir: s.rir } : {}) }))
      .filter((s) => s.reps != null || s.weight != null || s.time != null || s.distance != null);

    // Fecha → ISO: si es hoy, ahora mismo; si es pasada, mediodía local
    let loggedAt;
    if (!isNew && l.date === (l.logged_at || '').slice(0, 10)) loggedAt = l.logged_at;
    else if (l.date === todayKey()) loggedAt = new Date().toISOString();
    else loggedAt = new Date(l.date + 'T12:00:00').toISOString();

    // Un día futuro se puede planificar, pero nunca guardar como hecho.
    if (l.date > todayKey()) l.completed = false;

    const btn = document.getElementById('saveLog');
    btn.disabled = true; btn.textContent = 'Guardando…';

    let error;
    if (isNew) {
      ({ error } = await supabase.from('workout_logs').insert({
        user_id: state.me.id,
        exercise_name: name,
        sets_details: JSON.stringify(sets),
        weight_unit: l.weight_unit || 'kg',
        duration: null,
        notes: l.notes.trim() || null,
        raw_transcription: 'Añadido desde el panel web',
        logged_at: loggedAt,
        completed: l.completed,
      }));
    } else {
      ({ error } = await supabase.from('workout_logs').update({
        exercise_name: name,
        sets_details: JSON.stringify(sets),
        notes: l.notes.trim() || null,
        logged_at: loggedAt,
        completed: l.completed,
      }).eq('id', l.id));
    }

    if (error) { toast('No se pudo guardar', true); btn.disabled = false; btn.textContent = 'Guardar'; return; }
    toast('Guardado');
    state.editingLog = null;
    renderWorkouts();
  });
}

// ═══════════════════════════════════════════════════════════
// RUTINAS — CRUD + días programados + aplicar a un día
// ═══════════════════════════════════════════════════════════

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // L M X J V S D (getDay: 0=Dom)
const DAY_LETTER = { 0: 'D', 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S' };

async function loadRoutines() {
  const { data, error } = await supabase
    .from('routines')
    .select('id, name, muscle_group, scheduled_days, created_at, routine_items(id, exercise_name, sets, reps, weight, weight_unit, duration, distance, sets_details, position, notes)')
    .eq('user_id', state.me.id)
    .order('created_at', { ascending: false });
  if (error) { if (!(await handleMaybeAuthError(error))) toast('Error al cargar rutinas', true); return []; }
  return (data ?? []).map((r) => ({
    id: r.id, name: r.name, muscleGroup: r.muscle_group,
    scheduledDays: r.scheduled_days ?? [],
    items: ((r.routine_items) ?? []).sort((a, b) => a.position - b.position).map((it) => ({
      exerciseName: it.exercise_name, sets: it.sets, reps: it.reps, weight: it.weight,
      weightUnit: it.weight_unit ?? 'kg', duration: it.duration, distance: it.distance,
      setsDetails: parseSets(it.sets_details), notes: it.notes,
    })),
  }));
}

async function renderRoutines() {
  const content = document.getElementById('content');
  if (state.editingRoutine) return renderRoutineEditor();

  content.innerHTML = `<div class="loading">Cargando rutinas…</div>`;
  state.routines = await loadRoutines();
  // Sembrar nombres de ejercicios para el autocompletado (sin bloquear).
  if (!state.logs.length) loadLogs().then((l) => { state.logs = l; }).catch(() => {});

  const list = state.routines.map((r) => {
    const days = DAY_ORDER.filter((d) => r.scheduledDays.includes(d)).map((d) => DAY_LETTER[d]).join(' ');
    return `
    <div class="card routine-card">
      <div class="info">
        <h3>${esc(r.name)}</h3>
        <div class="meta">${r.items.length} ${r.items.length === 1 ? 'ejercicio' : 'ejercicios'}${days ? ` · ${days}` : ''}</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" data-apply="${r.id}">Aplicar</button>
        <button class="btn btn-ghost btn-sm" data-edit="${r.id}">Editar</button>
      </div>
    </div>`;
  }).join('');

  content.innerHTML = `
    <div class="head">
      <h1>Rutinas</h1>
      <button class="btn btn-primary btn-sm" id="newRoutine">+ Nueva rutina</button>
    </div>
    ${state.routines.length ? list : `<div class="empty"><div class="big">Aún no tienes rutinas</div>Crea tu primera rutina y aparecerá también en la app.</div>`}`;

  document.getElementById('newRoutine').addEventListener('click', () => {
    state.editingRoutine = { id: null, name: '', scheduledDays: [], items: [] };
    renderRoutines();
  });
  content.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      state.editingRoutine = JSON.parse(JSON.stringify(state.routines.find((r) => r.id === b.dataset.edit)));
      renderRoutines();
    })
  );
  content.querySelectorAll('[data-apply]').forEach((b) =>
    b.addEventListener('click', () => applyRoutinePrompt(b.dataset.apply))
  );
}

function applyRoutinePrompt(routineId) {
  const r = state.routines.find((x) => x.id === routineId);
  if (!r) return;
  if (!r.items.length) return toast('Esta rutina no tiene ejercicios', true);

  openModal(`Aplicar "${esc(r.name)}"`, `
    <label class="lbl">¿A qué día lo aplicamos?</label>
    <input class="input" type="date" id="applyDate" value="${todayKey()}" />
    <p class="modal-hint">Se añadirán ${r.items.length} ${r.items.length === 1 ? 'ejercicio' : 'ejercicios'} a ese día (sin marcar como hechos).</p>
  `, async (close) => {
    const date = document.getElementById('applyDate').value;
    if (!date) return toast('Elige una fecha', true);
    await applyRoutineToDate(r, date);
    close();
    if (state.tab === 'workouts') { state.selectedDay = date; renderWorkouts(); }
  }, 'Aplicar');
}

async function applyRoutineToDate(r, date) {
  const iso = date === todayKey() ? new Date().toISOString() : new Date(date + 'T12:00:00').toISOString();
  const rows = r.items.map((item, i) => {
    const sd = (item.setsDetails && item.setsDetails.length)
      ? item.setsDetails.map((s, idx) => ({ ...s, id: `set_${Date.now()}_${i}_${idx}` }))
      : Array.from({ length: item.sets ?? 1 }).map((_, idx) => ({
          id: `set_${Date.now()}_${i}_${idx}`, reps: item.reps ?? null, weight: item.weight ?? null, time: null, distance: item.distance ?? null,
        }));
    return {
      user_id: state.me.id,
      exercise_name: item.exerciseName,
      sets_details: JSON.stringify(sd),
      weight_unit: item.weightUnit || 'kg',
      duration: item.duration ?? null,
      notes: item.notes ?? null,
      raw_transcription: `Aplicado desde rutina: ${r.name}`,
      logged_at: iso,
      completed: false,
    };
  });
  const { error } = await supabase.from('workout_logs').insert(rows);
  if (error) { if (!(await handleMaybeAuthError(error))) toast('No se pudo aplicar', true); return; }
  toast(`Rutina aplicada a ${date === todayKey() ? 'hoy' : date}`);
}

function renderRoutineEditor() {
  const content = document.getElementById('content');
  const r = state.editingRoutine;
  const isNew = !r.id;

  const rows = r.items.map((it, i) => `
    <div class="ex-row" data-i="${i}">
      <input class="input" data-f="exerciseName" list="exList" autocomplete="off" placeholder="Ejercicio" value="${esc(it.exerciseName ?? '')}" />
      <input class="input" data-f="sets" inputmode="numeric" placeholder="Series" value="${it.sets ?? ''}" />
      <input class="input" data-f="reps" inputmode="numeric" placeholder="Reps" value="${it.reps ?? ''}" />
      <input class="input" data-f="weight" inputmode="decimal" placeholder="Peso" value="${it.weight ?? ''}" />
      <button class="del" data-del="${i}" title="Quitar">✕</button>
    </div>`).join('');

  const chips = DAY_ORDER.map((d) => `
    <button type="button" class="chip-day ${r.scheduledDays.includes(d) ? 'on' : ''}" data-day="${d}">${DAY_LETTER[d]}</button>`).join('');

  content.innerHTML = `
    <div class="head"><h1>${isNew ? 'Nueva rutina' : 'Editar rutina'}</h1></div>
    <div class="card">
      <label class="lbl">Nombre de la rutina</label>
      <input class="input" id="routineName" placeholder="Ej. Pierna, Push, Full body…" value="${esc(r.name ?? '')}" />
      <div style="margin-top:16px">
        <label class="lbl">Programada para (se auto-aplica esos días en la app)</label>
        <div class="chips">${chips}</div>
      </div>
    </div>
    <div style="margin-top:18px">
      <div class="ex-head"><span>Ejercicio</span><span>Series</span><span>Reps</span><span>Peso</span><span></span></div>
      <div id="exRows">${rows}</div>
      <button class="btn btn-ghost btn-sm" id="addEx" style="margin-top:6px">+ Añadir ejercicio</button>
    </div>${exListHtml()}
    <div class="editor-actions">
      <button class="btn btn-primary" id="saveRoutine">Guardar</button>
      <button class="btn btn-ghost" id="cancelEdit">Cancelar</button>
      <span class="spacer"></span>
      ${isNew ? '' : '<button class="btn btn-danger" id="deleteRoutine">Borrar rutina</button>'}
    </div>`;

  function syncFromInputs() {
    r.name = document.getElementById('routineName').value;
    r.items = [...document.querySelectorAll('#exRows .ex-row')].map((row, i) => ({
      ...r.items[i],
      exerciseName: row.querySelector('[data-f="exerciseName"]').value,
      sets: row.querySelector('[data-f="sets"]').value,
      reps: row.querySelector('[data-f="reps"]').value,
      weight: row.querySelector('[data-f="weight"]').value,
    }));
  }

  content.querySelectorAll('.chip-day').forEach((c) =>
    c.addEventListener('click', () => {
      const d = +c.dataset.day;
      syncFromInputs();
      if (r.scheduledDays.includes(d)) r.scheduledDays = r.scheduledDays.filter((x) => x !== d);
      else r.scheduledDays.push(d);
      renderRoutineEditor();
    })
  );
  document.getElementById('addEx').addEventListener('click', () => {
    syncFromInputs();
    r.items.push({ exerciseName: '', sets: '', reps: '', weight: '' });
    renderRoutineEditor();
  });
  content.querySelectorAll('#exRows [data-del]').forEach((b) =>
    b.addEventListener('click', () => { syncFromInputs(); r.items.splice(+b.dataset.del, 1); renderRoutineEditor(); })
  );
  document.getElementById('cancelEdit').addEventListener('click', () => { state.editingRoutine = null; renderRoutines(); });
  document.getElementById('saveRoutine').addEventListener('click', () => { syncFromInputs(); saveRoutine(); });
  const delBtn = document.getElementById('deleteRoutine');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('¿Borrar esta rutina? No se puede deshacer.')) return;
    const { error } = await supabase.from('routines').delete().eq('id', r.id);
    if (error) return toast('No se pudo borrar', true);
    toast('Rutina borrada');
    state.editingRoutine = null;
    renderRoutines();
  });
}

async function saveRoutine() {
  const r = state.editingRoutine;
  const name = (r.name || '').trim();
  if (!name) return toast('Ponle un nombre a la rutina', true);

  const items = r.items
    .filter((it) => (it.exerciseName || '').trim())
    .map((it) => ({
      exercise_name: it.exerciseName.trim(),
      sets: num(it.sets), reps: num(it.reps), weight: num(it.weight),
      weight_unit: it.weightUnit || 'kg', duration: it.duration ?? null, distance: it.distance ?? null,
      sets_details: Array.isArray(it.setsDetails) ? it.setsDetails : [], notes: it.notes ?? null,
    }));

  const btn = document.getElementById('saveRoutine');
  btn.disabled = true; btn.textContent = 'Guardando…';

  let routineId = r.id;
  if (!routineId) {
    const { data, error } = await supabase
      .from('routines').insert({ user_id: state.me.id, name, scheduled_days: r.scheduledDays }).select('id').single();
    if (error) { toast('No se pudo crear la rutina', true); btn.disabled = false; btn.textContent = 'Guardar'; return; }
    routineId = data.id;
  } else {
    const { error } = await supabase.from('routines').update({ name, scheduled_days: r.scheduledDays }).eq('id', routineId);
    if (error) { toast('No se pudo guardar', true); btn.disabled = false; btn.textContent = 'Guardar'; return; }
  }

  const { error: rpcErr } = await supabase.rpc('replace_routine_exercises', { p_routine_id: routineId, p_items: items });
  if (rpcErr) { toast('Error al guardar los ejercicios', true); btn.disabled = false; btn.textContent = 'Guardar'; return; }

  toast('Rutina guardada');
  state.editingRoutine = null;
  renderRoutines();
}

// ═══════════════════════════════════════════════════════════
// PROGRESO — gráfica por ejercicio (mejor serie por día)
// ═══════════════════════════════════════════════════════════

async function renderProgress() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading">Cargando progreso…</div>`;
  if (!state.logs.length) state.logs = await loadLogs();

  // Ejercicios con algún peso registrado, ordenados por frecuencia
  const freq = {};
  for (const l of state.logs) {
    if (l.sets.some((s) => s.weight != null)) {
      const k = (l.exercise_name || '').trim();
      if (k) freq[k] = (freq[k] || 0) + 1;
    }
  }
  const exercises = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);

  if (!exercises.length) {
    content.innerHTML = `<div class="head"><h1>Progreso</h1></div>
      <div class="empty"><div class="big">Aún no hay datos de peso</div>Registra ejercicios con peso y aquí verás tu evolución.</div>`;
    return;
  }
  if (!state.progressExercise || !exercises.includes(state.progressExercise)) state.progressExercise = exercises[0];

  const sel = state.progressExercise;
  // Serie temporal: mejor peso y mejor e1RM por día (ascendente)
  const byDay = {};
  for (const l of state.logs) {
    if ((l.exercise_name || '').trim() !== sel) continue;
    const day = (l.logged_at || '').slice(0, 10);
    for (const s of l.sets) {
      if (s.weight == null) continue;
      const d = (byDay[day] ??= { w: 0, e: 0 });
      d.w = Math.max(d.w, s.weight);
      d.e = Math.max(d.e, e1rm(s.weight, s.reps ?? 1));
    }
  }
  const days = Object.keys(byDay).sort();
  const points = days.map((d) => ({ day: d, w: byDay[d].w, e: byDay[d].e }));
  const unit = state.profile?.weight_unit ?? state.logs.find((l) => (l.exercise_name || '').trim() === sel)?.weight_unit ?? 'kg';

  const best = Math.max(...points.map((p) => p.w));
  const bestE = Math.max(...points.map((p) => p.e));
  const sessions = points.length;

  content.innerHTML = `
    <div class="head"><h1>Progreso</h1></div>
    <select class="input select" id="exSelect">
      ${exercises.map((e) => `<option ${e === sel ? 'selected' : ''}>${esc(e)}</option>`).join('')}
    </select>
    <div class="stats-row">
      <div class="stat"><div class="n">${best} ${esc(unit)}</div><div class="l">Mejor marca</div></div>
      <div class="stat"><div class="n">${bestE} ${esc(unit)}</div><div class="l">Mejor 1RM estimado</div></div>
      <div class="stat"><div class="n">${sessions}</div><div class="l">Días entrenado</div></div>
    </div>
    <div class="card chart-card">
      <div class="lbl" style="margin-bottom:10px">Mejor serie por día (${esc(unit)})</div>
      ${chartSvg(points)}
    </div>`;

  document.getElementById('exSelect').addEventListener('change', (e) => {
    state.progressExercise = e.target.value;
    renderProgress();
  });
}

function chartSvg(points) {
  if (points.length < 2) return `<div class="empty" style="padding:30px">Necesitas al menos 2 días con este ejercicio para ver la gráfica.</div>`;
  const W = 640, H = 220, P = 34;
  const ws = points.map((p) => p.w);
  const min = Math.min(...ws), max = Math.max(...ws);
  const span = (max - min) || 1;
  const x = (i) => P + (i / (points.length - 1)) * (W - P * 2);
  const y = (w) => H - P - ((w - min) / span) * (H - P * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
  const dots = points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="3.5" fill="#5ad67d"/>`).join('');
  const first = points[0].day.slice(5), last = points[points.length - 1].day.slice(5);
  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Gráfica de progreso">
      <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#26262c" stroke-width="1"/>
      <text x="${P}" y="${H - P + 18}" fill="#6a6a73" font-size="11">${first}</text>
      <text x="${W - P}" y="${H - P + 18}" fill="#6a6a73" font-size="11" text-anchor="end">${last}</text>
      <text x="${P - 6}" y="${y(max) + 4}" fill="#6a6a73" font-size="11" text-anchor="end">${max}</text>
      <text x="${P - 6}" y="${y(min) + 4}" fill="#6a6a73" font-size="11" text-anchor="end">${min}</text>
      <path d="${path}" fill="none" stroke="#5ad67d" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
}

// ═══════════════════════════════════════════════════════════
// AMIGOS — ranking, solicitudes, lista y búsqueda
// ═══════════════════════════════════════════════════════════

async function renderFriends() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading">Cargando amigos…</div>`;

  const [lbRes, pendRes, friendsRes] = await Promise.all([
    supabase.rpc('get_friends_leaderboard'),
    supabase.from('friendships')
      .select('id, requester_id, requester:profiles!friendships_requester_id_fkey(id, display_name, username, avatar_emoji, avatar_url)')
      .eq('addressee_id', state.me.id).eq('status', 'pending'),
    supabase.from('friendships')
      .select('id, requester_id, addressee_id, requester:profiles!friendships_requester_id_fkey(id, display_name, username, avatar_emoji, avatar_url), addressee:profiles!friendships_addressee_id_fkey(id, display_name, username, avatar_emoji, avatar_url)')
      .or(`requester_id.eq.${state.me.id},addressee_id.eq.${state.me.id}`).eq('status', 'accepted'),
  ]);

  const lb = lbRes.data ?? [];
  const pending = (pendRes.data ?? []);
  const friends = (friendsRes.data ?? []).map((f) => {
    const other = f.requester_id === state.me.id ? f.addressee : f.requester;
    return { friendshipId: f.id, ...other };
  });

  const label = (p) => p?.display_name || (p?.username ? '@' + p.username : 'Anónimo');

  const lbHtml = lb.length < 2 ? '' : `
    <div class="subhead">Clasificación</div>
    <div class="card" style="padding:10px 14px">
      ${lb.map((row, i) => {
        const tier = scoreToTier(row.strength_score);
        const isMe = row.id === state.me.id;
        return `
        <div class="lb-row ${isMe ? 'me' : ''}">
          <span class="pos">${i + 1}</span>
          ${avatarHtml(row.avatar_url, row.avatar_emoji, 32)}
          <span class="lb-name">${esc(isMe ? 'Tú' : label(row))}</span>
          <span class="lb-tier" style="color:${tier ? tier.color : 'var(--faint)'}">${tier ? tier.name : 'Sin clasificar'}</span>
        </div>`;
      }).join('')}
    </div>`;

  const pendHtml = !pending.length ? '' : `
    <div class="subhead">Solicitudes</div>
    ${pending.map((p) => `
      <div class="card friend-row">
        ${avatarHtml(p.requester?.avatar_url, p.requester?.avatar_emoji)}
        <div class="info"><div class="name">${esc(label(p.requester))}</div><div class="sum">quiere ser tu amigo</div></div>
        <button class="btn btn-primary btn-sm" data-acc="${p.id}">Aceptar</button>
        <button class="btn btn-ghost btn-sm" data-rej="${p.id}">Rechazar</button>
      </div>`).join('')}`;

  const friendsHtml = `
    <div class="subhead">Mis amigos (${friends.length})</div>
    ${friends.length ? friends.map((f) => `
      <div class="card friend-row">
        ${avatarHtml(f.avatar_url, f.avatar_emoji)}
        <div class="info"><div class="name">${esc(label(f))}</div>${f.username ? `<div class="sum">@${esc(f.username)}</div>` : ''}</div>
        <button class="btn btn-danger btn-sm" data-unfriend="${f.friendshipId}">Eliminar</button>
      </div>`).join('') : `<div class="empty" style="padding:24px">Todavía no tienes amigos agregados.</div>`}`;

  content.innerHTML = `
    <div class="head"><h1>Amigos</h1></div>
    <div class="searchbar">
      <input class="input" id="friendSearch" placeholder="Buscar gente por nombre o @usuario…" autocomplete="off" />
    </div>
    <div id="searchResults"></div>
    ${lbHtml}
    ${pendHtml}
    ${friendsHtml}`;

  // Buscar (incremental, por prefijo — misma RPC que la app)
  const searchInput = document.getElementById('friendSearch');
  const resultsEl = document.getElementById('searchResults');
  let searchSeq = 0;
  searchInput.addEventListener('input', async () => {
    const q = searchInput.value.replace(/^@/, '').trim();
    const seq = ++searchSeq;
    if (!q) { resultsEl.innerHTML = ''; return; }
    const { data } = await supabase.rpc('search_profiles_by_username', { search_term: q });
    if (seq !== searchSeq) return; // llegó tarde, ya se escribió más
    const friendIds = new Set(friends.map((f) => f.id));
    const rows = (data ?? []).filter((p) => p.id !== state.me.id);
    resultsEl.innerHTML = rows.length ? rows.map((p) => `
      <div class="card friend-row">
        ${avatarHtml(p.avatar_url, p.avatar_emoji)}
        <div class="info"><div class="name">${esc(label(p))}</div>${p.username ? `<div class="sum">@${esc(p.username)}</div>` : ''}</div>
        ${friendIds.has(p.id)
          ? '<span class="sum">Ya sois amigos</span>'
          : `<button class="btn btn-primary btn-sm" data-add="${p.id}">Agregar</button>`}
      </div>`).join('') : `<div class="empty" style="padding:18px">Sin resultados para "${esc(q)}"</div>`;

    resultsEl.querySelectorAll('[data-add]').forEach((b) =>
      b.addEventListener('click', async () => {
        const { error } = await supabase.from('friendships')
          .insert({ requester_id: state.me.id, addressee_id: b.dataset.add, status: 'pending' });
        if (error) return toast(error.code === '23505' ? 'Ya le enviaste solicitud' : 'No se pudo enviar', true);
        b.replaceWith(Object.assign(document.createElement('span'), { className: 'sum', textContent: 'Solicitud enviada' }));
        toast('Solicitud enviada');
      })
    );
  });

  content.querySelectorAll('[data-acc]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { error } = await supabase.from('friendships').update({ status: 'accepted' }).eq('id', b.dataset.acc);
      if (error) return toast('No se pudo aceptar', true);
      toast('Solicitud aceptada');
      renderFriends();
    })
  );
  content.querySelectorAll('[data-rej]').forEach((b) =>
    b.addEventListener('click', async () => {
      const { error } = await supabase.from('friendships').update({ status: 'rejected' }).eq('id', b.dataset.rej);
      if (error) return toast('No se pudo rechazar', true);
      renderFriends();
    })
  );
  content.querySelectorAll('[data-unfriend]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar a este amigo?')) return;
      const { error } = await supabase.from('friendships').delete().eq('id', b.dataset.unfriend);
      if (error) return toast('No se pudo eliminar', true);
      toast('Amigo eliminado');
      renderFriends();
    })
  );
}

// ═══════════════════════════════════════════════════════════
// PERFIL — datos de cuenta (los que viven en Supabase)
// ═══════════════════════════════════════════════════════════

const EMOJIS = ['💪', '🏋️', '🔥', '⚡', '🦍', '🐺', '🦁', '🐉', '👑', '🚀', '🥇', '😤'];

async function loadProfile() {
  const { data } = await supabase
    .from('profiles')
    .select('display_name, username, avatar_emoji, avatar_url, bio, weight_unit, public_calendar')
    .eq('id', state.me.id)
    .single();
  return data ?? {};
}

async function renderProfile() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="loading">Cargando perfil…</div>`;
  state.profile = await loadProfile();
  const p = state.profile;

  content.innerHTML = `
    <div class="head"><h1>Perfil</h1></div>
    <div class="card">
      <div class="form-grid">
        <div>
          <label class="lbl">Nombre visible</label>
          <input class="input" id="pName" maxlength="40" value="${esc(p.display_name ?? '')}" placeholder="Tu nombre" />
        </div>
        <div>
          <label class="lbl">Usuario</label>
          <input class="input" id="pUser" maxlength="24" value="${esc(p.username ?? '')}" placeholder="usuario (sin @)" />
        </div>
      </div>
      <div style="margin-top:14px">
        <label class="lbl">Bio</label>
        <textarea class="input" id="pBio" rows="2" maxlength="150" placeholder="Algo corto sobre ti">${esc(p.bio ?? '')}</textarea>
      </div>
      <div style="margin-top:14px">
        <label class="lbl">Emoji de avatar ${p.avatar_url ? '(tienes foto: el emoji es el respaldo)' : ''}</label>
        <div class="chips">
          ${EMOJIS.map((e) => `<button type="button" class="chip-day emoji ${p.avatar_emoji === e ? 'on' : ''}" data-emoji="${e}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div>
          <label class="lbl">Unidad de peso</label>
          <select class="input" id="pUnit">
            <option value="kg" ${p.weight_unit !== 'lb' ? 'selected' : ''}>Kilogramos (kg)</option>
            <option value="lb" ${p.weight_unit === 'lb' ? 'selected' : ''}>Libras (lb)</option>
          </select>
        </div>
        <div style="display:flex;align-items:flex-end">
          <label class="check-row"><input type="checkbox" id="pCal" ${p.public_calendar ? 'checked' : ''} /> Calendario visible para amigos</label>
        </div>
      </div>
    </div>
    <div class="editor-actions">
      <button class="btn btn-primary" id="saveProfile">Guardar perfil</button>
    </div>
    <div class="auth-note" style="text-align:left;margin-top:18px">
      El peso corporal, el sexo y el objetivo de entrenamiento se configuran en la app
      (pantalla del Entrenador), igual que la suscripción Pro.
    </div>`;

  let emoji = p.avatar_emoji ?? '💪';
  content.querySelectorAll('[data-emoji]').forEach((b) =>
    b.addEventListener('click', () => {
      emoji = b.dataset.emoji;
      content.querySelectorAll('[data-emoji]').forEach((x) => x.classList.toggle('on', x === b));
    })
  );

  document.getElementById('saveProfile').addEventListener('click', async () => {
    const btn = document.getElementById('saveProfile');
    const name = document.getElementById('pName').value.trim();
    const username = document.getElementById('pUser').value.trim().toLowerCase().replace(/^@/, '');
    const bio = document.getElementById('pBio').value.trim();
    const unit = document.getElementById('pUnit').value;
    const cal = document.getElementById('pCal').checked;

    if (username && !/^[a-z0-9_.]{3,24}$/.test(username)) {
      return toast('Usuario: 3-24 caracteres (letras, números, _ o .)', true);
    }
    btn.disabled = true; btn.textContent = 'Guardando…';

    // ¿Usuario ya cogido? (excluyéndome)
    if (username && username !== (p.username ?? '')) {
      const { data: taken } = await supabase.from('profiles').select('id').eq('username', username);
      if ((taken ?? []).some((row) => row.id !== state.me.id)) {
        toast('Ese usuario ya está cogido', true);
        btn.disabled = false; btn.textContent = 'Guardar perfil';
        return;
      }
    }

    const { error } = await supabase.from('profiles').update({
      display_name: name || null,
      username: username || null,
      bio: bio || null,
      avatar_emoji: emoji,
      weight_unit: unit,
      public_calendar: cal,
    }).eq('id', state.me.id);

    if (error) { toast('No se pudo guardar', true); btn.disabled = false; btn.textContent = 'Guardar perfil'; return; }
    toast('Perfil guardado');
    renderProfile();
  });
}
