"use client";

import { useState, useCallback, useEffect } from "react";

export interface PushNotificationsHook {
  permission:        NotificationPermission;
  requestPermission: () => Promise<void>;
  notify:            (title: string, options?: NotificationOptions) => void;
}

export function usePushNotifications(): PushNotificationsHook {
  const isSupported = typeof Notification !== "undefined";

  const [permission, setPermission] = useState<NotificationPermission>(
    isSupported ? Notification.permission : "denied",
  );

  useEffect(() => {
    if (!isSupported) return;
    setPermission(Notification.permission);
  }, [isSupported]);

  const requestPermission = useCallback(async () => {
    if (!isSupported) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  }, [isSupported]);

  const notify = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!isSupported) return;
      if (Notification.permission !== "granted") return;
      try {
        new Notification(title, { icon: "/icon-192.png", ...options });
      } catch {
        // Some browsers require service worker for Notification — fail silently
      }
    },
    [isSupported],
  );

  return { permission, requestPermission, notify };
}
