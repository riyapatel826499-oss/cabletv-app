// Notification sound — synthesized "ding" via Web Audio (no audio file needed).
// Works in browser AND Capacitor WebView. Android WebViews need the AudioContext
// primed by a user gesture before sounds can play, so we unlock on first touch.

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

/** Play the notification ding (2-note chime, ~0.6s). */
export function playNotificationSound() {
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    if (!unlocked && c.state !== 'running') return; // needs user gesture first

    const now = c.currentTime;
    // Note 1: E5 (659 Hz), Note 2: A5 (880 Hz) — pleasant "ding-ding"
    [659.25, 880.0].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.22, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    });
  } catch { /* audio unavailable — silent */ }
}

/** Auto-unlock on first interaction anywhere in the app. */
if (typeof window !== 'undefined') {
  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('touchstart', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}
