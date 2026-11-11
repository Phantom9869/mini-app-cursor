// Pomodoro countdown shared by the page (global PomodoroTimer) and Node tests (module.exports).
(function (root) {
  'use strict';

  const DEFAULT_WORK_MINUTES = 25;
  const DEFAULT_BREAK_MINUTES = 5;
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 180;

  function finiteNumber(value) {
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function clampMinutes(value, fallback) {
    const n = finiteNumber(value);
    if (n == null) return fallback;
    const rounded = Math.round(n);
    if (rounded < MIN_MINUTES) return MIN_MINUTES;
    if (rounded > MAX_MINUTES) return MAX_MINUTES;
    return rounded;
  }

  function formatTime(totalSeconds) {
    const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  /**
   * @param {object} [options]
   * @param {number} [options.workMinutes]
   * @param {number} [options.breakMinutes]
   * @param {'work'|'break'} [options.mode]
   * @param {number} [options.remainingSeconds]
   * @param {number} [options.completedPomodoros]
   */
  function createTimer(options) {
    const settings = options || {};
    const workMinutes = clampMinutes(settings.workMinutes, DEFAULT_WORK_MINUTES);
    const breakMinutes = clampMinutes(settings.breakMinutes, DEFAULT_BREAK_MINUTES);
    const mode = settings.mode === 'break' ? 'break' : 'work';
    const workSeconds = workMinutes * 60;
    const breakSeconds = breakMinutes * 60;

    const remainingOverride = finiteNumber(settings.remainingSeconds);
    let remainingSeconds = remainingOverride == null
      ? (mode === 'break' ? breakSeconds : workSeconds)
      : Math.max(0, Math.floor(remainingOverride));

    const completedOverride = finiteNumber(settings.completedPomodoros);
    const completedPomodoros = completedOverride == null
      ? 0
      : Math.max(0, Math.floor(completedOverride));

    let phaseTotal = mode === 'break' ? breakSeconds : workSeconds;
    if (remainingSeconds > phaseTotal) phaseTotal = remainingSeconds;

    const state = {
      mode: mode,
      workSeconds: workSeconds,
      breakSeconds: breakSeconds,
      remainingSeconds: remainingSeconds,
      phaseTotal: phaseTotal,
      running: false,
      endsAt: null,
      completedPomodoros: completedPomodoros,
    };

    function phaseSeconds() {
      return state.mode === 'work' ? state.workSeconds : state.breakSeconds;
    }

    function getState() {
      return {
        mode: state.mode,
        running: state.running,
        remainingSeconds: state.remainingSeconds,
        totalSeconds: state.phaseTotal,
        workMinutes: state.workSeconds / 60,
        breakMinutes: state.breakSeconds / 60,
        completedPomodoros: state.completedPomodoros,
        endsAt: state.endsAt,
      };
    }

    function finishPhase() {
      const finishedMode = state.mode;
      if (finishedMode === 'work') state.completedPomodoros += 1;
      state.mode = finishedMode === 'work' ? 'break' : 'work';
      state.remainingSeconds = phaseSeconds();
      state.phaseTotal = state.remainingSeconds;
      state.running = false;
      state.endsAt = null;
      return {
        type: 'phase-complete',
        mode: finishedMode,
        completedPomodoros: state.completedPomodoros,
      };
    }

    function start(now) {
      const at = now == null ? Date.now() : now;
      if (state.running) return getState();
      if (state.remainingSeconds <= 0) {
        state.remainingSeconds = phaseSeconds();
        state.phaseTotal = state.remainingSeconds;
      }
      state.running = true;
      state.endsAt = at + state.remainingSeconds * 1000;
      return getState();
    }

    function pause(now) {
      const at = now == null ? Date.now() : now;
      if (!state.running) return getState();
      if (state.endsAt != null) {
        const msLeft = state.endsAt - at;
        state.remainingSeconds = msLeft <= 0 ? 0 : Math.ceil(msLeft / 1000);
      }
      state.running = false;
      state.endsAt = null;
      return getState();
    }

    function tick(now) {
      const at = now == null ? Date.now() : now;
      const events = [];
      if (!state.running || state.endsAt == null) {
        return { state: getState(), events: events };
      }
      if (at >= state.endsAt) {
        events.push(finishPhase());
        return { state: getState(), events: events };
      }
      state.remainingSeconds = Math.ceil((state.endsAt - at) / 1000);
      return { state: getState(), events: events };
    }

    function reset() {
      state.running = false;
      state.endsAt = null;
      state.mode = 'work';
      state.remainingSeconds = state.workSeconds;
      state.phaseTotal = state.workSeconds;
      return getState();
    }

    function setDurations(next) {
      const update = next || {};
      const touchedWork = update.workMinutes != null && update.workMinutes !== '';
      const touchedBreak = update.breakMinutes != null && update.breakMinutes !== '';
      if (touchedWork) {
        state.workSeconds = clampMinutes(update.workMinutes, state.workSeconds / 60) * 60;
      }
      if (touchedBreak) {
        state.breakSeconds = clampMinutes(update.breakMinutes, state.breakSeconds / 60) * 60;
      }
      if (!state.running) {
        const currentTouched = state.mode === 'work' ? touchedWork : touchedBreak;
        if (currentTouched) {
          state.remainingSeconds = phaseSeconds();
          state.phaseTotal = state.remainingSeconds;
        }
      }
      return getState();
    }

    function toggle(now) {
      return state.running ? pause(now) : start(now);
    }

    return {
      start: start,
      pause: pause,
      toggle: toggle,
      tick: tick,
      reset: reset,
      setDurations: setDurations,
      getState: getState,
    };
  }

  const api = {
    createTimer: createTimer,
    formatTime: formatTime,
    clampMinutes: clampMinutes,
    DEFAULT_WORK_MINUTES: DEFAULT_WORK_MINUTES,
    DEFAULT_BREAK_MINUTES: DEFAULT_BREAK_MINUTES,
    MIN_MINUTES: MIN_MINUTES,
    MAX_MINUTES: MAX_MINUTES,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.PomodoroTimer = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
