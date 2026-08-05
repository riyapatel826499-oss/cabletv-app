// FCM push registration for the native app (Capacitor).
// No-ops in the browser (web uses VAPID service worker push instead).
import { Capacitor } from '@capacitor/core';
import api from '../api/client';
import { playNotificationSound } from './sound';

let registered = false;

/** Register this device with FCM + backend. Call after login. */
export async function initPushNotifications(): Promise<void> {
  try {
    if (Capacitor.getPlatform() !== 'android') return; // iOS/web no-op
    const { PushNotifications } = await import('@capacitor/push-notifications');

    // Permission
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;

    // Register with FCM → get device token
    await PushNotifications.register();

    // Token → backend
    PushNotifications.addListener('registration', async (token: { value: string }) => {
      if (registered || !token.value) return;
      registered = true;
      try {
        await api.post('/push/fcm-register', { token: token.value, platform: 'android' });
        console.log('[push] FCM registered');
      } catch { /* non-fatal */ }
    });

    // Foreground notification received → play sound (system tray shows natively)
    PushNotifications.addListener('pushNotificationReceived', () => {
      playNotificationSound();
    });

    // Notification tapped → open app (already foreground)
    PushNotifications.addListener('pushNotificationActionPerformed', () => {
      playNotificationSound();
    });
  } catch (e) {
    console.warn('[push] FCM init skipped:', e);
  }
}

/** Unregister this device (on logout). */
export async function unregisterPushNotifications(): Promise<void> {
  try {
    if (Capacitor.getPlatform() !== 'android') return;
    const { PushNotifications } = await import('@capacitor/push-notifications');
    PushNotifications.removeAllListeners();
    registered = false;
  } catch { /* ignore */ }
}
