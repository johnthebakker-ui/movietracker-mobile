import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { styles } from "../../app/styles";
import type { Profile, ProfileImageSelection, SettingsTab } from "../../app/types";
import {
  disconnectTrakt,
  fetchScheduledNotificationDiagnostic,
  fetchTraktStatus,
  queueScheduledNotificationDiagnostic,
  sendTestNotification,
  startTraktConnect,
  syncTrakt,
  type MobileTraktStatus,
  type ScheduledNotificationDiagnostic
} from "../../api";
import { RemoteImage, SectionTitle, resolveRemoteImageUri } from "../../components";
import { API_URL } from "../../config";
import { supabase } from "../../supabase";
import { reportError } from "../../telemetry";
import { colors } from "../../theme";

export function SettingsScreen({ session, profile, tab, onTab, onBack, onSignOut, onSaved, onScheduleNotifications }: { session: Session; profile: Profile | null; tab: SettingsTab; onTab: (tab: SettingsTab) => void; onBack: () => void; onSignOut: () => void; onSaved: () => Promise<void>; onScheduleNotifications: (userId: string, accessToken?: string) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [username, setUsername] = useState(profile?.username ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [region, setRegion] = useState(profile?.region ?? "US");
  const [avatarImage, setAvatarImage] = useState<ProfileImageSelection>({ uri: resolveRemoteImageUri(profile?.avatar_url ?? ""), changed: false });
  const [bannerImage, setBannerImage] = useState<ProfileImageSelection>({ uri: resolveRemoteImageUri(profile?.banner_url ?? ""), changed: false });
  const [privacy, setPrivacy] = useState<Record<string, string>>({});
  const [notificationPreferences, setNotificationPreferences] = useState<Record<string, boolean>>({ follow_email: true, interaction_email: true, release_email: true, digest_email: false });
  const [saving, setSaving] = useState(false);
  const [traktStatus, setTraktStatus] = useState<MobileTraktStatus | null>(null);
  const [traktBusy, setTraktBusy] = useState(false);
  const [traktMessage, setTraktMessage] = useState("");
  const [mfaSummary, setMfaSummary] = useState("Checking two-factor status...");
  const [mfaFactors, setMfaFactors] = useState<Array<{ id: string; friendlyName: string; status: string }>>([]);
  const [pendingMfa, setPendingMfa] = useState<{ id: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityMessage, setSecurityMessage] = useState("");
  const [scheduledDiagnostic, setScheduledDiagnostic] = useState<ScheduledNotificationDiagnostic | null>(null);
  const [scheduledDiagnosticBusy, setScheduledDiagnosticBusy] = useState(false);
  const identities = session.user.identities ?? [];
  const providers = identities.map(identity => identity.provider).filter(Boolean);
  const hasEmailPassword = providers.includes("email") || session.user.app_metadata?.provider === "email";
  const providerLabel = providers.length ? [...new Set(providers)].join(", ") : String(session.user.app_metadata?.provider ?? "email");

  useEffect(() => {
    setDisplayName(profile?.display_name ?? "");
    setUsername(profile?.username ?? "");
    setBio(profile?.bio ?? "");
    setRegion(profile?.region ?? "US");
    setAvatarImage({ uri: resolveRemoteImageUri(profile?.avatar_url ?? ""), changed: false });
    setBannerImage({ uri: resolveRemoteImageUri(profile?.banner_url ?? ""), changed: false });
  }, [profile]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("privacy_settings").select("*").eq("user_id", session.user.id).maybeSingle().then(({ data }) => {
      if (data) setPrivacy({ profile: data.profile, activity: data.activity, history: data.history, ratings: data.ratings, favorites: data.favorites, statistics: data.statistics });
    });
  }, [session.user.id]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("notification_preferences").select("follow_email,interaction_email,release_email,digest_email").eq("user_id", session.user.id).maybeSingle().then(({ data }) => {
      if (data) setNotificationPreferences(data as Record<string, boolean>);
    });
  }, [session.user.id]);

  async function saveNotificationPreference(key: string, enabled: boolean) {
    if (!supabase) return;
    const previous = notificationPreferences[key];
    setNotificationPreferences(current => ({ ...current, [key]: enabled }));
    const { error } = await supabase.from("notification_preferences").upsert({ user_id: session.user.id, [key]: enabled }, { onConflict: "user_id" });
    if (error) {
      setNotificationPreferences(current => ({ ...current, [key]: previous }));
      Alert.alert("Could not save", error.message);
    } else if (key === "release_email") {
      onScheduleNotifications(session.user.id, session.access_token).catch(reason => reportError("notification-preference", reason));
    }
  }

  async function runNotificationTest() {
    setSaving(true);
    try {
      const result = await sendTestNotification(session.access_token);
      if (!result.pushed) {
        await Notifications.scheduleNotificationAsync({ content: { title: result.notification.title, body: result.notification.message, sound: "default", color: "#ff563d", data: { href: result.notification.href, image: result.notification.image, releaseKey: result.notification.releaseKey } }, trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 2, channelId: "episode-releases" } });
      }
      const release = `${result.mode === "upcoming" ? "Upcoming" : "Recent"} tracked release: ${result.airDate}.`;
      Alert.alert("Release pipeline test sent", result.pushed ? `${release}\n\nIt was discovered from your own tracked shows and used the normal server push, inbox, artwork and episode redirect.` : `${release}\n\nThis APK has no Expo push project configured, so the verified payload was sent once through Android's local fallback. Its inbox card and redirect still use the real server entry.`);
    } catch (reason) {
      Alert.alert("Test notification failed", reason instanceof Error ? reason.message : "Try again.");
    } finally { setSaving(false); }
  }

  const loadScheduledDiagnostic = useCallback(async () => {
    if (tab !== "notifications") return;
    try {
      setScheduledDiagnostic(await fetchScheduledNotificationDiagnostic(session.access_token));
    } catch (reason) {
      reportError("scheduled-notification-diagnostic-status", reason);
    }
  }, [session.access_token, tab]);

  useEffect(() => {
    if (tab !== "notifications") return;
    onScheduleNotifications(session.user.id, session.access_token)
      .catch(reason => reportError("scheduled-notification-registration", reason))
      .finally(() => loadScheduledDiagnostic().catch(() => undefined));
    const interval = setInterval(() => {
      loadScheduledDiagnostic().catch(() => undefined);
    }, 30_000);
    return () => clearInterval(interval);
  }, [loadScheduledDiagnostic, onScheduleNotifications, session.access_token, session.user.id, tab]);

  async function runScheduledNotificationTest() {
    setScheduledDiagnosticBusy(true);
    try {
      await onScheduleNotifications(session.user.id, session.access_token);
      const result = await queueScheduledNotificationDiagnostic(session.access_token);
      setScheduledDiagnostic(result);
      const scheduledFor = result.diagnostic?.scheduledFor
        ? new Date(result.diagnostic.scheduledFor).toLocaleString()
        : "the next hourly run";
      Alert.alert(
        "Hourly test queued",
        `MovieTracker will not send this immediately. It is queued for ${scheduledFor} through the same hourly worker used by real releases.\n\nYou may turn the phone off before then and turn it on afterward.`
      );
    } catch (reason) {
      Alert.alert(
        "Could not queue scheduled test",
        reason instanceof Error ? reason.message : "Try again."
      );
    } finally {
      setScheduledDiagnosticBusy(false);
    }
  }

  const loadTrakt = useCallback(async () => {
    if (tab !== "integrations") return;
    try {
      setTraktStatus(await fetchTraktStatus(session.access_token));
    } catch (reason) {
      setTraktMessage(reason instanceof Error ? reason.message : "Could not load Trakt status.");
    }
  }, [session.access_token, tab]);

  useEffect(() => {
    loadTrakt().catch(() => undefined);
  }, [loadTrakt]);

  const loadSecurity = useCallback(async () => {
    if (tab !== "security" || !supabase) return;
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setMfaSummary(error.message);
      return;
    }
    const verified = (data?.totp ?? []).filter((factor: any) => factor.status === "verified").map((factor: any) => ({
      id: factor.id,
      friendlyName: factor.friendly_name || "MovieTracker authenticator",
      status: factor.status
    }));
    setMfaFactors(verified);
    setMfaSummary(verified.length ? "Authenticator is enabled." : "No authenticator factor is enabled for this account.");
  }, [tab]);

  useEffect(() => {
    loadSecurity().catch(reason => setMfaSummary(reason instanceof Error ? reason.message : "Could not check two-factor status in the app."));
  }, [loadSecurity]);

  async function requestSecurityEmail(action: "delete_account" | "remove_mfa", factorId?: string) {
    setSecurityBusy(true);
    setSecurityMessage("");
    try {
      const response = await fetch(`${API_URL}/api/account/security-action`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action, factorId })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Could not send confirmation email.");
      setSecurityMessage(action === "delete_account" ? "Check your email to confirm account deletion." : "Check your email to confirm removing the authenticator.");
    } catch (reason) {
      setSecurityMessage(reason instanceof Error ? reason.message : "Could not send confirmation email.");
    } finally {
      setSecurityBusy(false);
    }
  }

  async function sendPasswordReset() {
    if (!supabase || !session.user.email) return;
    setSecurityBusy(true);
    setSecurityMessage("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(session.user.email, { redirectTo: `${API_URL}/settings/security` });
      if (error) throw error;
      setSecurityMessage("Password reset email sent.");
    } catch (reason) {
      setSecurityMessage(reason instanceof Error ? reason.message : "Could not send password reset.");
    } finally {
      setSecurityBusy(false);
    }
  }

  async function startMfaEnrollment() {
    if (!supabase) return;
    if (mfaFactors.length) {
      setSecurityMessage("Remove the current authenticator before setting up a replacement.");
      return;
    }
    const client = supabase;
    setSecurityBusy(true);
    setSecurityMessage("");
    try {
      const existing = await client.auth.mfa.listFactors();
      await Promise.allSettled((existing.data?.totp ?? []).filter((factor: any) => factor.status !== "verified").map((factor: any) => client.auth.mfa.unenroll({ factorId: factor.id })));
      const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "MovieTracker authenticator" });
      if (error) throw error;
      if (!data || data.type !== "totp") throw new Error("Could not start authenticator setup.");
      setPendingMfa({ id: data.id, secret: data.totp.secret });
      setMfaCode("");
      setSecurityMessage("Add this secret to your authenticator app, then enter the 6-digit code.");
    } catch (reason) {
      setSecurityMessage(reason instanceof Error ? reason.message : "Could not start authenticator setup.");
    } finally {
      setSecurityBusy(false);
    }
  }

  async function verifyMfa() {
    if (!supabase || !pendingMfa) return;
    if (mfaCode.trim().length < 6) return Alert.alert("Code needed", "Enter the 6-digit authenticator code.");
    setSecurityBusy(true);
    setSecurityMessage("");
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: pendingMfa.id });
      if (challenge.error) throw challenge.error;
      const verified = await supabase.auth.mfa.verify({ factorId: pendingMfa.id, challengeId: challenge.data.id, code: mfaCode.trim() });
      if (verified.error) throw verified.error;
      setPendingMfa(null);
      setMfaCode("");
      setSecurityMessage("Authenticator enabled.");
      await loadSecurity();
    } catch (reason) {
      setSecurityMessage(reason instanceof Error ? reason.message : "Could not verify authenticator code.");
    } finally {
      setSecurityBusy(false);
    }
  }

  async function removeMfa(factorId: string) {
    await requestSecurityEmail("remove_mfa", factorId);
  }

  async function pickProfileImage(kind: "avatar" | "banner") {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Photos permission needed", "Allow photo access to choose a profile image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: kind === "avatar" ? [1, 1] : [16, 9],
      quality: 0.9
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const next = { uri: asset.uri, fileName: asset.fileName ?? `${kind}.jpg`, mimeType: asset.mimeType ?? "image/jpeg", changed: true };
    if (kind === "avatar") setAvatarImage(next);
    else setBannerImage(next);
  }

  async function uploadProfileImage(kind: "avatar" | "banner", image: ProfileImageSelection) {
    if (!supabase) throw new Error("Supabase is not configured.");
    if (!image.changed) return resolveRemoteImageUri(image.uri) || null;
    const client = supabase;
    const response = await fetch(image.uri);
    const blob = await response.blob();
    const mimeType = image.mimeType || blob.type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("Images must be JPEG, PNG, or WebP.");
    if (blob.size > 5_242_880) throw new Error("Images must be under 5 MB.");
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const path = `${session.user.id}/${kind}.${extension}`;
    const { error } = await client.storage.from("profile-media").upload(path, blob, { upsert: true, contentType: mimeType, cacheControl: "3600" });
    if (error) throw error;
    return `${client.storage.from("profile-media").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;
  }

  async function saveProfile() {
    if (!supabase) return;
    setSaving(true);
    try {
      const [avatarUrl, bannerUrl] = await Promise.all([uploadProfileImage("avatar", avatarImage), uploadProfileImage("banner", bannerImage)]);
      const { error } = await supabase.from("profiles").update({ display_name: displayName.trim(), username: username.trim(), bio: bio.trim(), region: region.trim().toUpperCase().slice(0, 2), avatar_url: avatarUrl, banner_url: bannerUrl, updated_at: new Date().toISOString() }).eq("id", session.user.id);
      if (error) throw error;
      setAvatarImage({ uri: avatarUrl ?? "", changed: false });
      setBannerImage({ uri: bannerUrl ?? "", changed: false });
      Alert.alert("Profile saved", "Your profile settings were updated.");
      await onSaved();
    } catch (reason) {
      Alert.alert("Could not save", reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function savePrivacy() {
    if (!supabase) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("privacy_settings").update(privacy).eq("user_id", session.user.id);
      if (error) throw error;
      Alert.alert("Privacy saved", "Your visibility settings were updated.");
    } catch (reason) {
      Alert.alert("Could not save", reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function connectTrakt() {
    setTraktBusy(true);
    setTraktMessage("");
    try {
      const redirectTo = "movietracker://trakt/callback";
      const data = await startTraktConnect(session.access_token, redirectTo);
      const result = await WebBrowser.openAuthSessionAsync(data.url, data.redirectTo);
      if (result.type !== "success") return;
      const parsed = new URL(result.url);
      const error = parsed.searchParams.get("error");
      if (error) throw new Error(error);
      setTraktMessage("Trakt connected. Run sync now to import your history.");
      await loadTrakt();
    } catch (reason) {
      Alert.alert("Trakt connection failed", reason instanceof Error ? reason.message : "Could not connect Trakt.");
    } finally {
      setTraktBusy(false);
    }
  }

  async function runTraktSync() {
    setTraktBusy(true);
    setTraktMessage("Syncing Trakt...");
    try {
      const result = await syncTrakt(session.access_token);
      setTraktMessage(`Synced: ${result.history ?? 0} watches, ${result.ratings ?? 0} ratings, ${result.watchlist ?? 0} watchlist titles.`);
      await loadTrakt();
      await onSaved();
    } catch (reason) {
      setTraktMessage(reason instanceof Error ? reason.message : "Trakt sync failed.");
    } finally {
      setTraktBusy(false);
    }
  }

  async function unlinkTrakt() {
    Alert.alert("Disconnect Trakt?", "Imported MovieTracker data will stay in your account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          setTraktBusy(true);
          try {
            await disconnectTrakt(session.access_token);
            setTraktMessage("Trakt disconnected.");
            await loadTrakt();
          } catch (reason) {
            Alert.alert("Could not disconnect", reason instanceof Error ? reason.message : "Try again.");
          } finally {
            setTraktBusy(false);
          }
        }
      }
    ]);
  }

  return (
    <View style={styles.settingsWrap}>
      <SectionTitle kicker="Your account" title="Settings" action="Back to profile" onAction={onBack} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.settingsTabs}>
        {(["profile", "privacy", "security", "notifications", "integrations"] as SettingsTab[]).map(item => <Pressable key={item} onPress={() => onTab(item)} style={[styles.settingsTab, tab === item && styles.settingsTabActive]}><Text style={[styles.settingsTabText, tab === item && styles.settingsTabTextActive]}>{item[0].toUpperCase() + item.slice(1)}</Text></Pressable>)}
      </ScrollView>
      {tab === "profile" ? <View style={styles.settingsPanel}><Text style={styles.settingsTitle}>Profile</Text><SettingsInput label="Display name" value={displayName} onChange={setDisplayName} /><SettingsInput label="Username" value={username} onChange={setUsername} autoCapitalize="none" /><SettingsInput label="Bio" value={bio} onChange={setBio} multiline /><ProfileImagePicker label="Profile picture" imageUri={avatarImage.uri} shape="avatar" onPick={() => pickProfileImage("avatar")} /><ProfileImagePicker label="Banner image" imageUri={bannerImage.uri} shape="banner" onPick={() => pickProfileImage("banner")} /><SettingsInput label="Country" value={region} onChange={setRegion} autoCapitalize="characters" /><Pressable disabled={saving} onPress={saveProfile} style={styles.settingsSave}>{saving ? <ActivityIndicator color={colors.text} /> : <Text style={styles.settingsSaveText}>Save profile</Text>}</Pressable></View> : null}
      {tab === "privacy" ? <View style={styles.settingsPanel}><Text style={styles.settingsTitle}>Privacy</Text>{["profile", "activity", "history", "ratings", "favorites", "statistics"].map(key => <PrivacyRow key={key} label={key} value={privacy[key] ?? "public"} onChange={value => setPrivacy(current => ({ ...current, [key]: value }))} />)}<Pressable disabled={saving} onPress={savePrivacy} style={styles.settingsSave}><Text style={styles.settingsSaveText}>Save privacy</Text></Pressable></View> : null}
      {tab === "security" ? <View style={styles.settingsPanel}><Text style={styles.settingsTitle}>Security</Text><Text style={styles.settingsBody}>Signed in with {providerLabel}. {mfaSummary}</Text>{securityMessage ? <Text style={styles.settingsBody}>{securityMessage}</Text> : null}
        <View style={styles.integrationBox}><Text style={styles.integrationLabel}>Password</Text>{hasEmailPassword ? <><Text style={styles.settingsBody}>Password changes happen through a reset email, so someone with the open app cannot silently change it.</Text><Pressable disabled={securityBusy} onPress={sendPasswordReset} style={styles.securitySmallButtonGhost}><Text style={styles.settingsGhostText}>Send password reset email</Text></Pressable></> : <Text style={styles.settingsBody}>This account uses Google sign-in, so password changes and account recovery are handled by Google.</Text>}</View>
        <View style={styles.integrationBox}><Text style={styles.integrationLabel}>Authenticator app</Text>{mfaFactors.map(factor => <View key={factor.id} style={styles.securityFactorRow}><View style={styles.securityFactorCopy}><Ionicons name="shield-checkmark-outline" size={19} color="#6ee7a8" /><View><Text style={styles.securityFactorTitle}>{factor.friendlyName}</Text><Text style={styles.securityFactorSub}>Verified and required on new sessions</Text></View></View><Pressable disabled={securityBusy} onPress={() => removeMfa(factor.id)} style={styles.securityRemoveButton}><Text style={styles.securityRemoveText}>Remove</Text></Pressable></View>)}
          {pendingMfa ? <View style={styles.securityEnrollBox}><Text style={styles.settingsBody}>Manual setup key</Text><Text selectable style={styles.securitySecretText}>{pendingMfa.secret}</Text><TextInput value={mfaCode} onChangeText={setMfaCode} keyboardType="number-pad" maxLength={8} placeholder="6-digit code" placeholderTextColor="#6f7477" style={styles.settingsInput} /><Pressable disabled={securityBusy} onPress={verifyMfa} style={styles.settingsSave}><Text style={styles.settingsSaveText}>Verify authenticator</Text></Pressable></View> : !mfaFactors.length ? <Pressable disabled={securityBusy} onPress={startMfaEnrollment} style={styles.settingsGhost}><Text style={styles.settingsGhostText}>Set up authenticator</Text></Pressable> : null}
        </View>
        <Pressable onPress={onSignOut} style={styles.settingsGhost}><Text style={styles.settingsGhostText}>Sign out</Text></Pressable>
        <Pressable disabled={securityBusy} onPress={() => Alert.alert("Delete account?", "We'll email a confirmation link before anything is deleted.", [{ text: "Cancel", style: "cancel" }, { text: "Delete account", style: "destructive", onPress: () => requestSecurityEmail("delete_account") }])} style={styles.settingsDanger}><Text style={styles.settingsDangerText}>Delete account</Text></Pressable></View> : null}
      {tab === "notifications" ? <View style={styles.settingsPanel}><Text style={styles.settingsTitle}>Notifications</Text>{[
        ["follow_email", "Follow requests and approvals"], ["interaction_email", "Review and list interactions"],
        ["release_email", "Release reminders"], ["digest_email", "Recommendation digest"]
      ].map(([key, label]) => <ToggleRow key={key} label={label} enabled={notificationPreferences[key] ?? false} onChange={enabled => void saveNotificationPreference(key, enabled)} />)}
        <Pressable disabled={saving} onPress={runNotificationTest} style={styles.settingsGhost}>{saving ? <ActivityIndicator color={colors.text} /> : <Text style={styles.settingsGhostText}>Test an actual release alert now</Text>}</Pressable>
        <Text style={styles.settingsBody}>Finds a real upcoming (or recent) episode from your own tracked shows, then runs its artwork, inbox entry, push delivery and episode redirect immediately.</Text>
        <View style={styles.integrationBox}>
          <Text style={styles.integrationLabel}>Hourly delivery diagnostic</Text>
          <Text style={styles.integrationValue}>{scheduledDiagnosticLabel(scheduledDiagnostic)}</Text>
          <Text style={styles.settingsBody}>{scheduledDiagnosticDetails(scheduledDiagnostic)}</Text>
          {scheduledDiagnostic && !scheduledDiagnostic.hourlySchedulerReady ? <Text style={styles.settingsError}>Supabase migration 0025 is not active yet, so the hourly worker cannot run. Migration 0024 is already separate and may be active.</Text> : null}
          {scheduledDiagnostic && !scheduledDiagnostic.stableIdentity ? <Text style={styles.settingsError}>{scheduledDiagnostic.migrationReady ? "This phone has not completed stable-device registration yet." : "Supabase migration 0024 is not active, so cross-update duplicate protection is still using its legacy fallback."}</Text> : null}
          {scheduledDiagnostic?.stableIdentity ? <Text style={styles.settingsSuccess}>Stable-device duplicate protection is active.</Text> : null}
          <View style={styles.securityButtonRow}>
            <Pressable disabled={scheduledDiagnosticBusy || scheduledDiagnosticActive(scheduledDiagnostic) || scheduledDiagnostic?.hourlySchedulerReady === false} onPress={runScheduledNotificationTest} style={styles.securitySmallButton}>
              {scheduledDiagnosticBusy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.securitySmallButtonText}>{scheduledDiagnosticActive(scheduledDiagnostic) ? "Test already queued" : scheduledDiagnostic?.hourlySchedulerReady === false ? "Migration 0025 needed" : "Queue next-hour test"}</Text>}
            </Pressable>
            <Pressable disabled={scheduledDiagnosticBusy} onPress={() => void loadScheduledDiagnostic()} style={styles.securitySmallButtonGhost}>
              <Text style={styles.securitySmallButtonText}>Refresh status</Text>
            </Pressable>
          </View>
          <Text style={styles.settingsBody}>This test is sent only by the hourly server worker. “Receipt checked” confirms Expo/FCM accepted the handoff; seeing it on your lock screen confirms the final Android delivery.</Text>
        </View>
      </View> : null}
      {tab === "integrations" ? <View style={styles.settingsPanel}><Text style={styles.settingsTitle}>Integrations</Text><Text style={styles.settingsBody}>Connect Trakt once and MovieTracker will keep your viewing diary synced across the app and website.</Text>
        {!traktStatus ? <ActivityIndicator color={colors.accent} style={{ marginTop: 18 }} /> : !traktStatus.databaseReady ? <Text style={styles.settingsError}>Trakt database migration is not ready yet.</Text> : !traktStatus.environmentReady ? <Text style={styles.settingsError}>Trakt server credentials are not configured yet.</Text> : traktStatus.connection ? (
          <View style={styles.integrationBox}>
            <Text style={styles.integrationLabel}>Connected as</Text>
            <Text style={styles.integrationValue}>@{traktStatus.connection.trakt_username || "Trakt user"}</Text>
            <Text style={styles.settingsBody}>Last synced: {traktStatus.connection.last_synced_at ? new Date(traktStatus.connection.last_synced_at).toLocaleString() : "Not yet"}</Text>
            {traktStatus.connection.last_error ? <Text style={styles.settingsError}>{traktStatus.connection.last_error}</Text> : null}
            <Pressable disabled={traktBusy} onPress={runTraktSync} style={styles.settingsSave}>{traktBusy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.settingsSaveText}>Sync now</Text>}</Pressable>
            <Pressable disabled={traktBusy} onPress={unlinkTrakt} style={styles.settingsDanger}><Text style={styles.settingsDangerText}>Disconnect Trakt</Text></Pressable>
          </View>
        ) : <Pressable disabled={traktBusy} onPress={connectTrakt} style={styles.settingsSave}>{traktBusy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.settingsSaveText}>Connect Trakt</Text>}</Pressable>}
        {traktMessage ? <Text style={styles.settingsBody}>{traktMessage}</Text> : null}
      </View> : null}
    </View>
  );
}

function SettingsInput({ label, value, onChange, multiline, autoCapitalize }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; autoCapitalize?: "none" | "sentences" | "words" | "characters" }) {
  return <View style={styles.settingsField}><Text style={styles.settingsLabel}>{label}</Text><TextInput value={value} onChangeText={onChange} multiline={multiline} autoCapitalize={autoCapitalize} placeholderTextColor="#6f7477" style={[styles.settingsInput, multiline && styles.settingsTextArea]} /></View>;
}

function ProfileImagePicker({ label, imageUri, shape, onPick }: { label: string; imageUri: string; shape: "avatar" | "banner"; onPick: () => void }) {
  return (
    <View style={styles.settingsField}>
      <Text style={styles.settingsLabel}>{label}</Text>
      <View style={styles.profileMediaRow}>
        <View style={[styles.profileMediaPreview, shape === "avatar" ? styles.profileMediaAvatar : styles.profileMediaBanner]}>
          {imageUri ? <RemoteImage uri={imageUri} style={styles.profileMediaImage} resizeMode="cover" /> : <Ionicons name="image-outline" size={24} color={colors.muted} />}
        </View>
        <Pressable onPress={onPick} style={styles.profileMediaButton}>
          <Ionicons name="image-outline" size={18} color={colors.text} />
          <Text style={styles.profileMediaButtonText}>{imageUri ? "Change image" : "Choose from phone"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PrivacyRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const next = value === "public" ? "followers" : value === "followers" ? "private" : "public";
  return <Pressable onPress={() => onChange(next)} style={styles.privacyRow}><Text style={styles.privacyLabel}>{label}</Text><Text style={styles.privacyValue}>{value}</Text></Pressable>;
}

function ToggleRow({ label, enabled, onChange }: { label: string; enabled: boolean; onChange: (value: boolean) => void }) {
  return <View style={styles.toggleRow}><Text style={styles.privacyLabel}>{label}</Text><Switch accessibilityRole="switch" accessibilityLabel={label} value={enabled} onValueChange={onChange} thumbColor={enabled ? colors.accent : colors.muted} trackColor={{ false: colors.panel2, true: colors.accentSoft }} /></View>;
}

function scheduledDiagnosticActive(value: ScheduledNotificationDiagnostic | null) {
  return Boolean(value?.diagnostic && ["queued", "awaiting_hourly_run", "sent"].includes(value.diagnostic.state));
}

function scheduledDiagnosticLabel(value: ScheduledNotificationDiagnostic | null) {
  const state = value?.diagnostic?.state;
  if (!state) return "Not tested yet";
  if (state === "queued") return "Queued";
  if (state === "awaiting_hourly_run") return "Waiting for hourly worker";
  if (state === "sent") return "Sent to Expo/FCM";
  if (state === "receipt_checked") return "Provider receipt checked";
  if (state === "registration_missing") return "Phone registration missing";
  return "Test expired";
}

function scheduledDiagnosticDetails(value: ScheduledNotificationDiagnostic | null) {
  const diagnostic = value?.diagnostic;
  if (!diagnostic) {
    const lastRun = value?.lastHourlyRun?.completedAt
      ? ` Last successful hourly run: ${new Date(value.lastHourlyRun.completedAt).toLocaleString()}.`
      : "";
    return `Registered push devices: ${value?.registeredDevices ?? 0}.${lastRun} Queue a test to verify the real hourly path without waiting for an episode.`;
  }
  const scheduled = diagnostic.scheduledFor
    ? new Date(diagnostic.scheduledFor).toLocaleString()
    : "Unknown";
  const sent = diagnostic.sentAt
    ? ` Sent: ${new Date(diagnostic.sentAt).toLocaleString()}.`
    : "";
  const checked = diagnostic.receiptCheckedAt
    ? ` Receipt: ${new Date(diagnostic.receiptCheckedAt).toLocaleString()}.`
    : "";
  const lastRun = value?.lastHourlyRun?.completedAt
    ? ` Last hourly run: ${new Date(value.lastHourlyRun.completedAt).toLocaleString()}.`
    : "";
  return `Scheduled: ${scheduled}.${sent}${checked} Registered devices: ${value?.registeredDevices ?? 0}.${lastRun}`;
}
