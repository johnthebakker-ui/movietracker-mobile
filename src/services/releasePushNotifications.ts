import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { syncPendingPushNotifications } from "../api";
import { acknowledgedLegacyReleaseKeys } from "./releasePushState";

const legacyNotificationIdsKey = "movietracker-episode-notification-ids-v1";
const legacyReleaseKeysKey = "movietracker-episode-notification-release-keys-v2";
const fallbackDeviceIdKey = "movietracker-push-device-id-v1";
const maxRegistrationAttempts = 4;

let registrationInFlight: Promise<void> | null = null;

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function stableDeviceId() {
  if (Platform.OS === "android") {
    const androidId = Application.getAndroidId();
    if (androidId) return `android:${androidId}`;
  }
  if (Platform.OS === "ios") {
    const vendorId = await Application.getIosIdForVendorAsync();
    if (vendorId) return `ios:${vendorId}`;
  }
  const existing = await SecureStore.getItemAsync(fallbackDeviceIdKey);
  if (existing) return existing;
  const generated = `${Platform.OS}:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  await SecureStore.setItemAsync(fallbackDeviceIdKey, generated);
  return generated;
}

async function legacyDeliveryState() {
  const [idsRaw, releaseKeysRaw, presented] = await Promise.all([
    AsyncStorage.getItem(legacyNotificationIdsKey).catch(() => null),
    AsyncStorage.getItem(legacyReleaseKeysKey).catch(() => null),
    Notifications.getPresentedNotificationsAsync().catch(() => [])
  ]);
  const ids = JSON.parse(idsRaw || "[]") as string[];
  const releaseDates = JSON.parse(releaseKeysRaw || "{}") as Record<string, string>;
  const presentedReleaseKeys: string[] = [];
  presented.forEach(notification => {
    const releaseKey = notification.request.content.data?.releaseKey;
    if (typeof releaseKey === "string" && releaseKey) presentedReleaseKeys.push(releaseKey);
  });

  // Older builds recorded local schedules rather than delivery receipts.
  // A same-day schedule is considered delivered only after its 09:00 trigger;
  // future schedules are never acknowledged and remain eligible for push.
  const now = new Date();
  const today = localDateKey(now);
  const afterDailyTrigger = now.getHours() >= 9;
  return {
    ids,
    acknowledgedReleaseKeys: acknowledgedLegacyReleaseKeys(
      releaseDates,
      presentedReleaseKeys,
      today,
      afterDailyTrigger
    )
  };
}

async function cancelLegacyLocalSchedules(ids: string[]) {
  await Promise.allSettled(ids.map(id => Notifications.cancelScheduledNotificationAsync(id)));
}

async function registerOnce(accessToken: string, deviceId: string, acknowledgedReleaseKeys: string[]) {
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Expo push project ID is unavailable");
  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (!expoPushToken) throw new Error("Expo did not return a push token");
  await syncPendingPushNotifications(accessToken, {
    expoPushToken,
    platform: Platform.OS,
    deviceId,
    acknowledgedReleaseKeys
  });
}

async function refreshReleasePushRegistrationInternal(accessToken: string) {
  if (!Device.isDevice) return;
  const currentPermissions = await Notifications.getPermissionsAsync();
  const permissions = currentPermissions.status === "granted"
    ? currentPermissions
    : await Notifications.requestPermissionsAsync();
  if (permissions.status !== "granted") return;

  if (Platform.OS === "android") {
    await Promise.all([
      Notifications.setNotificationChannelAsync("episode-releases", {
        name: "New episode releases",
        description: "Alerts when a tracked show releases a new episode.",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 250, 150, 250],
        lightColor: "#ff563d"
      }),
      Notifications.setNotificationChannelAsync("progress-prompts", {
        name: "Viewing progress questions",
        description: "Asks before an unfinished show's progress moves to a new viewing pass.",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
        vibrationPattern: [0, 250, 150, 250],
        lightColor: "#ff563d"
      })
    ]);
  }

  const legacy = await legacyDeliveryState();
  // Server push is the sole release-delivery path. Cancel schedules left by
  // older builds before registering, so a token retry cannot race a local alert.
  await cancelLegacyLocalSchedules(legacy.ids);
  const deviceId = await stableDeviceId();
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRegistrationAttempts; attempt += 1) {
    try {
      await registerOnce(accessToken, deviceId, legacy.acknowledgedReleaseKeys);
      await Promise.all([
        AsyncStorage.setItem(legacyNotificationIdsKey, "[]"),
        AsyncStorage.setItem(legacyReleaseKeysKey, "{}")
      ]);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxRegistrationAttempts - 1) await wait(750 * (2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Push registration failed");
}

export function scheduleEpisodeNotifications(_userId: string, accessToken?: string) {
  if (!accessToken) return Promise.resolve();
  if (registrationInFlight) return registrationInFlight;
  registrationInFlight = refreshReleasePushRegistrationInternal(accessToken)
    .finally(() => { registrationInFlight = null; });
  return registrationInFlight;
}
