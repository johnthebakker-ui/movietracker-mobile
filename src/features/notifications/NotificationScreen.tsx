import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { styles } from "../../app/styles";
import { deleteMobileNotifications } from "../../api";
import { EmptyPanel } from "../../components/EmptyPanel";
import { RemoteImage, SectionTitle } from "../../components";
import { supabase } from "../../supabase";
import { colors } from "../../theme";

export function NotificationScreen({ session, onBack, onOpenHref }: { session: Session; onBack: () => void; onOpenHref: (href: string) => Promise<void> }) {
  const [items, setItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadItems = useCallback(async () => {
    if (!supabase) return;
    setLoadingItems(true);
    setLoadError("");
    const { data, error } = await supabase.from("notifications").select("id,kind,payload,read_at,created_at").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(100);
    if (error) {
      setLoadError(error.message);
    } else {
      setItems(data ?? []);
      await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", session.user.id).is("read_at", null);
    }
    setLoadingItems(false);
  }, [session.user.id]);

  useEffect(() => { void loadItems(); }, [loadItems]);

  async function openNotification(item: any) {
    setItems(current => current.filter(value => value.id !== item.id));
    void deleteMobileNotifications(session.access_token, { id: item.id }).catch(() => undefined);
    if (item.payload?.href) {
      try { await onOpenHref(String(item.payload.href)); }
      catch (reason) { Alert.alert("Could not open notification", reason instanceof Error ? reason.message : "Try again."); }
    }
  }

  async function clearAll() {
    if (!items.length) return;
    try { await deleteMobileNotifications(session.access_token); setItems([]); }
    catch (reason) { Alert.alert("Could not clear notifications", reason instanceof Error ? reason.message : "Try again."); }
  }

  return <View style={styles.profileSection}>
    <SectionTitle kicker="Signals, not noise" title="Notifications" action="Back to profile" onAction={onBack} />
    {items.length ? <Pressable onPress={() => Alert.alert("Clear all notifications?", "This removes every notification from your inbox.", [{ text: "Cancel", style: "cancel" }, { text: "Clear all", style: "destructive", onPress: () => void clearAll() }])} style={styles.notificationClearButton}><Ionicons name="trash-outline" size={15} color={colors.muted} /><Text style={styles.notificationClearText}>Clear all</Text></Pressable> : null}
    {loadingItems ? <ActivityIndicator color={colors.accent} /> : loadError ? <EmptyPanel title="Notifications did not load" body={loadError} action="Try again" onAction={() => void loadItems()} /> : items.length ? <View style={styles.notificationList}>{items.map(item => {
      const image = item.payload?.image;
      return <Pressable key={item.id} disabled={!item.payload?.href} onPress={() => void openNotification(item)} style={[styles.notificationCard, !item.read_at && styles.notificationCardUnread]}>
        {image ? <RemoteImage uri={image} style={styles.notificationImage} /> : <View style={styles.notificationIcon}><Ionicons name={item.kind === "episode_release" ? "film-outline" : "notifications-outline"} size={22} color={colors.accent} /></View>}
        <View style={styles.notificationCopy}><Text style={styles.notificationTitle}>{item.payload?.title ?? "MovieTracker"}</Text><Text style={styles.notificationBody}>{item.payload?.message ?? String(item.kind).replaceAll("_", " ")}</Text><Text style={styles.notificationDate}>{new Date(item.created_at).toLocaleString()}</Text></View>
        {item.payload?.href ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
      </Pressable>;
    })}</View> : <EmptyPanel title="All quiet" body="New episode releases and account activity will appear here." />}
  </View>;
}
