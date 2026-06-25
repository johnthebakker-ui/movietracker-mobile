import { StatusBar } from "expo-status-bar";
import type { Session } from "@supabase/supabase-js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { ActionSheet, AppHeader, BottomNav, DiscoverFiltersCard, Hero, PickerSheet, RecommendationFiltersCard, SectionTitle, TitleCard, styles as shared } from "./src/components";
import { fetchDiscover, fetchRecommendations, refreshRecommendations, setNotInterested } from "./src/api";
import { countries, genres, HAS_SUPABASE, ratingLabel, titleYear, tmdbImage } from "./src/config";
import { supabase } from "./src/supabase";
import { colors } from "./src/theme";
import type { AppTab, DiscoverFilters, MediaKind, MediaSummary, RecommendationFilters } from "./src/types";

const kindOptions = [
  { value: "all", label: "Movies & series" },
  { value: "movie", label: "Movies" },
  { value: "show", label: "Series" }
];

const discoverSortOptions = [
  { value: "popularity", label: "Most popular" },
  { value: "rating", label: "Highest rated" },
  { value: "newest", label: "Newest releases" }
];

export default function App() {
  const [tab, setTab] = useState<AppTab>("home");
  const [session, setSession] = useState<Session | null>(null);
  const [selected, setSelected] = useState<MediaSummary | null>(null);
  const [menuItem, setMenuItem] = useState<MediaSummary | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  const openProfile = useCallback(() => setTab("profile"), []);
  const closeDetail = useCallback(() => setSelected(null), []);

  return (
    <SafeAreaView style={screen.root}>
      <StatusBar style="light" />
      <AppHeader onProfile={openProfile} />
      {selected ? (
        <TitleDetail item={selected} token={session?.access_token} onBack={closeDetail} />
      ) : (
        <>
          {tab === "home" ? <HomeScreen onOpen={setSelected} onMenu={setMenuItem} onForYou={() => setTab("discover")} /> : null}
          {tab === "discover" ? <DiscoverHub token={session?.access_token} onOpen={setSelected} onMenu={setMenuItem} /> : null}
          {tab === "calendar" ? <CalendarScreen /> : null}
          {tab === "library" ? <LibraryScreen signedIn={Boolean(session)} /> : null}
          {tab === "profile" ? <ProfileScreen session={session} /> : null}
        </>
      )}
      <ActionSheet
        visible={Boolean(menuItem)}
        item={menuItem}
        onClose={() => setMenuItem(null)}
        onOpen={setSelected}
        onNotInterested={item => {
          setMenuItem(null);
          if (!session?.access_token) {
            Alert.alert("Sign in needed", "Sign in before hiding titles from recommendations.");
            return;
          }
          Alert.alert("Hide this title?", `${item.title} will stop appearing in your recommendations.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Hide", style: "destructive", onPress: () => setNotInterested(item, session.access_token).catch(error => Alert.alert("Could not update", error.message)) }
          ]);
        }}
      />
      <BottomNav tab={tab} onTab={next => { setSelected(null); setTab(next); }} />
    </SafeAreaView>
  );
}

function HomeScreen({ onOpen, onMenu, onForYou }: { onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void; onForYou: () => void }) {
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDiscover({ kind: "all", genre: "", country: "", year: "", sort: "popularity" });
      setItems(data.items);
    } catch (error) {
      Alert.alert("Catalog unavailable", error instanceof Error ? error.message : "Could not load MovieTracker.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <ScrollView contentContainerStyle={screen.contentWithNav} refreshControl={<RefreshControl tintColor={colors.accent} refreshing={loading} onRefresh={load} />}>
      <Hero item={items[0] ?? null} onOpen={onOpen} />
      <SectionTitle kicker="Everyone is watching" title="Trending now" action="View all →" />
      <Pressable onPress={onForYou} style={screen.forYouPill}><Text style={screen.forYouText}>✧ For you</Text></Pressable>
      <CardGrid items={items.slice(1)} onOpen={onOpen} onMenu={onMenu} />
    </ScrollView>
  );
}

function DiscoverHub({ token, onOpen, onMenu }: { token?: string; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  const [mode, setMode] = useState<"discover" | "recommendations">("discover");
  return mode === "discover" ? (
    <DiscoverScreen onOpen={onOpen} onMenu={onMenu} onForYou={() => setMode("recommendations")} />
  ) : (
    <RecommendationsScreen token={token} onOpen={onOpen} onMenu={onMenu} onDiscover={() => setMode("discover")} />
  );
}

function DiscoverScreen({ onOpen, onMenu, onForYou }: { onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void; onForYou: () => void }) {
  const [filters, setFilters] = useState<DiscoverFilters>({ kind: "all", genre: "", country: "", year: "", sort: "popularity" });
  const [field, setField] = useState<"kind" | "genre" | "country" | "sort" | null>(null);
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  const options = field === "kind" ? kindOptions : field === "genre" ? genres : field === "country" ? countries : discoverSortOptions;
  const selected = field === "kind" ? filters.kind : field === "genre" ? filters.genre : field === "country" ? filters.country : filters.sort;

  const load = useCallback(async (nextPage = 1, replace = true) => {
    setLoading(true);
    try {
      const data = await fetchDiscover(filters, nextPage);
      setItems(previous => replace ? data.items : [...previous, ...data.items]);
      setPage(data.page ?? nextPage);
      setTotalPages(data.totalPages ?? nextPage);
    } catch (error) {
      Alert.alert("Discovery failed", error instanceof Error ? error.message : "Could not load titles.");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(1, true); }, [load]);

  return (
    <View style={screen.flex}>
      <FlatList
        data={items}
        keyExtractor={item => `${item.kind}-${item.id}`}
        numColumns={2}
        contentContainerStyle={screen.listContent}
        ListHeaderComponent={
          <>
            <View style={screen.pageIntro}>
              <Text style={screen.kicker}>FIND YOUR NEXT OBSESSION</Text>
              <Text style={screen.bigTitle}>Discover</Text>
              <Pressable onPress={onForYou} style={screen.forYouPill}><Text style={screen.forYouText}>✧ For you</Text></Pressable>
            </View>
            <DiscoverFiltersCard filters={filters} onChange={setFilters} onSelect={setField} />
          </>
        }
        renderItem={({ item }) => <TitleCard item={item} onOpen={onOpen} onMenu={onMenu} />}
        onEndReached={() => !loading && page < totalPages ? load(page + 1, false) : undefined}
        onEndReachedThreshold={0.65}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.accent} style={screen.loader} /> : null}
      />
      <PickerSheet
        title={field || ""}
        visible={Boolean(field)}
        options={options}
        value={selected || ""}
        onClose={() => setField(null)}
        onPick={value => setFilters(previous => ({ ...previous, [field || "kind"]: value }))}
      />
    </View>
  );
}

function RecommendationsScreen({ token, onOpen, onMenu, onDiscover }: { token?: string; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void; onDiscover: () => void }) {
  const [filters, setFilters] = useState<RecommendationFilters>({ kind: "all", genre: "", country: "", year: "", hideWatched: true, hideListed: true });
  const [field, setField] = useState<"kind" | "genre" | "country" | null>(null);
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [cursor, setCursor] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);

  const options = field === "kind" ? kindOptions : field === "country" ? countries : genres;
  const selected = field === "kind" ? filters.kind : field === "country" ? filters.country : filters.genre;

  const load = useCallback(async (nextCursor = 0, replace = true) => {
    if (!token) return;
    setLoading(true);
    try {
      const data = await fetchRecommendations(filters, token, nextCursor);
      setItems(previous => replace ? data.items : [...previous, ...data.items]);
      setCursor(data.nextCursor ?? null);
    } catch (error) {
      Alert.alert("Recommendations failed", error instanceof Error ? error.message : "Could not load your picks.");
    } finally {
      setLoading(false);
    }
  }, [filters, token]);

  useEffect(() => { load(0, true); }, [load]);

  const refresh = useCallback(async () => {
    if (!token) {
      Alert.alert("Sign in needed", "Recommendations use your ratings, history, favorites and Trakt sync.");
      return;
    }
    setLoading(true);
    try {
      await refreshRecommendations(token);
      await load(0, true);
    } catch (error) {
      Alert.alert("Refresh failed", error instanceof Error ? error.message : "Could not refresh recommendations.");
    } finally {
      setLoading(false);
    }
  }, [load, token]);

  return (
    <View style={screen.flex}>
      <FlatList
        data={items}
        keyExtractor={(item, index) => `${item.kind}-${item.id}-${index}`}
        numColumns={2}
        contentContainerStyle={screen.listContent}
        ListHeaderComponent={
          <>
            <View style={screen.recoHeader}>
              <View>
                <Text style={screen.kicker}>CALCULATED FROM YOUR ACTUAL TASTE</Text>
                <Text style={screen.bigTitle}>For you</Text>
              </View>
              <Pressable onPress={refresh} style={screen.refreshPill}><Text style={screen.refreshText}>↻ Refresh picks</Text></Pressable>
            </View>
            <Text style={screen.lede}>Personal picks shaped by your ratings, favorites, watch history and Trakt activity.</Text>
            <Pressable onPress={onDiscover} style={screen.forYouPill}><Text style={screen.forYouText}>← Discover</Text></Pressable>
            <RecommendationFiltersCard filters={filters} onChange={setFilters} onSelect={setField} onRefresh={refresh} />
            {!token ? <AuthNotice /> : null}
          </>
        }
        renderItem={({ item }) => <TitleCard item={item} onOpen={onOpen} onMenu={onMenu} />}
        onEndReached={() => !loading && cursor !== null ? load(cursor, false) : undefined}
        onEndReachedThreshold={0.65}
        ListFooterComponent={loading ? <ActivityIndicator color={colors.accent} style={screen.loader} /> : null}
      />
      <PickerSheet
        title={field || ""}
        visible={Boolean(field)}
        options={options}
        value={selected || ""}
        onClose={() => setField(null)}
        onPick={value => setFilters(previous => ({ ...previous, [field || "kind"]: value }))}
      />
    </View>
  );
}

function AuthNotice() {
  return (
    <View style={screen.notice}>
      <Text style={screen.noticeTitle}>Sign in for real recommendations</Text>
      <Text style={screen.noticeText}>The native app uses the same Supabase account as the website. Add your keys in `.env`, sign in, and your personal feed unlocks.</Text>
    </View>
  );
}

function CardGrid({ items, onOpen, onMenu }: { items: MediaSummary[]; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  return (
    <View style={screen.grid}>
      {items.map(item => <TitleCard key={`${item.kind}-${item.id}`} item={item} onOpen={onOpen} onMenu={onMenu} />)}
    </View>
  );
}

function CalendarScreen() {
  return (
    <ScrollView contentContainerStyle={screen.contentWithNav}>
      <View style={screen.pageIntro}>
        <Text style={screen.kicker}>EPISODE WATCH CONTROL</Text>
        <Text style={screen.bigTitle}>Calendar</Text>
        <Text style={screen.lede}>Upcoming and watched episode blocks will appear here from the website sync once the mobile app has the calendar endpoint enabled.</Text>
      </View>
      <View style={screen.emptyPanel}>
        <Text style={screen.emptyIcon}>▣</Text>
        <Text style={screen.emptyTitle}>Your calendar is ready</Text>
        <Text style={screen.emptyText}>This screen is native and styled now. The next backend endpoint can feed it the exact same show schedule you see on the website.</Text>
      </View>
    </ScrollView>
  );
}

function LibraryScreen({ signedIn }: { signedIn: boolean }) {
  return (
    <ScrollView contentContainerStyle={screen.contentWithNav}>
      <View style={screen.pageIntro}>
        <Text style={screen.kicker}>YOUR SCREEN LIFE</Text>
        <Text style={screen.bigTitle}>Library</Text>
        <Text style={screen.lede}>Watchlist, current watching, completed titles, favorites and lists will live here with the same card system.</Text>
      </View>
      <View style={screen.libraryGrid}>
        {["Watchlist", "Watching", "Completed", "Favorites", "Lists", "History"].map(label => (
          <View key={label} style={screen.libraryTile}>
            <Text style={screen.libraryIcon}>▥</Text>
            <Text style={screen.libraryText}>{label}</Text>
          </View>
        ))}
      </View>
      {!signedIn ? <AuthNotice /> : null}
    </ScrollView>
  );
}

function ProfileScreen({ session }: { session: Session | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const signIn = useCallback(async () => {
    if (!supabase) return Alert.alert("Missing Supabase config", "Create `mobile-app/.env` from `.env.example` first.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) {
      Alert.alert("Sign-in failed", error instanceof Error ? error.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }, [email, password]);

  const signUp = useCallback(async () => {
    if (!supabase) return Alert.alert("Missing Supabase config", "Create `mobile-app/.env` from `.env.example` first.");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      Alert.alert("Check your email", "Confirm your address, then sign in here.");
    } catch (error) {
      Alert.alert("Sign-up failed", error instanceof Error ? error.message : "Could not create account.");
    } finally {
      setBusy(false);
    }
  }, [email, password]);

  if (session) {
    const display = session.user.email || "MovieTracker member";
    return (
      <ScrollView contentContainerStyle={screen.contentWithNav}>
        <View style={screen.profileHero}>
          <View style={screen.profileAvatar}><Text style={screen.profileAvatarText}>{display.charAt(0).toUpperCase()}</Text></View>
          <Text style={screen.kicker}>SIGNED IN</Text>
          <Text style={screen.bigTitle} numberOfLines={2}>{display.split("@")[0]}</Text>
          <Text style={screen.lede}>{display}</Text>
          <Pressable onPress={() => supabase?.auth.signOut()} style={screen.primaryWide}><Text style={screen.primaryWideText}>Sign out</Text></Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={screen.flex}>
      <ScrollView contentContainerStyle={screen.contentWithNav}>
        <View style={screen.pageIntro}>
          <Text style={screen.kicker}>REAL MOVIETRACKER ACCOUNT</Text>
          <Text style={screen.bigTitle}>Sign in</Text>
          <Text style={screen.lede}>Use the same email/password account you use on the website. Google login can be added after the Expo redirect URI is registered in Supabase.</Text>
        </View>
        <View style={screen.formPanel}>
          {!HAS_SUPABASE ? <Text style={screen.warning}>Missing `.env`: add your Supabase URL and anon key before signing in.</Text> : null}
          <TextInput autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor="#747b7e" style={screen.input} />
          <TextInput secureTextEntry value={password} onChangeText={setPassword} placeholder="Password" placeholderTextColor="#747b7e" style={screen.input} />
          <Pressable disabled={busy} onPress={signIn} style={screen.primaryWide}><Text style={screen.primaryWideText}>{busy ? "Signing in…" : "Sign in"}</Text></Pressable>
          <Pressable disabled={busy} onPress={signUp} style={screen.secondaryWide}><Text style={screen.secondaryWideText}>Create account</Text></Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function TitleDetail({ item, token, onBack }: { item: MediaSummary; token?: string; onBack: () => void }) {
  const backdrop = tmdbImage(item.backdropPath || item.posterPath, "w780");
  const poster = tmdbImage(item.posterPath, "w500");
  return (
    <ScrollView contentContainerStyle={screen.contentWithNav}>
      <View style={screen.detailHero}>
        {backdrop ? <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={screen.detailShade} />
        <Pressable onPress={onBack} style={screen.backButton}><Text style={screen.backText}>‹ Back</Text></Pressable>
        <View style={screen.detailCopy}>
          {poster ? <Image source={{ uri: poster }} style={screen.detailPoster} resizeMode="cover" /> : null}
          <View style={screen.detailText}>
            <Text style={screen.kicker}>{item.kind === "show" ? "SERIES" : "FILM"}</Text>
            <Text style={screen.detailTitle}>{item.title}</Text>
            <Text style={screen.metaLine}>{titleYear(item)} · {ratingLabel(item)}</Text>
          </View>
        </View>
      </View>
      <Text style={screen.detailOverview}>{item.overview || "No overview has been published yet."}</Text>
      <View style={screen.statusBar}>
        {["Plan", "Watching", "Watched", "Paused", "Dropped"].map(status => <View key={status} style={screen.statusPill}><Text style={screen.statusText}>{status}</Text></View>)}
      </View>
      <View style={screen.actionGrid}>
        <DetailAction label="Favorite" />
        <DetailAction label="Mark watched" />
        <DetailAction label="Add to list" />
        <Pressable
          style={screen.detailDanger}
          onPress={() => {
            if (!token) return Alert.alert("Sign in needed", "Sign in before changing recommendations.");
            Alert.alert("Not interested?", `${item.title} will be hidden from recommendations.`, [
              { text: "Cancel", style: "cancel" },
              { text: "Hide", style: "destructive", onPress: () => setNotInterested(item, token).then(() => Alert.alert("Hidden", "You can undo this later on the website title page.")).catch(error => Alert.alert("Could not update", error.message)) }
            ]);
          }}
        >
          <Text style={screen.detailDangerText}>Not interested</Text>
        </Pressable>
      </View>
      <View style={screen.factGrid}>
        <Fact label="Released" value={item.releaseDate || "TBA"} />
        <Fact label="Type" value={item.kind === "show" ? "Series" : "Film"} />
        <Fact label="Genres" value={item.genres?.map(genre => genre.name).join(", ") || "—"} />
      </View>
    </ScrollView>
  );
}

function DetailAction({ label }: { label: string }) {
  return <Pressable style={screen.detailAction}><Text style={screen.detailActionText}>{label}</Text></Pressable>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <View style={screen.fact}><Text style={screen.factLabel}>{label}</Text><Text style={screen.factValue}>{value}</Text></View>;
}

const screen = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  contentWithNav: { paddingBottom: 126 },
  listContent: { paddingBottom: 126, paddingHorizontal: 8 },
  pageIntro: { paddingHorizontal: 18, paddingTop: 42 },
  kicker: { color: colors.accent, letterSpacing: 4, fontSize: 13, fontWeight: "900" },
  bigTitle: { color: colors.text, fontFamily: "serif", fontSize: 62, lineHeight: 68, marginTop: 10 },
  lede: { color: colors.muted, fontSize: 20, lineHeight: 31, paddingHorizontal: 18, marginTop: 18 },
  metaLine: { color: colors.text, fontWeight: "800", marginTop: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8 },
  loader: { paddingVertical: 24 },
  forYouPill: { alignSelf: "flex-start", marginHorizontal: 18, marginTop: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 13, backgroundColor: colors.panel },
  forYouText: { color: colors.text, fontWeight: "900", fontSize: 16 },
  recoHeader: { paddingHorizontal: 18, paddingTop: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  refreshPill: { borderWidth: 1, borderColor: colors.line, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 12, maxWidth: 130 },
  refreshText: { color: colors.text, fontWeight: "900", textAlign: "center" },
  notice: { marginHorizontal: 18, marginTop: 18, borderRadius: 22, padding: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel },
  noticeTitle: { color: colors.text, fontWeight: "900", fontSize: 18 },
  noticeText: { color: colors.muted, marginTop: 8, lineHeight: 22 },
  emptyPanel: { margin: 18, minHeight: 260, borderRadius: 28, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, alignItems: "center", justifyContent: "center", padding: 26 },
  emptyIcon: { color: colors.accent, fontSize: 42 },
  emptyTitle: { color: colors.text, fontWeight: "900", fontSize: 24, marginTop: 16 },
  emptyText: { color: colors.muted, textAlign: "center", marginTop: 10, lineHeight: 22 },
  libraryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, paddingHorizontal: 18, marginTop: 22 },
  libraryTile: { width: "48%", minHeight: 130, borderRadius: 24, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, padding: 18, justifyContent: "space-between" },
  libraryIcon: { color: colors.accent, fontSize: 30 },
  libraryText: { color: colors.text, fontWeight: "900", fontSize: 18 },
  profileHero: { margin: 18, minHeight: 420, borderRadius: 30, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, padding: 24, justifyContent: "center" },
  profileAvatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.accent, justifyContent: "center", alignItems: "center", marginBottom: 24 },
  profileAvatarText: { color: colors.text, fontSize: 40, fontWeight: "900" },
  formPanel: { margin: 18, borderRadius: 26, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 18 },
  warning: { color: colors.accent, fontWeight: "800", marginBottom: 12, lineHeight: 22 },
  input: { height: 58, borderRadius: 18, borderWidth: 1, borderColor: colors.line, color: colors.text, backgroundColor: colors.panel2, fontSize: 17, paddingHorizontal: 16, marginBottom: 12 },
  primaryWide: { height: 58, borderRadius: 22, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 10 },
  primaryWideText: { color: colors.text, fontSize: 18, fontWeight: "900" },
  secondaryWide: { height: 58, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginTop: 10 },
  secondaryWideText: { color: colors.text, fontSize: 18, fontWeight: "900" },
  detailHero: { height: 520, overflow: "hidden", justifyContent: "flex-end", backgroundColor: colors.panel },
  detailShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.55)" },
  backButton: { position: "absolute", top: 18, left: 18, zIndex: 2, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)" },
  backText: { color: colors.text, fontWeight: "900", fontSize: 16 },
  detailCopy: { flexDirection: "row", padding: 22, alignItems: "flex-end" },
  detailPoster: { width: 118, height: 174, borderRadius: 16, marginRight: 18 },
  detailText: { flex: 1 },
  detailTitle: { color: colors.text, fontFamily: "serif", fontSize: 38, lineHeight: 42, marginTop: 8 },
  detailOverview: { color: colors.text, fontSize: 22, lineHeight: 35, padding: 22 },
  statusBar: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 14 },
  statusPill: { padding: 10, borderRadius: 14 },
  statusText: { color: colors.text, fontWeight: "900" },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", padding: 18, gap: 10 },
  detailAction: { flexGrow: 1, minWidth: "45%", borderRadius: 18, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, padding: 16, alignItems: "center" },
  detailActionText: { color: colors.text, fontWeight: "900" },
  detailDanger: { flexGrow: 1, minWidth: "45%", borderRadius: 18, backgroundColor: "rgba(255,77,77,0.1)", borderWidth: 1, borderColor: "rgba(255,77,77,0.35)", padding: 16, alignItems: "center" },
  detailDangerText: { color: colors.danger, fontWeight: "900" },
  factGrid: { borderTopWidth: 1, borderColor: colors.line, margin: 18 },
  fact: { paddingVertical: 18, borderBottomWidth: 1, borderColor: colors.line },
  factLabel: { color: colors.muted, fontSize: 14 },
  factValue: { color: colors.text, fontWeight: "900", fontSize: 18, marginTop: 6 }
});
