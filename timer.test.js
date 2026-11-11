const test = require('node:test');
const assert = require('node:assert/strict');
const { createTimer, formatTime, clampMinutes } = require('./timer.js');

test('defaults to a 25:00 work session that is not running', () => {
  const timer = createTimer();
  const state = timer.getState();
  assert.equal(state.mode, 'work');
  assert.equal(state.running, false);
  assert.equal(state.remainingSeconds, 25 * 60);
  assert.equal(state.totalSeconds, 25 * 60);
  assert.equal(state.breakMinutes, 5);
  assert.equal(state.completedPomodoros, 0);
  assert.equal(state.endsAt, null);
  assert.equal(formatTime(state.remainingSeconds), '25:00');
});

test('start and pause keep the remaining time, and a paused timer does not advance', () => {
  const timer = createTimer({ workMinutes: 25 });
  const start = 1_000_000;
  timer.start(start);
  const mid = timer.tick(start + 90_000);
  assert.equal(mid.events.length, 0);
  assert.equal(mid.state.running, true);
  assert.equal(mid.state.remainingSeconds, 25 * 60 - 90);

  timer.pause(start + 90_000);
  assert.equal(timer.getState().running, false);
  assert.equal(timer.getState().remainingSeconds, 25 * 60 - 90);
  assert.equal(timer.getState().endsAt, null);

  const later = timer.tick(start + 200_000);
  assert.equal(later.events.length, 0);
  assert.equal(later.state.remainingSeconds, 25 * 60 - 90);
});

test('pause and start continue the same countdown', () => {
  const timer = createTimer({ workMinutes: 25 });
  timer.start(0);
  timer.pause(60_000);
  assert.equal(timer.getState().remainingSeconds, 24 * 60);
  timer.start(120_000);
  const state = timer.tick(150_000).state;
  assert.equal(state.remainingSeconds, 24 * 60 - 30);
  assert.equal(state.mode, 'work');
  assert.equal(state.completedPomodoros, 0);
});

test('start is idempotent and does not restart the end time', () => {
  const timer = createTimer({ workMinutes: 1 });
  timer.start(0);
  timer.start(5_000);
  assert.equal(timer.tick(5_000).state.remainingSeconds, 55);
});

test('a finished work phase switches to break, counts one pomodoro, and stops', () => {
  const timer = createTimer({ workMinutes: 1, breakMinutes: 5 });
  timer.start(0);
  const early = timer.tick(60_000 - 1);
  assert.equal(early.state.running, true);
  assert.equal(early.state.completedPomodoros, 0);
  assert.equal(early.state.remainingSeconds, 1);

  const done = timer.tick(60_000);
  assert.equal(done.events.length, 1);
  assert.equal(done.events[0].type, 'phase-complete');
  assert.equal(done.events[0].mode, 'work');
  assert.equal(done.state.mode, 'break');
  assert.equal(done.state.running, false);
  assert.equal(done.state.remainingSeconds, 5 * 60);
  assert.equal(done.state.totalSeconds, 5 * 60);
  assert.equal(done.state.completedPomodoros, 1);

  const again = timer.tick(120_000);
  assert.equal(again.events.length, 0);
  assert.equal(again.state.completedPomodoros, 1);
  assert.equal(again.state.mode, 'break');
});

test('a full work and break cycle returns to work with a single pomodoro', () => {
  const timer = createTimer({ workMinutes: 25, breakMinutes: 5 });
  timer.start(0);
  const afterWork = timer.tick(25 * 60 * 1000);
  assert.equal(afterWork.state.mode, 'break');
  assert.equal(afterWork.state.completedPomodoros, 1);

  timer.start(25 * 60 * 1000);
  const afterBreak = timer.tick(30 * 60 * 1000);
  assert.equal(afterBreak.events[0].mode, 'break');
  assert.equal(afterBreak.state.mode, 'work');
  assert.equal(afterBreak.state.running, false);
  assert.equal(afterBreak.state.completedPomodoros, 1);
  assert.equal(afterBreak.state.remainingSeconds, 25 * 60);
});

test('reset stops the clock and returns to a full work interval', () => {
  const timer = createTimer({ workMinutes: 25, breakMinutes: 5 });
  timer.start(0);
  timer.tick(10_000);
  const state = timer.reset();
  assert.equal(state.mode, 'work');
  assert.equal(state.running, false);
  assert.equal(state.remainingSeconds, 25 * 60);
  assert.equal(state.endsAt, null);

  const later = timer.tick(120_000);
  assert.equal(later.events.length, 0);
  assert.equal(later.state.mode, 'work');
  assert.equal(later.state.remainingSeconds, 25 * 60);
});

test('setDurations updates an idle countdown and clamps the bounds', () => {
  const timer = createTimer();
  const state = timer.setDurations({ workMinutes: 40, breakMinutes: 0 });
  assert.equal(state.workMinutes, 40);
  assert.equal(state.breakMinutes, 1);
  assert.equal(state.remainingSeconds, 40 * 60);
  assert.equal(clampMinutes(999, 25), 180);
  assert.equal(clampMinutes('nope', 25), 25);
  assert.equal(clampMinutes(1.6, 25), 2);
});

test('changing the other phase does not wipe a paused countdown', () => {
  const timer = createTimer({ workMinutes: 25, breakMinutes: 5 });
  timer.start(0);
  timer.pause(60_000);
  const state = timer.setDurations({ breakMinutes: 10 });
  assert.equal(state.remainingSeconds, 25 * 60 - 60);
  assert.equal(state.breakMinutes, 10);
  assert.equal(state.mode, 'work');
});

test('changing the current phase length while paused reloads that phase', () => {
  const timer = createTimer({ workMinutes: 25 });
  timer.start(0);
  timer.pause(60_000);
  const state = timer.setDurations({ workMinutes: 15 });
  assert.equal(state.remainingSeconds, 15 * 60);
  assert.equal(state.totalSeconds, 15 * 60);
});

test('duration edits during a run wait until the next phase', () => {
  const timer = createTimer({ workMinutes: 1, breakMinutes: 1 });
  timer.start(0);
  timer.setDurations({ workMinutes: 2, breakMinutes: 3 });
  const mid = timer.tick(5_000).state;
  assert.equal(mid.running, true);
  assert.equal(mid.totalSeconds, 60);
  assert.equal(mid.remainingSeconds, 55);
  assert.equal(mid.workMinutes, 2);

  const afterWork = timer.tick(60_000);
  assert.equal(afterWork.state.mode, 'break');
  assert.equal(afterWork.state.totalSeconds, 3 * 60);
  assert.equal(afterWork.state.remainingSeconds, 3 * 60);

  timer.start(60_000);
  const afterBreak = timer.tick(60_000 + 3 * 60 * 1000);
  assert.equal(afterBreak.state.mode, 'work');
  assert.equal(afterBreak.state.totalSeconds, 2 * 60);
  assert.equal(afterBreak.state.remainingSeconds, 2 * 60);
});

test('saved partial progress is restored without starting on its own', () => {
  const timer = createTimer({
    workMinutes: 25,
    remainingSeconds: 600,
    completedPomodoros: 3,
    mode: 'work',
  });
  const state = timer.getState();
  assert.equal(state.remainingSeconds, 600);
  assert.equal(state.totalSeconds, 25 * 60);
  assert.equal(state.completedPomodoros, 3);
  assert.equal(state.running, false);
});

test('null remaining uses the full phase, and start refills a zero countdown', () => {
  const fresh = createTimer({ remainingSeconds: null, workMinutes: 25 });
  assert.equal(fresh.getState().remainingSeconds, 25 * 60);

  const empty = createTimer({ remainingSeconds: 0, workMinutes: 25 });
  const started = empty.start(0);
  assert.equal(started.running, true);
  assert.equal(started.remainingSeconds, 25 * 60);
});

test('toggle starts and then pauses', () => {
  const timer = createTimer({ workMinutes: 25 });
  assert.equal(timer.toggle(0).running, true);
  const paused = timer.toggle(5_000);
  assert.equal(paused.running, false);
  assert.equal(paused.remainingSeconds, 25 * 60 - 5);
});

test('formatTime pads minutes and seconds', () => {
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(65), '01:05');
  assert.equal(formatTime(65.9), '01:05');
  assert.equal(formatTime(-5), '00:00');
  assert.equal(formatTime(180 * 60), '180:00');
});
