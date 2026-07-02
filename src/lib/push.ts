'use client';
/**
 * Notifications push via Firebase Cloud Messaging (Capacitor).
 *
 * Avant de l'activer :
 *   1. Créer un projet Firebase sur https://console.firebase.google.com
 *   2. Ajouter l'app Android (com.nexus.app) et télécharger google-services.json
 *   3. Placer google-services.json dans android/app/ (ne pas committer)
 *   4. npm install @capacitor/push-notifications
 *   5. npx cap sync android
 *   6. Appeler initPush() au démarrage de l'app (déjà fait dans NexusApp)
 *
 * Pour envoyer des notifications côté serveur :
 *   → Récupérer le token FCM stocké dans localStorage("nexus_fcm_token")
 *   → L'envoyer à POST /api/push/register (à créer quand le backend sera prêt)
 *   → Utiliser Firebase Admin SDK pour cibler un token spécifique
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface PushPlugin {
  requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' }>;
  register(): Promise<void>;
  addListener(
    event: 'registration',
    cb: (data: { value: string }) => void
  ): Promise<{ remove(): void }>;
  addListener(
    event: 'registrationError',
    cb: (err: { error: string }) => void
  ): Promise<{ remove(): void }>;
  addListener(
    event: 'pushNotificationReceived',
    cb: (notification: { title?: string; body?: string; data?: Record<string, string> }) => void
  ): Promise<{ remove(): void }>;
  addListener(
    event: 'pushNotificationActionPerformed',
    cb: (action: { notification: { data?: Record<string, string> } }) => void
  ): Promise<{ remove(): void }>;
}

const PushNotifications = registerPlugin<PushPlugin>('PushNotifications');

/** Initialiser les notifications push. Doit être appelé au montage de l'app. */
export async function initPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { receive } = await PushNotifications.requestPermissions();
    if (receive !== 'granted') {
      console.info('[Push] permission refusée');
      return;
    }
    await PushNotifications.register();

    // Token FCM reçu — sauvegarder pour l'envoyer au backend
    await PushNotifications.addListener('registration', ({ value: token }) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem('nexus_fcm_token', token);
      }
      // TODO: envoyer le token au backend → POST /api/push/register
      console.info('[Push] token enregistré');
    });

    await PushNotifications.addListener('registrationError', ({ error }) => {
      console.warn('[Push] erreur enregistrement:', error);
    });

    // Notification reçue en premier plan
    await PushNotifications.addListener('pushNotificationReceived', (notif) => {
      console.info('[Push] reçue en foreground:', notif.title);
      // TODO: afficher un toast/badge dans l'UI
    });

    // Utilisateur a tapé sur la notification (app en arrière-plan)
    await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const data = action.notification.data;
      if (!data) return;
      // TODO: naviguer vers l'écran ciblé selon data.screen
      console.info('[Push] action:', data);
    });
  } catch (e) {
    console.warn('[Push] init:', e);
  }
}
