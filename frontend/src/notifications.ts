/** Desktop notifications + sound for the notify_desktop/play_sound rule actions (module 3). */

export function requestNotificationPermission(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

export function showDesktopNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch {
    // some browsers throw if the page isn't in a state that allows it -- not worth surfacing
  }
}

let audioCtx: AudioContext | null = null;

/** A short two-tone beep via Web Audio -- no bundled audio asset needed. */
export function playBeep(): void {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(660, now + 0.12);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.start(now);
    osc.stop(now + 0.25);
  } catch {
    // audio not available (autoplay policy before any user gesture, etc.) -- silently skip
  }
}
