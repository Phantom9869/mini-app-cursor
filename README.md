# Focus

A Pomodoro focus timer with a task list. Work and break default to 25 and 5 minutes and can be changed. Start, pause, or reset the clock, add tasks, mark them done, and see how many pomodoros each one has finished. Settings, the clock, and the list are stored in `localStorage`. Press Space to start or pause (while you are not typing in a field).

## Run

Open `index.html` in a browser, or serve this folder:

```bash
npx serve
```

## Tests

```bash
node --test
```

Timer logic lives in `timer.js`, which the page and the Node tests both use.

Built with Cursor.
