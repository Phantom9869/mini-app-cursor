(function () {
  'use strict';

  const api = globalThis.PomodoroTimer;
  if (!api) throw new Error('timer.js failed to load');

  const { createTimer, formatTime, clampMinutes } = api;
  const STORAGE_KEY = 'focus-pomodoro-v1';
  const RING_RADIUS = 52;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const MAX_TASKS = 100;

  const CHECK_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5 8 14l7.5-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TRASH_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6.5h11M8 6.5V5h4v1.5M7 6.5l.6 9h4.8l.6-9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const els = {
    mode: document.getElementById('mode-label'),
    pulse: document.getElementById('pulse'),
    time: document.getElementById('time'),
    status: document.getElementById('status'),
    toggle: document.getElementById('toggle'),
    reset: document.getElementById('reset'),
    work: document.getElementById('work-minutes'),
    break: document.getElementById('break-minutes'),
    durations: document.getElementById('durations'),
    form: document.getElementById('task-form'),
    input: document.getElementById('task-input'),
    list: document.getElementById('task-list'),
    empty: document.getElementById('empty'),
    meta: document.getElementById('tasks-meta'),
    sessions: document.getElementById('sessions'),
    attached: document.getElementById('attached'),
    ring: document.getElementById('ring'),
  };

  let tasks = [];
  let activeTaskId = null;
  let banner = null;
  let timer = createTimer();
  let ticker = 0;
  let audioCtx = null;
  let lastSaved = '';

  function uid() {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function pomodoroLabel(count) {
    return count === 1 ? '1 pomodoro' : count + ' pomodoros';
  }

  function sessionLabel(count) {
    if (count === 0) return 'No work sessions yet';
    if (count === 1) return '1 work session';
    return count + ' work sessions';
  }

  function normalizeTask(task) {
    if (!task || typeof task !== 'object') return null;
    if (typeof task.id !== 'string' || !task.id) return null;
    if (typeof task.title !== 'string') return null;
    const title = task.title.trim().slice(0, 140);
    if (!title) return null;
    const pomodoros = Number.isFinite(Number(task.pomodoros))
      ? Math.max(0, Math.floor(Number(task.pomodoros)))
      : 0;
    return { id: task.id, title: title, done: Boolean(task.done), pomodoros: pomodoros };
  }

  function readStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return null;
      return data;
    } catch (err) {
      return null;
    }
  }

  function hydrate() {
    const saved = readStorage();
    if (!saved) return;
    tasks = Array.isArray(saved.tasks) ? saved.tasks.map(normalizeTask).filter(Boolean) : [];
    activeTaskId = typeof saved.activeTaskId === 'string' ? saved.activeTaskId : null;
    if (!tasks.some(function (task) { return task.id === activeTaskId; })) {
      const firstOpen = tasks.find(function (task) { return !task.done; });
      activeTaskId = firstOpen ? firstOpen.id : null;
    }
    const settings = saved.settings && typeof saved.settings === 'object' ? saved.settings : {};
    const timerState = saved.timer && typeof saved.timer === 'object' ? saved.timer : {};
    timer = createTimer({
      workMinutes: settings.workMinutes,
      breakMinutes: settings.breakMinutes,
      mode: timerState.mode,
      remainingSeconds: timerState.remainingSeconds,
      completedPomodoros: timerState.completedPomodoros,
    });
    banner = typeof saved.banner === 'string' ? saved.banner.slice(0, 180) : null;
    const endsAt = Number(timerState.endsAt);
    const remaining = Number(timerState.remainingSeconds);
    if (timerState.running === true && Number.isFinite(endsAt) && remaining > 0) {
      timer.start(endsAt - Math.floor(remaining) * 1000);
    }
  }

  function persist() {
    const state = timer.getState();
    const payload = {
      version: 1,
      tasks: tasks,
      activeTaskId: activeTaskId,
      banner: banner,
      settings: {
        workMinutes: state.workMinutes,
        breakMinutes: state.breakMinutes,
      },
      timer: {
        mode: state.mode,
        remainingSeconds: state.remainingSeconds,
        running: state.running,
        endsAt: state.endsAt,
        completedPomodoros: state.completedPomodoros,
      },
    };
    const serialized = JSON.stringify(payload);
    if (serialized === lastSaved) return;
    lastSaved = serialized;
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
    } catch (err) {
      /* Private mode or a full disk can reject the write. The session still runs. */
    }
  }

  function derivedStatus(state) {
    if (banner) return banner;
    const partial = state.remainingSeconds !== state.totalSeconds;
    if (state.mode === 'break') {
      if (state.running) return 'Step away for a bit.';
      if (partial) return 'Break paused.';
      return 'Break is ready.';
    }
    if (state.running) return 'Stay with this session.';
    if (partial) return 'Paused. Pick it back up when you want.';
    return 'A work session is ready.';
  }

  function attachedText() {
    const active = tasks.find(function (task) { return task.id === activeTaskId && !task.done; });
    if (active) return 'Counting toward “' + active.title + '”.';
    if (tasks.some(function (task) { return !task.done; })) return 'Select a task to attach finished sessions.';
    if (tasks.length) return 'All tasks are done.';
    return 'Add a task to collect finished sessions.';
  }

  function paint(state) {
    document.body.dataset.mode = state.mode;
    setText(els.mode, state.mode === 'work' ? 'Work' : 'Break');
    setText(els.time, formatTime(state.remainingSeconds));
    setText(els.status, derivedStatus(state));
    setText(els.sessions, sessionLabel(state.completedPomodoros));
    setText(els.toggle, state.running ? 'Pause' : 'Start');
    els.toggle.setAttribute('aria-pressed', state.running ? 'true' : 'false');
    els.pulse.hidden = !state.running;
    els.work.disabled = state.running;
    els.break.disabled = state.running;

    const ratio = state.totalSeconds > 0 ? state.remainingSeconds / state.totalSeconds : 0;
    const clamped = Math.max(0, Math.min(1, ratio));
    els.ring.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    els.ring.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped));
    els.ring.style.strokeLinecap = clamped >= 0.995 ? 'butt' : 'round';

    const partial = state.running || state.remainingSeconds !== state.totalSeconds;
    const label = state.mode === 'work' ? 'Work' : 'Break';
    const title = partial
      ? '(' + formatTime(state.remainingSeconds) + ') ' + label + ' — Focus'
      : 'Focus — Pomodoro';
    if (document.title !== title) document.title = title;
  }

  function renderTasks() {
    const open = tasks.filter(function (task) { return !task.done; });
    const done = tasks.filter(function (task) { return task.done; });
    els.empty.hidden = tasks.length !== 0;
    setText(els.meta, tasks.length === 0 ? 'None yet' : open.length + ' open · ' + done.length + ' done');
    setText(els.attached, attachedText());
    els.list.replaceChildren();

    function appendTask(task) {
      const li = document.createElement('li');
      li.className = 'task' + (task.done ? ' is-done' : '') + (task.id === activeTaskId && !task.done ? ' is-active' : '');
      li.dataset.id = task.id;

      const check = document.createElement('button');
      check.type = 'button';
      check.className = 'check';
      check.dataset.action = 'toggle-done';
      check.setAttribute('aria-pressed', task.done ? 'true' : 'false');
      check.setAttribute('aria-label', (task.done ? 'Mark not done: ' : 'Mark done: ') + task.title);
      check.innerHTML = CHECK_SVG;

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'task-select';
      select.dataset.action = 'select';
      if (task.done) select.disabled = true;
      if (task.id === activeTaskId && !task.done) select.setAttribute('aria-current', 'true');

      const row = document.createElement('span');
      row.className = 'task-title-row';
      const title = document.createElement('span');
      title.className = 'task-title';
      title.textContent = task.title;
      row.append(title);
      if (task.id === activeTaskId && !task.done) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'Now';
        row.append(badge);
      }

      const count = document.createElement('span');
      count.className = 'task-count';
      count.textContent = pomodoroLabel(task.pomodoros);
      select.append(row, count);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'icon-btn';
      del.dataset.action = 'delete';
      del.setAttribute('aria-label', 'Delete ' + task.title);
      del.innerHTML = TRASH_SVG;

      li.append(check, select, del);
      els.list.append(li);
    }

    open.forEach(appendTask);
    if (open.length && done.length) {
      const sep = document.createElement('li');
      sep.className = 'task-sep';
      sep.textContent = 'Done';
      els.list.append(sep);
    }
    done.forEach(appendTask);
  }

  function creditActiveTask() {
    let task = tasks.find(function (item) { return item.id === activeTaskId && !item.done; });
    if (!task) task = tasks.find(function (item) { return !item.done; });
    if (!task) return null;
    task.pomodoros += 1;
    activeTaskId = task.id;
    return task;
  }

  function chime(startFreq, endFreq) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = audioCtx || new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.22);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.045, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch (err) {
      /* Sound is optional. */
    }
  }

  function applyEvents(events) {
    events.forEach(function (event) {
      if (event.type !== 'phase-complete') return;
      if (event.mode === 'work') {
        const task = creditActiveTask();
        banner = task
          ? 'Work session saved to “' + task.title + '”. Break is ready.'
          : 'Work session complete. Break is ready.';
        chime(660, 520);
      } else {
        banner = 'Break finished. Another work session is ready.';
        chime(520, 660);
      }
    });
  }

  function ensureTicker(running) {
    if (running && !ticker) {
      ticker = window.setInterval(pulse, 200);
    } else if (!running && ticker) {
      window.clearInterval(ticker);
      ticker = 0;
    }
  }

  function pulse() {
    const result = timer.tick(Date.now());
    if (result.events.length) applyEvents(result.events);
    paint(timer.getState());
    if (result.events.length) renderTasks();
    persist();
    ensureTicker(timer.getState().running);
  }

  function onToggle() {
    const now = Date.now();
    const result = timer.tick(now);
    if (result.events.length) {
      applyEvents(result.events);
      paint(timer.getState());
      renderTasks();
      persist();
      ensureTicker(false);
      return;
    }
    banner = null;
    if (timer.getState().running) timer.pause(now);
    else timer.start(now);
    paint(timer.getState());
    persist();
    ensureTicker(timer.getState().running);
  }

  function onReset() {
    banner = null;
    timer.reset();
    paint(timer.getState());
    persist();
    ensureTicker(false);
  }

  function commitDuration(which) {
    const input = which === 'work' ? els.work : els.break;
    const key = which === 'work' ? 'workMinutes' : 'breakMinutes';
    const current = timer.getState()[key];
    const raw = input.value.trim();
    if (raw === '' || !Number.isFinite(Number(raw))) {
      input.value = String(current);
      return;
    }
    const next = clampMinutes(raw, current);
    input.value = String(next);
    if (next === current) return;
    banner = null;
    if (which === 'work') timer.setDurations({ workMinutes: next });
    else timer.setDurations({ breakMinutes: next });
    paint(timer.getState());
    persist();
  }

  function addTask(title) {
    const clean = title.trim().slice(0, 140);
    if (!clean) return;
    if (tasks.length >= MAX_TASKS) {
      banner = 'The list is full. Delete a task to add another.';
      paint(timer.getState());
      persist();
      return;
    }
    const task = { id: uid(), title: clean, done: false, pomodoros: 0 };
    tasks.push(task);
    if (!tasks.some(function (item) { return item.id === activeTaskId && !item.done; })) {
      activeTaskId = task.id;
    }
    renderTasks();
    persist();
  }

  function toggleDone(id) {
    const task = tasks.find(function (item) { return item.id === id; });
    if (!task) return;
    task.done = !task.done;
    if (task.done && activeTaskId === id) {
      const next = tasks.find(function (item) { return !item.done; });
      activeTaskId = next ? next.id : null;
    } else if (!task.done && !tasks.some(function (item) { return item.id === activeTaskId && !item.done; })) {
      activeTaskId = id;
    }
    renderTasks();
    persist();
  }

  function selectTask(id) {
    const task = tasks.find(function (item) { return item.id === id && !item.done; });
    if (!task) return;
    activeTaskId = id;
    renderTasks();
    persist();
  }

  function removeTask(id) {
    tasks = tasks.filter(function (item) { return item.id !== id; });
    if (activeTaskId === id) {
      const next = tasks.find(function (item) { return !item.done; });
      activeTaskId = next ? next.id : null;
    }
    renderTasks();
    persist();
  }

  function bind() {
    els.toggle.addEventListener('click', onToggle);
    els.reset.addEventListener('click', onReset);
    els.durations.addEventListener('submit', function (event) { event.preventDefault(); });
    els.work.addEventListener('change', function () { commitDuration('work'); });
    els.break.addEventListener('change', function () { commitDuration('break'); });
    els.form.addEventListener('submit', function (event) {
      event.preventDefault();
      addTask(els.input.value);
      els.input.value = '';
      els.input.focus();
    });
    els.list.addEventListener('click', function (event) {
      const item = event.target.closest('[data-id]');
      if (!item) return;
      const id = item.dataset.id;
      if (event.target.closest('[data-action="toggle-done"]')) {
        toggleDone(id);
        return;
      }
      if (event.target.closest('[data-action="delete"]')) {
        removeTask(id);
        return;
      }
      if (event.target.closest('[data-action="select"]')) selectTask(id);
    });
    document.addEventListener('keydown', function (event) {
      if (event.code !== 'Space') return;
      const target = event.target;
      if (target && (target.closest('input, textarea, select, button, a') || target.isContentEditable)) return;
      event.preventDefault();
      onToggle();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') pulse();
    });
    window.addEventListener('pagehide', persist);
  }

  hydrate();
  els.work.value = String(timer.getState().workMinutes);
  els.break.value = String(timer.getState().breakMinutes);
  bind();
  renderTasks();
  pulse();
})();
