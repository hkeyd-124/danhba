'use strict';
/**
 * Window role — pure decisions, no Electron.
 *
 * These are separated from main.js so they can be unit-tested without a
 * display. The rules themselves are the interesting part: which z-order level
 * to use, whether the window takes a taskbar slot, and when to re-show it.
 *
 * ---------------------------------------------------------------------------
 * How a widget is kept out of the app switcher — the mechanism that ACTUALLY
 * works on Windows
 *
 * An earlier draft of this file asked for `type: 'toolbar'` in the
 * BrowserWindow options, believing it produced WS_EX_TOOLWINDOW on Windows.
 * That is wrong: Electron's `type` option is platform-specific, and the
 * documented values are
 *
 *     Linux  : desktop, dock, toolbar, splash, notification
 *     macOS  : desktop, textured, panel
 *     Windows: not listed at all
 *
 * so on Windows the option is ignored. It was removed rather than left in as
 * cargo cult: a comment claiming a Windows effect that does not happen is worse
 * than no code at all.
 *
 * What does the job is `skipTaskbar`. Electron documents it as "makes the
 * window not show in the taskbar", and on Windows it also removes the window
 * from the Alt+Tab list — a documented consequence of the implementation
 * (electron/electron#7850: "Can't alt+tab into a window with skipTaskbar
 * enabled", closed as a technical limitation of the feature, not a bug).
 * Together with an always-on-top level above other windows, that is what makes
 * the widget behave like a taskbar widget instead of an application: no
 * app-switcher entry, and nothing to hide behind.
 *
 * The remaining limit is unavoidable and stated in README.md: the window is
 * still a real top-level HWND owned by this process. Windows 11's own weather
 * widget is drawn by explorer.exe inside the taskbar window; a foreign process
 * cannot do that, because there is no supported API to parent a window to the
 * taskbar.
 * ---------------------------------------------------------------------------
 */

/**
 * The always-on-top level.
 *
 * 'screen-saver' is the highest level Electron exposes and the only one that
 * sits above the Windows taskbar. A widget that must stay visible over other
 * applications needs it; a plain floating panel does not, and using the highest
 * level for everything would let the widget cover fullscreen video and UAC
 * prompts for no reason.
 *
 * @param {boolean} widgetRole
 * @param {boolean} inTaskbar  drawn over the taskbar's own rectangle
 * @returns {string}
 */
function topLevel(widgetRole, inTaskbar) {
  return widgetRole || inTaskbar ? 'screen-saver' : 'floating';
}

/**
 * Should the window take a taskbar slot?
 *
 * A widget never does. A docked strip never does either, whatever the role:
 * it is drawn over the taskbar, so a button for it would be nonsense.
 *
 * @param {boolean} widgetRole
 * @param {boolean} docked
 * @returns {boolean}
 */
function skipTaskbar(widgetRole, docked) {
  return widgetRole !== false || docked;
}

/**
 * Should the environment watcher re-show a window that is not visible?
 *
 * Only when the window is ready, the role is a widget, and the USER did not
 * hide it. Without the `ready` guard the watcher would show the window before
 * its first paint; without the `userHidden` guard it would fight the tray
 * menu's "Hide" and the widget could never be dismissed.
 *
 * @param {{ready: boolean, visible: boolean, userHidden: boolean, widgetRole: boolean}} s
 * @returns {boolean}
 */
function shouldReshow(s) {
  if (!s.ready) return false;
  if (s.visible) return false;
  if (s.userHidden) return false;
  return s.widgetRole !== false;
}

module.exports = { topLevel, skipTaskbar, shouldReshow };
