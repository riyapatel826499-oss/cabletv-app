// Notification sounds — synthesized via Web Audio (no audio files needed).
// Works in browser AND Capacitor WebView. Android WebViews need the AudioContext
// primed by a user gesture before sounds can play, so we unlock on first touch.
//
// Two distinct sounds:
//  - playPaymentSound()       — single pleasant "ding" (regular payment)
//  - playReconnectionSound()  — two-tone alert "ding-ding-ding" (reconnection)

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    return ctx;
  } catch {
    return null;
  }
}

/** Call on first user interaction (pointerdown/touchstart) to unlock audio. */
export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  unlocked = true;
}

function ensureRunning(c: AudioContext): boolean {
  if (c.state === 'suspended') c.resume().catch(() => {});
  if (!unlocked && c.state !== 'running') return false; // needs user gesture first
  return true;
}

function tone(
  c: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.05);
}

/** Play the regular-payment ding (single pleasant chime, ~0.6s). */
export function playPaymentSound() {
  try {
    const c = getCtx();
    if (!c) return;
    if (!ensureRunning(c)) return;
    const now = c.currentTime;
    tone(c, 659.25, now, 0.3, 0.22);          // E5
    tone(c, 880.0, now + 0.12, 0.35, 0.2);    // A5 — "ding-ding"
  } catch { /* audio unavailable — silent */ }
}

/** Play the reconnection alert (urgent three-tone, ~1.1s). */
export function playReconnectionSound() {
  try {
    const c = getCtx();
    if (!c) return;
    if (!ensureRunning(c)) return;
    const now = c.currentTime;
    // Urgent ascending triplet: G5 → C6 → G5, with a harder (triangle) timbre
    tone(c, 784.0, now, 0.22, 0.24, 'triangle');
    tone(c, 1046.5, now + 0.2, 0.22, 0.24, 'triangle');
    tone(c, 784.0, now + 0.4, 0.3, 0.22, 'triangle');
    // Soft bass pulse underneath for weight
    tone(c, 392.0, now, 0.5, 0.12, 'sine');
  } catch { /* audio unavailable — silent */ }
}

/** Play the sound matching a notification type (defaults to payment ding). */
export function playNotificationSound(notifType?: string | null) {
  const t = (notifType || '').toLowerCase();
  if (t.includes('reconnect') || t === 'reconnection') {
    playReconnectionSound();
  } else {
    playPaymentSound();
  }
}

/** Auto-unlock on first interaction anywhere in the app. */
if (typeof window !== 'undefined') {
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}
