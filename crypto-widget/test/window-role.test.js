'use strict';
/**
 * Unit tests for the window-role decisions.
 *
 * These are the rules that make the widget behave like a taskbar widget rather
 * than an application window, so they are worth pinning down: a regression here
 * is invisible in a screenshot and only shows up as "the widget disappeared
 * when I opened Chrome".
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { topLevel, skipTaskbar, shouldReshow } = require('../src/window-role');

test('topLevel: a widget sits above the taskbar', () => {
  // 'screen-saver' is the only level Electron exposes that is above the
  // Windows taskbar. 'floating' would let the taskbar cover the widget.
  assert.strictEqual(topLevel(true, false), 'screen-saver');
});

test('topLevel: a strip drawn over the taskbar needs the same level', () => {
  assert.strictEqual(topLevel(false, true), 'screen-saver');
});

test('topLevel: a plain floating panel does not grab the highest level', () => {
  // Using 'screen-saver' for everything would let the widget cover fullscreen
  // video and UAC prompts for no reason.
  assert.strictEqual(topLevel(false, false), 'floating');
});

test('skipTaskbar: a widget never takes a taskbar slot', () => {
  assert.strictEqual(skipTaskbar(true, false), true);
  assert.strictEqual(skipTaskbar(true, true), true);
});

test('skipTaskbar: a docked strip never takes a slot, even as an app window', () => {
  // It is drawn over the taskbar; a button for it would be nonsense.
  assert.strictEqual(skipTaskbar(false, true), true);
});

test('skipTaskbar: an undocked app window does take a slot', () => {
  assert.strictEqual(skipTaskbar(false, false), false);
});

test('shouldReshow: a widget Windows hid is brought back', () => {
  assert.strictEqual(shouldReshow({
    ready: true, visible: false, userHidden: false, widgetRole: true,
  }), true);
});

test('shouldReshow: a window the USER hid stays hidden', () => {
  // Otherwise the tray menu's "Hide" would be undone two seconds later and the
  // widget could never be dismissed.
  assert.strictEqual(shouldReshow({
    ready: true, visible: false, userHidden: true, widgetRole: true,
  }), false);
});

test('shouldReshow: nothing happens before the first paint', () => {
  // showInactive() on a window that has not loaded shows an empty rectangle.
  assert.strictEqual(shouldReshow({
    ready: false, visible: false, userHidden: false, widgetRole: true,
  }), false);
});

test('shouldReshow: a visible window is left alone', () => {
  assert.strictEqual(shouldReshow({
    ready: true, visible: true, userHidden: false, widgetRole: true,
  }), false);
});

test('shouldReshow: an ordinary app window is not force-shown', () => {
  assert.strictEqual(shouldReshow({
    ready: true, visible: false, userHidden: false, widgetRole: false,
  }), false);
});

/**
 * Regression guard for a real mistake made in this project.
 *
 * An earlier draft passed `type: 'toolbar'` to BrowserWindow believing it
 * produced WS_EX_TOOLWINDOW on Windows. It does not: Electron's `type` option
 * is documented only for Linux (desktop/dock/toolbar/splash/notification) and
 * macOS (desktop/textured/panel), and is ignored on Windows. The option was
 * removed. This test fails if it is ever reintroduced, so the comment in
 * main.js cannot drift away from the code again.
 */
test("main.js does not pass a `type` option to BrowserWindow", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(
    !/^\s*type:\s*['"]toolbar['"]/m.test(src),
    "type: 'toolbar' is a Linux-only Electron option and does nothing on "
    + 'Windows; skipTaskbar is what removes the Alt+Tab entry',
  );
});

/**
 * The role must be applied through skipTaskbar — the mechanism that actually
 * works — and not only through the constructor option, because the user can
 * switch roles at runtime and the tray menu can change it.
 */
test('main.js applies the role with setSkipTaskbar', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /win\.setSkipTaskbar\(role\.skipTaskbar\(/);
});
