import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  Switch,
  useWindowDimensions,
  View
} from "react-native";

import { AppHeader, BottomNav, DiscoverFiltersCard, Hero, PickerSheet, RecommendationFiltersCard, RemoteImage, resolveRemoteImageUri, SectionTitle, TitleCard, type PickerAnchor } from "./src/components";
import { disconnectTrakt, fetchDiscover, fetchEpisodeNotificationSchedule, fetchMobileCompany, fetchMobileEpisode, fetchMobileHistory, fetchMobilePerson, fetchMobileProfile, fetchMobileSeason, fetchMobileTitle, fetchRecommendations, fetchSearch, fetchTonight, fetchTraktStatus, fetchUpNext, fetchWebsiteEntityMetadata, fetchWebsiteHome, fetchWebsiteTitleMetadata, fetchWrapped, refreshRecommendations, setNotInterested, startTraktConnect, syncTrakt, type MobileTraktStatus } from "./src/api";
import { API_URL, communityRatingLabel, countries, excludeGenreOptions, genres, HAS_SUPABASE, titleYear, tmdbImage, userRatingLabel } from "./src/config";
import { groupFranchises, listFranchiseName } from "./src/franchise-groups";
import { supabase } from "./src/supabase";
import { reportError } from "./src/telemetry";
import { colors } from "./src/theme";
import type { AppTab, DiscoverFilters, FeedResult, MediaKind, MediaSummary, RecommendationFilters } from "./src/types";

const initialDiscoverFilters: DiscoverFilters = { kind: "all", genre: "", country: "", yearMode: "exact", year: "", fromYear: "", toYear: "", sort: "popularity", excludeGenres: [], hideWatched: false, hideListed: false };
const initialRecommendationFilters: RecommendationFilters = { kind: "all", genre: "", country: "", yearMode: "exact", year: "", fromYear: "", toYear: "", hideWatched: true, hideListed: true, excludeGenres: [] };
const emptyFeed: FeedResult = { items: [] };

type PickerState = { title: string; value: string; options: Array<{ value: string; label: string }>; multiValues?: string[]; anchor?: PickerAnchor; onPick: (value: string) => void; onApply?: (values: string[]) => void } | null;
type HomeSection = { title: string; kicker: string; items: MediaSummary[] };
type ProgressCounts = { planned: number; watching: number; completed: number; paused: number; dropped: number; favorites: number };
type Profile = { id: string; username: string | null; display_name: string | null; avatar_url: string | null; banner_url: string | null; bio: string | null; region: string | null; created_at?: string | null };
type ProfileImageSelection = { uri: string; fileName?: string | null; mimeType?: string | null; changed: boolean };
type MfaState = { required: boolean; factorId?: string; challengeId?: string; code: string; error?: string };
type WatchTimePoint = "start" | "end";
type WatchDateMode = "now" | "release" | "unknown" | "custom";
type WatchLogValues = { mode: WatchDateMode; date?: string; time?: string; timePoint: WatchTimePoint };
type LibraryFilter = "all" | "planned" | "watching" | "completed" | "paused" | "dropped" | "favorites" | "lists";
type ListGroup = "none" | "collections";
type ListSort = "none" | "title_asc" | "title_desc" | "release_desc" | "release_asc" | "added_desc" | "added_asc" | "list_order";
type ActionRefreshReason = "profile" | "list" | "watch" | "rating";
type CalendarMode = "upcoming" | "watched";
type ProfilePanel = "overview" | "activity" | "lists" | "reviews" | "history" | "statistics";
type ProfileView = "profile" | "recommendations" | "settings" | "history" | "reviews" | "statistics" | "wrapped" | "notifications";
type FeatureView = "tonight" | "up-next" | null;
type HistoryFilter = "all" | "movies" | "episodes";
type CalendarEvent = { id: string; date: string; title: string; subtitle: string; artwork: string | null; item?: MediaSummary | null; href?: string | null; episodeTarget?: EpisodeTarget | null };
type EpisodeTarget = { episodeId?: number; show: MediaSummary; seasonNumber: number; episodeNumber: number; title?: string | null; overview?: string | null; airDate?: string | null; artwork?: string | null; runtime?: number | null; voteAverage?: number | null };
type SeasonTarget = { show: MediaSummary; season: DetailSeason };
type SeriesEpisodesTarget = { show: MediaSummary; seasons: DetailSeason[] };
type EntityTarget =
  | { type: "person"; id: number; name: string; subtitle?: string | null; imagePath?: string | null }
  | { type: "company"; id: number; name: string; subtitle?: string | null; imagePath?: string | null };
type UserList = { id: string; name: string; description: string | null; visibility: string | null; cover_url?: string | null; count: number; posters: string[] };
type ReviewItem = { id: string; title: string; body: string; created_at: string; updated_at?: string | null; userId?: string | null; ratingId?: string | null; containsSpoilers?: boolean | null; kind: MediaKind; mediaTitle: string; artwork: string | null; score?: number | null; item?: MediaSummary | null };
type TrackedStatus = "completed" | "watching" | "planned" | "paused" | "dropped";
type GenreStat = { name: string; total: number; statuses: Record<TrackedStatus, number>; items: Array<{ status: TrackedStatus; item: MediaSummary }> };
type HistoryItem = {
  id: string;
  date: string;
  dateKey: string;
  dateTitle: string;
  dateSubtitle: string;
  timeLabel: string;
  title: string;
  subtitle: string;
  metaLabel: string;
  artwork: string | null;
  rating?: number | null;
  rewatchNumber?: number;
  item?: MediaSummary | null;
  episodeTarget?: EpisodeTarget | null;
};
type ListMembership = UserList & { contains: boolean };
type SettingsTab = "profile" | "privacy" | "security" | "notifications" | "integrations";
type DetailPerson = { id?: number; name: string; character?: string; job?: string; profile_path?: string | null };
type DetailCompany = { id?: number; name: string; logo_path?: string | null };
type DetailVideo = { key?: string; name?: string; type?: string; official?: boolean };
type DetailImage = { file_path?: string; filePath?: string };
type DetailSeason = { id?: number; seasonNumber: number; name: string; overview?: string | null; posterPath?: string | null; airDate?: string | null; episodeCount?: number | null };
const endedSeriesStatuses = new Set(["Ended", "Canceled", "Cancelled"]);
function isLimitedSeries(show: Pick<MediaSummary, "status">, seasons: DetailSeason[]) {
  return endedSeriesStatuses.has(show.status ?? "") && seasons.filter(season => season.seasonNumber > 0).length === 1;
}
type DetailData = {
  dbId: number | null;
  overview: string | null;
  tagline: string | null;
  releaseDate: string | null;
  endDate: string | null;
  genres: Array<{ id?: number; name: string }>;
  voteAverage: number | null;
  runtime: number | null;
  originalLanguage: string | null;
  status: string | null;
  userRating: number | null;
  communityRating: number | null;
  externalRatings: Array<{ label: string; value: string }>;
  pendingExternalRatingSources?: string[];
  progressStatus: string | null;
  watched: boolean;
  lastWatchedAt?: string | null;
  favorite: boolean;
  lists: ListMembership[];
  cast: DetailPerson[];
  crew: DetailPerson[];
  companies: DetailCompany[];
  videos: DetailVideo[];
  images: DetailImage[];
  seasons: DetailSeason[];
  reviews: ReviewItem[];
  myReview: ReviewItem | null;
  collectionName: string | null;
  collection: MediaSummary[];
  recommendations: MediaSummary[];
};
type ProfileData = {
  followers: number;
  following: number;
  tracked: number;
  watchEvents: number;
  screenTimeHours: number;
  historyUniqueTitles: number;
  averageRating: string;
  reviewCount: number;
  listCount: number;
  history: HistoryItem[];
  reviews: ReviewItem[];
  favorites: MediaSummary[];
  lists: UserList[];
  progressGroups: Array<{ key: "completed" | "active" | "dropped"; label: string; count: number; posters: string[] }>;
  currentStreak: number;
  longestStreak: number;
  currentlyWatching: MediaSummary[];
  genreStats: GenreStat[];
};

const blankProgress: ProgressCounts = { planned: 0, watching: 0, completed: 0, paused: 0, dropped: 0, favorites: 0 };
const blankProfileData: ProfileData = { followers: 0, following: 0, tracked: 0, watchEvents: 0, screenTimeHours: 0, historyUniqueTitles: 0, averageRating: "-", reviewCount: 0, listCount: 0, history: [], reviews: [], favorites: [], lists: [], progressGroups: [], currentStreak: 0, longestStreak: 0, currentlyWatching: [], genreStats: [] };
const trackedStatusOrder: TrackedStatus[] = ["completed", "watching", "planned", "paused", "dropped"];
const profileCachePrefix = "movietracker-profile-v1";
const profileDataCachePrefix = "movietracker-profile-data-v2";
const libraryCachePrefix = "movietracker-library-v2";
const titleDetailCachePrefix = "movietracker-title-detail-v2";
const episodeNotificationIdsKey = "movietracker-episode-notification-ids-v1";
const searchCache = new Map<string, { savedAt: number; feed: FeedResult }>();

function titleDetailCacheKey(item: MediaSummary, userId?: string | null) {
  return `${titleDetailCachePrefix}:${userId ?? "guest"}:${item.kind}:${item.id}`;
}
const listSortOptions: Array<{ value: ListSort; label: string }> = [
  { value: "title_asc", label: "Name A-Z" },
  { value: "title_desc", label: "Name Z-A" },
  { value: "release_desc", label: "Release date: newest" },
  { value: "release_asc", label: "Release date: oldest" },
  { value: "added_desc", label: "Date added: newest" },
  { value: "added_asc", label: "Date added: oldest" },
  { value: "list_order", label: "Manual list order" }
];

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(value => {
      clearTimeout(timer);
      resolve(value);
    }).catch(reason => {
      clearTimeout(timer);
      reject(reason);
    });
  });
}

WebBrowser.maybeCompleteAuthSession();

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false })
});

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<AppTab>("home");
  const [discoverFilters, setDiscoverFilters] = useState(initialDiscoverFilters);
  const [recommendationFilters, setRecommendationFilters] = useState(initialRecommendationFilters);
  const recommendationFiltersRef = useRef(initialRecommendationFilters);
  const [homeHero, setHomeHero] = useState<MediaSummary[]>([]);
  const [homeSections, setHomeSections] = useState<HomeSection[]>([]);
  const [discoverFeed, setDiscoverFeed] = useState<FeedResult>(emptyFeed);
  const [calendarFeed, setCalendarFeed] = useState<FeedResult>(emptyFeed);
  const [libraryFeed, setLibraryFeed] = useState<FeedResult>(emptyFeed);
  const [recommendationFeed, setRecommendationFeed] = useState<FeedResult>(emptyFeed);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileData, setProfileData] = useState<ProfileData>(blankProfileData);
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [listGroup, setListGroup] = useState<ListGroup>("none");
  const [libraryLists, setLibraryLists] = useState<UserList[]>([]);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("upcoming");
  const [calendarMonth, setCalendarMonth] = useState(() => monthKey(new Date()));
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [profileView, setProfileView] = useState<ProfileView>("profile");
  const [featureView, setFeatureView] = useState<FeatureView>(null);
  const [profilePanel, setProfilePanel] = useState<ProfilePanel>("overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("profile");
  const [selectedList, setSelectedList] = useState<UserList | null>(null);
  const [selectedListFeed, setSelectedListFeed] = useState<FeedResult>(emptyFeed);
  const [listSort, setListSort] = useState<ListSort>("title_asc");
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFeed, setSearchFeed] = useState<FeedResult>(emptyFeed);
  const [searchLoading, setSearchLoading] = useState(false);
  const [progressCounts, setProgressCounts] = useState<ProgressCounts>(blankProgress);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [heroIndex, setHeroIndex] = useState(0);

  useEffect(() => {
    recommendationFiltersRef.current = recommendationFilters;
  }, [recommendationFilters]);
  const [picker, setPicker] = useState<PickerState>(null);
  const [actionItem, setActionItem] = useState<MediaSummary | null>(null);
  const [selected, setSelected] = useState<MediaSummary | null>(null);
  const [selectedStack, setSelectedStack] = useState<MediaSummary[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<EpisodeTarget | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<SeasonTarget | null>(null);
  const [selectedSeriesEpisodes, setSelectedSeriesEpisodes] = useState<SeriesEpisodesTarget | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<EntityTarget | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authBusy, setAuthBusy] = useState(false);
  const [authReady, setAuthReady] = useState(!HAS_SUPABASE);
  const [mfa, setMfa] = useState<MfaState>({ required: false, code: "" });
  const [mfaBusy, setMfaBusy] = useState(false);
  const [authVerifying, setAuthVerifying] = useState(false);
  const listRef = useRef<FlatList<MediaSummary>>(null);
  const profileDataLoadedFor = useRef<string | null>(null);
  const profileDataLoadedAt = useRef(0);
  const homeLoadedKey = useRef<string | null>(null);
  const homeLoadedAt = useRef(0);
  const homeDetailPrefetchKeys = useRef(new Set<string>());
  const libraryLoadedKey = useRef<string | null>(null);
  const libraryLoadedAt = useRef(0);
  const recommendationLoadedKey = useRef<string | null>(null);
  const recommendationLoadedAt = useRef(0);
  const checkingMfa = useRef(false);
  const pendingMfaSession = useRef<Session | null>(null);
  const usableSession = mfa.required || authVerifying ? null : session;

  const scrollToTop = useCallback(() => {
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
    setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }), 80);
  }, []);

  const goTab = useCallback((next: AppTab) => {
    setSelected(null);
    setSelectedStack([]);
    setSelectedEpisode(null);
    setSelectedSeason(null);
    setSelectedSeriesEpisodes(null);
    setSelectedEntity(null);
    setSelectedList(null);
    setSearchMode(false);
    setFeatureView(null);
    if (next === "profile") setProfileView("profile");
    setTab(next);
    scrollToTop();
  }, [scrollToTop]);

  const openProfileView = useCallback((next: ProfileView) => {
    setSelected(null);
    setSelectedStack([]);
    setSelectedEpisode(null);
    setSelectedSeason(null);
    setSelectedSeriesEpisodes(null);
    setSelectedEntity(null);
    setSelectedList(null);
    setSearchMode(false);
    setFeatureView(null);
    setProfileView(next);
    setTab("profile");
    scrollToTop();
  }, [scrollToTop]);

  const acceptSession = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession);
    if (!supabase || !nextSession) {
      setAuthVerifying(false);
      checkingMfa.current = false;
      pendingMfaSession.current = null;
      setMfa({ required: false, code: "" });
      setProfile(null);
      return;
    }
    pendingMfaSession.current = nextSession;
    if (checkingMfa.current) return;
    checkingMfa.current = true;
    setAuthVerifying(true);
    try {
      const sessionToCheck = pendingMfaSession.current;
      pendingMfaSession.current = null;
      if (!sessionToCheck) return;
      const [{ data: assurance, error: assuranceError }, { data: factors, error: factorsError }] = await withTimeout(Promise.all([
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        supabase.auth.mfa.listFactors()
      ]), 12_000, "Could not check two-step verification. Please try signing in again.");
      if (assuranceError) throw assuranceError;
      if (factorsError) throw factorsError;
      const verifiedTotp = (factors?.totp ?? []).find((factor: any) => factor.status === "verified");
      if (verifiedTotp && assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
        const { data, error: challengeError } = await withTimeout(
          supabase.auth.mfa.challenge({ factorId: verifiedTotp.id }),
          12_000,
          "Could not start the two-step challenge. Please try signing in again."
        );
        if (challengeError) throw challengeError;
        setMfa({ required: true, factorId: verifiedTotp.id, challengeId: data.id, code: "" });
      } else {
        setMfa({ required: false, code: "" });
      }
    } catch (reason) {
      setMfa({ required: false, code: "" });
      setError(reason instanceof Error ? reason.message : "Could not verify the authenticator state.");
    } finally {
      setAuthVerifying(false);
      checkingMfa.current = false;
      const queuedSession = pendingMfaSession.current;
      if (queuedSession) {
        pendingMfaSession.current = null;
        setTimeout(() => { void acceptSession(queuedSession); }, 0);
      }
    }
  }, []);

  useEffect(() => {
    let alive = true;
    supabase?.auth.getSession().then(({ data }) => {
      if (!alive) return;
      acceptSession(data.session ?? null).finally(() => {
        if (alive) setAuthReady(true);
      });
    }).catch(() => {
      if (alive) setAuthReady(true);
    });
    const { data: listener } = supabase?.auth.onAuthStateChange((event, nextSession) => {
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        setSession(nextSession);
        return;
      }
      setTimeout(() => { void acceptSession(nextSession); }, 0);
    }) ?? { data: null };
    return () => { alive = false; listener?.subscription.unsubscribe(); };
  }, [acceptSession]);

  const loadProfileInfo = useCallback(async () => {
    if (!supabase || !usableSession?.user.id) {
      setProfile(null);
      return;
    }
    const userId = usableSession.user.id;
    const cacheKey = `${profileCachePrefix}:${userId}`;
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached) {
      try { setProfile(JSON.parse(cached) as Profile); } catch { /* Ignore a stale cache entry. */ }
    }
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, 350 * attempt));
      const { data, error: profileError } = await supabase
        .from("profiles")
        .select("id,username,display_name,avatar_url,banner_url,bio,region,created_at")
        .eq("id", userId)
        .maybeSingle();
      if (!profileError && data) {
        setProfile(data as Profile);
        await AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => undefined);
        return;
      }
      lastError = profileError ? new Error(profileError.message) : new Error("Profile was not returned.");
    }
    if (!cached && lastError) setError(lastError.message);
  }, [usableSession?.access_token, usableSession?.user.id]);

  useEffect(() => { void loadProfileInfo(); }, [loadProfileInfo]);

  useEffect(() => {
    if (!usableSession?.user.id || !supabase) return;
    scheduleEpisodeNotifications(usableSession.user.id, usableSession.access_token).catch(error => { console.warn("Episode notification setup failed", error); reportError("notification-setup", error); });
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") scheduleEpisodeNotifications(usableSession.user.id, usableSession.access_token).catch(error => { console.warn("Episode notification refresh failed", error); reportError("notification-refresh", error); });
    });
    return () => subscription.remove();
  }, [usableSession?.access_token, usableSession?.user.id]);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const href = response.notification.request.content.data?.href;
      if (typeof href !== "string" || !href.startsWith("/")) return;
      const match = href.match(/^\/title\/show\/(\d+)\/season\/(\d+)\/episode\/(\d+)/);
      if (!match) {
        void WebBrowser.openBrowserAsync(`${API_URL}${href}`);
        return;
      }
      const [, showId, seasonNumber, episodeNumber] = match.map(Number);
      void fetchMobileEpisode(showId, seasonNumber, episodeNumber, usableSession?.access_token).then(payload => {
        const episode = payload.episode ?? {};
        setSelectedEpisode({
          episodeId: payload.episodeId ?? undefined,
          show: payload.show,
          seasonNumber,
          episodeNumber,
          title: episode.name,
          overview: episode.overview,
          airDate: episode.air_date,
          artwork: episode.still_path,
          runtime: episode.runtime,
          voteAverage: episode.vote_average
        });
      }).catch(() => void WebBrowser.openBrowserAsync(`${API_URL}${href}`));
    });
    return () => subscription.remove();
  }, [usableSession?.access_token]);

  const loadHome = useCallback(async (force = false) => {
    const cacheKey = `home:v3:${usableSession?.user.id ?? "guest"}`;
    if (!force && homeLoadedKey.current === cacheKey && Date.now() - homeLoadedAt.current < 180000 && (homeHero.length || homeSections.length)) return;
    const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { hero?: MediaSummary[]; sections?: HomeSection[]; savedAt?: number };
        if (parsed.hero?.length) setHomeHero(parsed.hero);
        if (parsed.sections?.length) setHomeSections(parsed.sections);
        homeLoadedKey.current = cacheKey;
        homeLoadedAt.current = parsed.savedAt || Date.now();
        if (!force && Date.now() - homeLoadedAt.current < 180000) return;
      } catch {}
    }
    try {
      const home = await fetchWebsiteHome(usableSession?.access_token);
      const hero = home.hero.slice(0, 6);
      setHomeHero(hero);
      setHomeSections(home.sections);
      homeLoadedKey.current = cacheKey;
      homeLoadedAt.current = Date.now();
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ hero, sections: home.sections, savedAt: homeLoadedAt.current })).catch(() => undefined);
    } catch {
      const today = localDateKey();
      const [popular, movies, shows] = await Promise.all([
        fetchDiscover(initialDiscoverFilters, 1, usableSession?.access_token),
        fetchDiscover({ ...initialDiscoverFilters, kind: "movie", sort: "newest", year: today.slice(0, 4) }, 1, usableSession?.access_token),
        fetchDiscover({ ...initialDiscoverFilters, kind: "show", sort: "newest", year: today.slice(0, 4) }, 1, usableSession?.access_token)
      ]);
      const heroItems = popular.items.filter(item => item.backdropPath && item.overview).slice(0, 6);
      const hero = heroItems.length ? heroItems : popular.items.slice(0, 6);
      const sections = [
        { kicker: "Everyone is watching", title: "Trending now", items: popular.items.slice(0, 12) },
        { kicker: "Fresh from the cinema", title: "New & upcoming films", items: movies.items.slice(0, 12) },
        { kicker: "Stories worth settling into", title: "Series premieres", items: shows.items.slice(0, 12) }
      ];
      setHomeHero(hero);
      setHomeSections(sections);
      homeLoadedKey.current = cacheKey;
      homeLoadedAt.current = Date.now();
      await AsyncStorage.setItem(cacheKey, JSON.stringify({ hero, sections, savedAt: homeLoadedAt.current })).catch(() => undefined);
    }
    setHeroIndex(0);
  }, [homeHero.length, homeSections.length, usableSession?.access_token, usableSession?.user.id]);

  useEffect(() => {
    const picks: MediaSummary[] = [];
    const seen = new Set<string>();
    const add = (candidate?: MediaSummary | null) => {
      if (!candidate) return;
      const key = `${candidate.kind}:${candidate.id}`;
      if (seen.has(key)) return;
      seen.add(key);
      picks.push(candidate);
    };
    homeHero.slice(0, 6).forEach(add);
    homeSections.slice(0, 3).forEach(section => section.items.slice(0, 5).forEach(add));
    if (!picks.length) return;

    let cancelled = false;
    const userId = usableSession?.user.id ?? "guest";
    const token = usableSession?.access_token;
    const timer = setTimeout(() => {
      void (async () => {
        const queue = picks.slice(0, 6);
        const worker = async () => {
          while (!cancelled) {
            const item = queue.shift();
            if (!item) return;
            const cacheKey = titleDetailCacheKey(item, userId);
            if (homeDetailPrefetchKeys.current.has(cacheKey)) continue;
            homeDetailPrefetchKeys.current.add(cacheKey);
            const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
            if (cached) {
              try { if (JSON.parse(cached)?.detail?.completeness === "full") continue; } catch { /* Replace malformed or core-only cache entries. */ }
            }
            const core = await fetchMobileTitle(item.kind, item.id, token, "full").catch(() => null);
            if (cancelled) return;
            if (core) await AsyncStorage.setItem(cacheKey, JSON.stringify({ detail: core, savedAt: Date.now() })).catch(() => undefined);
          }
        };
        await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
      })();
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [homeHero, homeSections, usableSession?.access_token, usableSession?.user.id]);

  useEffect(() => {
    if (tab !== "home" || homeHero.length < 2) return;
    const timer = setInterval(() => setHeroIndex(index => (index + 1) % homeHero.length), 5000);
    return () => clearInterval(timer);
  }, [homeHero.length, tab]);

  const loadDiscover = useCallback(async () => {
    setDiscoverFeed(await fetchDiscover(discoverFilters, 1, usableSession?.access_token));
  }, [discoverFilters, usableSession?.access_token]);

  const loadRecommendations = useCallback(async (filters = recommendationFiltersRef.current, force = false) => {
    if (!usableSession?.access_token) {
      setRecommendationFeed(emptyFeed);
      recommendationLoadedKey.current = null;
      recommendationLoadedAt.current = 0;
      return;
    }
    const cacheKey = `${usableSession.user.id}:${JSON.stringify(filters)}`;
    if (!force && recommendationLoadedKey.current === cacheKey && Date.now() - recommendationLoadedAt.current < 120000) return;
    try {
      const feed = await fetchRecommendations(filters, usableSession.access_token);
      setRecommendationFeed(feed);
      recommendationLoadedKey.current = cacheKey;
      recommendationLoadedAt.current = Date.now();
    } catch (reason) {
      setRecommendationFeed(emptyFeed);
      throw reason;
    }
  }, [usableSession?.access_token, usableSession?.user.id]);

  const loadSearch = useCallback(async (query = searchQuery) => {
    const clean = query.trim();
    if (!clean) {
      setSearchFeed(emptyFeed);
      return;
    }
    const cacheKey = clean.toLocaleLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < 300000) {
      setSearchFeed(cached.feed);
      return;
    }
    setSearchLoading(true);
    try {
      try {
        const remoteFeed = await fetchSearch(clean, usableSession?.access_token);
        const feed = { ...remoteFeed, items: await enrichShowRuns(remoteFeed.items, usableSession?.access_token) };
        searchCache.set(cacheKey, { savedAt: Date.now(), feed });
        setSearchFeed(feed);
        return;
      } catch {
        if (!supabase) {
          setSearchFeed(emptyFeed);
          return;
        }
      }
      const { data, error: searchError } = await supabase
        .from("media")
        .select("id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,genres,original_language,origin_countries")
        .ilike("title", `%${clean.replace(/[%_]/g, "")}%`)
        .is("deleted_at", null)
        .order("popularity", { ascending: false })
        .limit(40);
      if (searchError) throw searchError;
      const feed = { items: await enrichShowRuns((data ?? []).map(row => fromDbMedia(row)), usableSession?.access_token) };
      searchCache.set(cacheKey, { savedAt: Date.now(), feed });
      setSearchFeed(feed);
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, usableSession?.access_token]);

  const openList = useCallback(async (list: UserList) => {
    if (!supabase) return;
    setSelectedList(list);
    setListGroup("none");
    setListSort("title_asc");
    setLoading(true);
    try {
      setSelectedListFeed(await loadListFeed(list.id, usableSession?.user.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open this list.");
    } finally {
      setLoading(false);
    }
  }, [usableSession?.user.id]);

  const loadLibrary = useCallback(async (force = false) => {
    if (!usableSession?.user.id || !supabase) {
      setLibraryFeed(emptyFeed);
      setLibraryLists([]);
      setProgressCounts(blankProgress);
      libraryLoadedKey.current = null;
      libraryLoadedAt.current = 0;
      return;
    }
    const cacheKey = `${usableSession.user.id}:${libraryFilter}`;
    if (!force && libraryLoadedKey.current === cacheKey && Date.now() - libraryLoadedAt.current < 120000) return;
    const storageKey = `${libraryCachePrefix}:${cacheKey}`;
    if (!force) {
      const cached = await AsyncStorage.getItem(storageKey).catch(() => null);
      if (cached) {
        try {
          const value = JSON.parse(cached) as { feed: FeedResult; lists: UserList[]; savedAt: number };
          setLibraryFeed(value.feed ?? emptyFeed);
          setLibraryLists(value.lists ?? []);
          libraryLoadedKey.current = cacheKey;
          libraryLoadedAt.current = value.savedAt || Date.now();
          void loadLibrary(true).catch(() => undefined);
          return;
        } catch { /* Ignore an old cache shape. */ }
      }
    }
    if (libraryFilter === "lists") {
      const lists = await loadUserLists(usableSession.user.id);
      setLibraryLists(lists);
      setLibraryFeed(emptyFeed);
      libraryLoadedKey.current = cacheKey;
      libraryLoadedAt.current = Date.now();
      await AsyncStorage.setItem(storageKey, JSON.stringify({ feed: emptyFeed, lists, savedAt: libraryLoadedAt.current })).catch(() => undefined);
      return;
    }
    const mediaSelect = "id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,genres,original_language,origin_countries";
    const sourceResult = libraryFilter === "favorites"
      ? await supabase.from("favorites").select(`media(${mediaSelect})`).eq("user_id", usableSession.user.id).order("position").limit(120)
      : await (() => {
        let query = supabase.from("progress").select(`status,updated_at,media(${mediaSelect})`).eq("user_id", usableSession.user.id);
        if (libraryFilter !== "all") query = query.eq("status", libraryFilter);
        return query.order("updated_at", { ascending: false }).limit(120);
      })();
    if (sourceResult.error) throw sourceResult.error;
    const mediaRows = (sourceResult.data ?? []).flatMap((row: any) => {
      const media = firstRow(row.media);
      return media?.id ? [media] : [];
    });
    const mediaIds = mediaRows.map((media: any) => Number(media.id));
    const ratingResult = mediaIds.length ? await supabase.from("ratings").select("score,media_id").eq("user_id", usableSession.user.id).in("media_id", mediaIds) : { data: [] as any[] };
    const ratingByMedia = new Map((ratingResult.data ?? []).map((row: any) => [row.media_id, Number(row.score)]));
    const items = dedupeMedia((sourceResult.data ?? []).flatMap((row: any) => {
      const media = firstRow(row.media);
      if (!media) return [];
      return [{ ...fromDbMedia(media, ratingByMedia), reason: libraryFilter === "favorites" ? "Favorite" : progressLabel(row.status) }];
    }));
    setLibraryLists([]);
    const feed = { items };
    setLibraryFeed(feed);
    libraryLoadedKey.current = cacheKey;
    libraryLoadedAt.current = Date.now();
    await AsyncStorage.setItem(storageKey, JSON.stringify({ feed, lists: [], savedAt: libraryLoadedAt.current })).catch(() => undefined);
  }, [libraryFilter, usableSession?.access_token, usableSession?.user.id]);

  const loadCalendar = useCallback(async () => {
    if (!usableSession?.user.id || !supabase) {
      setCalendarEvents([]);
      setCalendarFeed(emptyFeed);
      return;
    }
    const { start, end } = monthBounds(calendarMonth);
    if (calendarMode === "watched") {
      const { data, error: calendarError } = await supabase
        .from("watch_events")
        .select("id,watched_at,media(*),episodes(id,name,episode_number,still_path,seasons(season_number))")
        .eq("user_id", usableSession.user.id)
        .not("watched_at", "is", null)
        .gte("watched_at", start.toISOString())
        .lt("watched_at", end.toISOString())
        .order("watched_at", { ascending: true });
      if (calendarError) throw calendarError;
      setCalendarEvents((data ?? []).flatMap((row: any) => {
        const media = firstRow(row.media);
        if (!media || !row.watched_at) return [];
        const episode = firstRow(row.episodes);
        const season = firstRow(episode?.seasons);
        return [{
          id: row.id,
          date: viewingDateKey(row.watched_at),
          title: media.title ?? "Unknown title",
          subtitle: episode ? `S${season?.season_number ?? "?"} E${episode.episode_number} - ${episode.name}` : "Movie watched",
          artwork: episode?.still_path ?? media.backdrop_path ?? media.poster_path ?? null,
          item: fromDbMedia(media),
          href: episode ? `${API_URL}/title/show/${media.tmdb_id}/season/${season?.season_number ?? 1}/episode/${episode.episode_number}` : null,
          episodeTarget: episode ? { show: fromDbMedia(media), episodeId: Number(episode.id), seasonNumber: Number(season?.season_number ?? 1), episodeNumber: Number(episode.episode_number), title: episode.name, artwork: episode.still_path ?? media.backdrop_path ?? media.poster_path ?? null } : null
        }];
      }));
      setCalendarFeed(emptyFeed);
      return;
    }
    const { data: tracked, error: trackedError } = await supabase.from("progress").select("media_id,media(*)").eq("user_id", usableSession.user.id).in("status", ["watching", "planned", "paused"]).limit(100);
    if (trackedError) throw trackedError;
    const trackedIds = new Set((tracked ?? []).map((row: any) => row.media_id));
    const { data, error: episodeError } = await supabase
      .from("episodes")
      .select("id,name,episode_number,air_date,still_path,seasons(season_number,media_id,media(*))")
      .not("air_date", "is", null)
      .gte("air_date", localDateKey(start))
      .lt("air_date", localDateKey(end))
      .order("air_date", { ascending: true })
      .limit(120);
    if (episodeError) throw episodeError;
    setCalendarEvents((data ?? []).flatMap((episode: any) => {
      const season = firstRow(episode.seasons);
      const media = firstRow(season?.media);
      if (!season?.media_id || !trackedIds.has(season.media_id) || !media || !episode.air_date) return [];
      return [{
        id: String(episode.id),
        date: episode.air_date,
        title: media.title ?? "Unknown title",
        subtitle: `S${season.season_number ?? "?"} E${episode.episode_number} - ${episode.name}`,
        artwork: episode.still_path ?? media.backdrop_path ?? media.poster_path ?? null,
        item: fromDbMedia(media),
        href: `${API_URL}/title/show/${media.tmdb_id}/season/${season.season_number ?? 1}/episode/${episode.episode_number}`,
        episodeTarget: { show: fromDbMedia(media), episodeId: Number(episode.id), seasonNumber: Number(season.season_number ?? 1), episodeNumber: Number(episode.episode_number), title: episode.name, airDate: episode.air_date, artwork: episode.still_path ?? media.backdrop_path ?? media.poster_path ?? null }
      }];
    }));
    setCalendarFeed(emptyFeed);
  }, [calendarMode, calendarMonth, usableSession?.user.id]);

  const loadProfileData = useCallback(async (force = true) => {
    if (!usableSession?.user.id || !supabase) {
      setProfileData(blankProfileData);
      profileDataLoadedFor.current = null;
      profileDataLoadedAt.current = 0;
      return;
    }
    const userId = usableSession.user.id;
    const accessToken = usableSession.access_token;
    if (!force && profileDataLoadedFor.current === userId && Date.now() - profileDataLoadedAt.current < 120000) return;
    const storageKey = `${profileDataCachePrefix}:${userId}`;
    if (!force) {
      const cached = await AsyncStorage.getItem(storageKey).catch(() => null);
      if (cached) {
        try {
          const value = normalizeProfileDataTimes(JSON.parse(cached) as ProfileData);
          setProfileData(value);
          profileDataLoadedFor.current = userId;
          profileDataLoadedAt.current = Date.now();
          void loadProfileData(true).catch(() => undefined);
          return;
        } catch { /* Ignore an outdated profile cache. */ }
      }
    }
    try {
      const serverProfile = await fetchMobileProfile(accessToken);
      const normalized = normalizeProfileDataTimes(serverProfile as ProfileData);
      setProfileData(normalized);
      profileDataLoadedFor.current = userId;
      profileDataLoadedAt.current = Date.now();
      await AsyncStorage.setItem(storageKey, JSON.stringify(normalized)).catch(() => undefined);
      return;
    } catch {
      // Fall back to the legacy direct Supabase loader when the site API is not deployed yet.
    }
    const [followers, following, progressStatuses, completedCount, ratings, reviews, reviewCount, favorites, lists, listCount, history, historySummary, streakEvents, watchCount] = await Promise.all([
      supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", userId).eq("status", "accepted"),
      supabase.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId).eq("status", "accepted"),
      supabase.from("progress").select("status,updated_at,media(id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,runtime,genres,original_language,origin_countries,collection_tmdb_id,collection_name,collection_poster_path)").eq("user_id", userId).order("updated_at", { ascending: false }).limit(100),
      supabase.from("progress").select("*", { count: "exact", head: true }).eq("user_id", userId).eq("status", "completed"),
      supabase.from("ratings").select("score,media_id").eq("user_id", userId),
      supabase.from("reviews").select("id,title,body,created_at,updated_at,media(id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,runtime,genres,original_language,origin_countries,collection_tmdb_id,collection_name,collection_poster_path),ratings(score)").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20),
      supabase.from("reviews").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("favorites").select("media(id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,runtime,genres,original_language,origin_countries,collection_tmdb_id,collection_name,collection_poster_path)").eq("user_id", userId).order("position").limit(12),
      loadUserLists(userId),
      supabase.from("lists").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("watch_events").select("id,watched_at,duration_minutes,episode_id,media(id,tmdb_id,kind,title,backdrop_path,poster_path,release_date,end_date,status,vote_average,vote_count,popularity,genres,original_language,origin_countries,runtime),episodes(name,episode_number,still_path,seasons(season_number))").eq("user_id", userId).order("watched_at", { ascending: false, nullsFirst: false }).limit(12),
      supabase.from("watch_events").select("id,watched_at,duration_minutes,media_id,episode_id,media(runtime)").eq("user_id", userId).order("watched_at", { ascending: false, nullsFirst: false }).limit(5000),
      supabase.from("watch_events").select("watched_at").eq("user_id", userId).not("watched_at", "is", null).order("watched_at", { ascending: false }).limit(1000),
      supabase.from("watch_events").select("*", { count: "exact", head: true }).eq("user_id", userId)
    ]);
    const ratingsRows = ratings.data ?? [];
    const ratingByMedia = new Map((ratingsRows as any[]).map(row => [row.media_id, Number(row.score)]));
    const statusRows = progressStatuses.data ?? [];
    const favoriteItems = (favorites.data ?? []).flatMap((row: any) => {
      const media = firstRow(row.media);
      return media ? [fromDbMedia(media, ratingByMedia)] : [];
    });
    const current = statusRows.flatMap((row: any) => {
      const media = firstRow(row.media);
      return media && (row.status === "watching" || row.status === "paused") ? [fromDbMedia(media, ratingByMedia)] : [];
    });
    const favoriteItemsWithRuns = favoriteItems;
    const currentWithRuns = current;
    const completedStatusCount = completedCount.count ?? statusRows.filter((row: any) => row.status === "completed").length;
    const progressGroups = [
      { key: "completed" as const, label: "Completed", rows: statusRows.filter((row: any) => row.status === "completed") },
      { key: "active" as const, label: "In progress", rows: statusRows.filter((row: any) => row.status === "watching" || row.status === "paused") },
      { key: "dropped" as const, label: "Dropped", rows: statusRows.filter((row: any) => row.status === "dropped") }
    ].map(group => ({
      key: group.key,
      label: group.label,
      count: group.key === "completed" ? completedStatusCount : group.rows.length,
      posters: group.rows.flatMap((row: any) => {
        const media = firstRow(row.media);
        return media?.poster_path ? [tmdbImage(media.poster_path, "w342")!] : [];
      }).slice(0, 4)
    }));
    const genreMap = new Map<string, GenreStat>();
    statusRows.forEach((row: any) => {
      const media = firstRow(row.media);
      if (!media) return;
      const status = trackedStatusOrder.includes(row.status) ? row.status as TrackedStatus : "planned";
      const item = fromDbMedia(media, ratingByMedia);
      normalizedGenreNames(media).forEach(name => {
        const entry = genreMap.get(name) ?? { name, total: 0, statuses: { completed: 0, watching: 0, planned: 0, paused: 0, dropped: 0 }, items: [] };
        entry.total += 1;
        entry.statuses[status] += 1;
        entry.items.push({ status, item });
        genreMap.set(name, entry);
      });
    });
    const genreStats = [...genreMap.values()].sort((left, right) => right.total - left.total || left.name.localeCompare(right.name)).slice(0, 12);
    const watchedDays = [...new Set((streakEvents.data ?? []).filter((event: any) => event.watched_at).map((event: any) => viewingDateKey(event.watched_at)))].sort().reverse();
    const { currentStreak, longestStreak } = streaksFromDays(watchedDays);
    const historyRows = history.data ?? [];
    const historyUniqueTitles = new Set<string>();
    const summaryRows = historySummary.data ?? historyRows;
    const screenTimeMinutes = summaryRows.reduce((sum: number, event: any) => {
      const media = firstRow(event.media);
      if (event.media_id) historyUniqueTitles.add(String(event.media_id));
      return sum + Number(event.duration_minutes ?? media?.runtime ?? 0);
    }, 0);
    const occurrenceTotals = new Map<string, number>();
    summaryRows.forEach((event: any) => {
      const key = event.episode_id ? `episode-${event.episode_id}` : `media-${event.media_id ?? "unknown"}`;
      occurrenceTotals.set(key, (occurrenceTotals.get(key) ?? 0) + 1);
    });
    const remainingOccurrences = new Map(occurrenceTotals);
    const historyItems = historyRows.flatMap((event: any) => {
      const media = firstRow(event.media);
      if (!media) return [];
      const episode = firstRow(event.episodes);
      const season = firstRow(episode?.seasons);
      const day = event.watched_at ? viewingDateKey(event.watched_at) : "unknown";
      const key = event.episode_id ? `episode-${event.episode_id}` : `media-${media.id}`;
      const watchNumber = remainingOccurrences.get(key) ?? 1;
      remainingOccurrences.set(key, watchNumber - 1);
      return [{
        id: event.id,
        date: event.watched_at ?? "",
        dateKey: day,
        dateTitle: event.watched_at ? formatHistoryDay(day) : "Unknown date",
        dateSubtitle: event.watched_at ? formatHistoryMonth(day) : "Watched date not specified",
        timeLabel: event.watched_at ? formatHistoryTime(event.watched_at) : "No date",
        title: media.title,
        metaLabel: episode ? `S${season?.season_number ?? "?"} E${episode.episode_number}` : media.kind === "show" ? "Series" : "Film",
        subtitle: episode ? `S${season?.season_number ?? "?"} E${episode.episode_number} - ${episode.name}` : "Movie watched",
        artwork: episode?.still_path ?? media.backdrop_path ?? media.poster_path ?? null,
        rating: ratingByMedia.get(media.id) ?? null,
        rewatchNumber: Math.max(0, watchNumber - 1),
        item: fromDbMedia(media, ratingByMedia),
        episodeTarget: episode ? { show: fromDbMedia(media, ratingByMedia), episodeId: Number(event.episode_id ?? episode.id), seasonNumber: Number(season?.season_number ?? 1), episodeNumber: Number(episode.episode_number), title: episode.name, artwork: episode.still_path ?? media.backdrop_path ?? media.poster_path ?? null } : null
      }];
    });
    const reviewItems = (reviews.data ?? []).flatMap((review: any) => {
      const media = firstRow(review.media);
      const rating = firstRow(review.ratings);
      if (!media) return [];
      return [{
        id: review.id,
        title: review.title,
        body: review.body ?? "",
        created_at: review.created_at,
        updated_at: review.updated_at,
        kind: media.kind,
        mediaTitle: media.title,
        artwork: media.backdrop_path ?? media.poster_path ?? null,
        score: typeof rating?.score === "number" ? rating.score : null,
        item: fromDbMedia(media, ratingByMedia)
      }];
    });
    const nextProfileData: ProfileData = {
      followers: followers.count ?? 0,
      following: following.count ?? 0,
      tracked: completedStatusCount,
      watchEvents: watchCount.count ?? 0,
      screenTimeHours: Math.round(screenTimeMinutes / 60),
      historyUniqueTitles: completedStatusCount,
      averageRating: ratingsRows.length ? (ratingsRows.reduce((sum: number, row: any) => sum + Number(row.score), 0) / ratingsRows.length).toFixed(1) : "-",
      reviewCount: reviewCount.count ?? 0,
      listCount: listCount.count ?? 0,
      history: historyItems,
      reviews: reviewItems,
      favorites: favoriteItemsWithRuns,
      lists: lists,
      progressGroups,
      currentStreak,
      longestStreak,
      currentlyWatching: currentWithRuns.slice(0, 8),
      genreStats
    };
    setProfileData(nextProfileData);
    profileDataLoadedFor.current = userId;
    profileDataLoadedAt.current = Date.now();
    await AsyncStorage.setItem(storageKey, JSON.stringify(nextProfileData)).catch(() => undefined);
  }, [usableSession?.access_token, usableSession?.user.id]);

  const loadActive = useCallback(async () => {
    setError("");
    if (tab === "home") await loadHome();
    if (tab === "discover") await loadDiscover();
    if (tab === "calendar") await loadCalendar();
    if (tab === "library") await loadLibrary();
    if (tab === "profile" && !mfa.required) {
      if (profileView === "recommendations") {
        await loadRecommendations();
      } else {
        await loadProfileData(false);
      }
    }
  }, [loadCalendar, loadDiscover, loadHome, loadLibrary, loadProfileData, loadRecommendations, mfa.required, profileView, tab]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      if (!supabase) return;
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadActive()
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load MovieTracker."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadActive]);

  useEffect(() => {
    scrollToTop();
  }, [libraryFilter, profilePanel, profileView, searchMode, selectedList?.id, tab, scrollToTop]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    homeLoadedKey.current = null;
    homeLoadedAt.current = 0;
    libraryLoadedKey.current = null;
    libraryLoadedAt.current = 0;
    recommendationLoadedKey.current = null;
    recommendationLoadedAt.current = 0;
    profileDataLoadedFor.current = null;
    profileDataLoadedAt.current = 0;
    const work = tab === "home" ? loadHome(true) : tab === "library" ? loadLibrary(true) : tab === "profile" && profileView !== "recommendations" ? loadProfileData(true) : loadActive();
    await work.catch(reason => setError(reason instanceof Error ? reason.message : "Could not refresh."));
    setRefreshing(false);
  }, [loadActive, loadHome, loadLibrary, loadProfileData, profileView, tab]);

  const openItem = useCallback((item: MediaSummary) => {
    setActionItem(null);
    setSelectedEpisode(null);
    setSelectedSeason(null);
    setSelectedSeriesEpisodes(null);
    setSelectedEntity(null);
    if (selected && (selected.kind !== item.kind || selected.id !== item.id)) setSelectedStack(current => [...current, selected]);
    setSelected(item);
  }, [selected]);

  const closeSelected = useCallback(() => {
    setSelectedStack(current => {
      const previous = current[current.length - 1] ?? null;
      setSelected(previous);
      return previous ? current.slice(0, -1) : [];
    });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (picker) { setPicker(null); return true; }
      if (actionItem) { setActionItem(null); return true; }
      if (selectedEntity) { setSelectedEntity(null); return true; }
      if (selectedEpisode) { setSelectedEpisode(null); return true; }
      if (selectedSeason) { setSelectedSeason(null); return true; }
      if (selectedSeriesEpisodes) { setSelectedSeriesEpisodes(null); return true; }
      if (selected) { closeSelected(); return true; }
      if (selectedList) { setSelectedList(null); setSelectedListFeed(emptyFeed); return true; }
      if (searchMode) { setSearchMode(false); return true; }
      if (tab === "profile" && profileView !== "profile") { openProfileView("profile"); return true; }
      if (tab !== "home") { goTab("home"); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [actionItem, closeSelected, goTab, openProfileView, picker, profileView, searchMode, selected, selectedEntity, selectedEpisode, selectedList, selectedSeason, selectedSeriesEpisodes, tab]);

  const openEntity = useCallback((entity: EntityTarget) => {
    setActionItem(null);
    setSelectedEntity(entity);
  }, []);

  const refreshAfterAction = useCallback(async (reason: ActionRefreshReason = "profile") => {
    libraryLoadedKey.current = null;
    libraryLoadedAt.current = 0;
    profileDataLoadedFor.current = null;
    profileDataLoadedAt.current = 0;
    if (usableSession?.user.id && usableSession.access_token && (reason === "list" || reason === "watch" || reason === "profile")) {
      void scheduleEpisodeNotifications(usableSession.user.id, usableSession.access_token).catch(() => undefined);
    }
    if (reason === "list") {
      if (selectedList?.id) setSelectedListFeed(await loadListFeed(selectedList.id, usableSession?.user.id));
      if (usableSession?.user.id && tab === "profile") {
        const nextLists = await loadUserLists(usableSession.user.id);
        setProfileData(current => ({ ...current, lists: nextLists, listCount: nextLists.length }));
      }
      if (tab === "library" && libraryFilter === "lists" && usableSession?.user.id) {
        setLibraryLists(await loadUserLists(usableSession.user.id));
      }
      return;
    }
    recommendationLoadedKey.current = null;
    recommendationLoadedAt.current = 0;
    if (usableSession?.access_token) void refreshRecommendations(usableSession.access_token).catch(() => undefined);
    if (tab === "profile") void loadProfileData(true).catch(() => undefined);
    if (tab === "library") void loadLibrary(true).catch(() => undefined);
    if (tab === "calendar") void loadCalendar().catch(() => undefined);
  }, [libraryFilter, loadCalendar, loadLibrary, loadProfileData, selectedList?.id, tab, usableSession?.access_token, usableSession?.user.id]);

  const activeFeed = featureView ? emptyFeed : searchMode ? searchFeed : selectedList ? selectedListFeed : tab === "discover" ? discoverFeed : tab === "calendar" ? calendarFeed : tab === "library" ? libraryFeed : tab === "profile" && profileView === "recommendations" ? recommendationFeed : emptyFeed;
  useEffect(() => {
    const items = activeFeed.items.slice(0, 4);
    if (!items.length) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const queue = [...items];
        const worker = async () => {
          while (!cancelled) {
            const item = queue.shift();
            if (!item) return;
            const cacheKey = titleDetailCacheKey(item, usableSession?.user.id);
            if (homeDetailPrefetchKeys.current.has(cacheKey)) continue;
            homeDetailPrefetchKeys.current.add(cacheKey);
            const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
            if (cached) {
              try { if (JSON.parse(cached)?.detail?.completeness === "full") continue; } catch { /* Replace malformed or core-only cache entries. */ }
            }
            const detail = await fetchMobileTitle(item.kind, item.id, usableSession?.access_token, "full").catch(() => null);
            if (!cancelled && detail) await AsyncStorage.setItem(cacheKey, JSON.stringify({ detail, savedAt: Date.now() })).catch(() => undefined);
          }
        };
        await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
      })();
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [activeFeed.items, usableSession?.access_token, usableSession?.user.id]);
  const profileTitle = profile?.display_name || profile?.username || usableSession?.user.user_metadata?.display_name || usableSession?.user.email || "Your MovieTracker";
  const headerSession = useMemo(() => {
    if (!usableSession || !profile?.avatar_url) return usableSession;
    return { ...usableSession, user: { ...usableSession.user, user_metadata: { ...usableSession.user.user_metadata, avatar_url: profile.avatar_url } } } as Session;
  }, [profile?.avatar_url, usableSession]);

  const pickerHelpers = useMemo(() => ({
    discover(field: "kind" | "genre" | "country" | "sort" | "excludeGenres", anchor?: PickerAnchor) {
      if (field === "kind") setPicker({ title: "Format", value: discoverFilters.kind, anchor, options: [{ value: "all", label: "Movies & series" }, { value: "movie", label: "Movies" }, { value: "show", label: "Series" }], onPick: value => setDiscoverFilters(current => ({ ...current, kind: value as DiscoverFilters["kind"] })) });
      if (field === "genre") setPicker({ title: "Genre", value: discoverFilters.genre, anchor, options: genres, onPick: value => setDiscoverFilters(current => ({ ...current, genre: value })) });
      if (field === "country") setPicker({ title: "Country", value: discoverFilters.country, anchor, options: countries, onPick: value => setDiscoverFilters(current => ({ ...current, country: value })) });
      if (field === "sort") setPicker({ title: "Sort by", value: discoverFilters.sort, anchor, options: [{ value: "popularity", label: "Most popular" }, { value: "rating", label: "Highest rated" }, { value: "newest", label: "Newest releases" }], onPick: value => setDiscoverFilters(current => ({ ...current, sort: value as DiscoverFilters["sort"] })) });
      if (field === "excludeGenres") setPicker({ title: "Exclude genres", value: "", anchor, options: excludeGenreOptions, multiValues: discoverFilters.excludeGenres, onPick: () => undefined, onApply: values => setDiscoverFilters(current => ({ ...current, excludeGenres: values })) });
    },
    recommendations(field: "kind" | "genre" | "country" | "excludeGenres", anchor?: PickerAnchor) {
      if (field === "kind") setPicker({ title: "Format", value: recommendationFilters.kind, anchor, options: [{ value: "all", label: "Movies & series" }, { value: "movie", label: "Movies" }, { value: "show", label: "Series" }], onPick: value => setRecommendationFilters(current => ({ ...current, kind: value as RecommendationFilters["kind"] })) });
      if (field === "genre") setPicker({ title: "Genre", value: recommendationFilters.genre, anchor, options: genres, onPick: value => setRecommendationFilters(current => ({ ...current, genre: value })) });
      if (field === "country") setPicker({ title: "Country", value: recommendationFilters.country, anchor, options: countries, onPick: value => setRecommendationFilters(current => ({ ...current, country: value })) });
      if (field === "excludeGenres") setPicker({ title: "Exclude genres", value: "", anchor, options: excludeGenreOptions, multiValues: recommendationFilters.excludeGenres, onPick: () => undefined, onApply: values => setRecommendationFilters(current => ({ ...current, excludeGenres: values })) });
    }
  }), [discoverFilters, recommendationFilters]);

  async function submitAuth() {
    if (!supabase || !HAS_SUPABASE) return Alert.alert("Login unavailable", "Supabase is not configured in this build.");
    if (!email.trim() || !password) return Alert.alert("Missing details", "Enter your email and password.");
    setAuthBusy(true);
    try {
      const credentials = { email: email.trim(), password };
      const { error: authError } = authMode === "sign-in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);
      if (authError) throw authError;
      if (authMode === "sign-up") {
        await supabase.auth.signOut();
        setSession(null);
        Alert.alert("Verify your email", "Check your inbox and verify your account before signing in.");
        setAuthMode("sign-in");
      }
      setPassword("");
    } catch (reason) {
      Alert.alert("Could not sign in", reason instanceof Error ? reason.message : "Try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function submitGoogleAuth() {
    if (!supabase || !HAS_SUPABASE) return Alert.alert("Login unavailable", "Supabase is not configured in this build.");
    setAuthBusy(true);
    try {
      const redirectTo = "movietracker://auth/callback";
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true }
      });
      if (oauthError) throw oauthError;
      if (!data.url) throw new Error("Supabase did not return a Google login URL.");
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success") return;
      const parsed = new URL(result.url.replace("#", "?"));
      const accessToken = parsed.searchParams.get("access_token");
      const refreshToken = parsed.searchParams.get("refresh_token");
      const code = parsed.searchParams.get("code");
      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (sessionError) throw sessionError;
      } else if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
      } else {
        throw new Error("Google login returned without a session.");
      }
      const { data: sessionData } = await supabase.auth.getSession();
      await acceptSession(sessionData.session ?? null);
      setProfileView("profile");
      setTab("profile");
    } catch (reason) {
      Alert.alert("Google sign-in failed", reason instanceof Error ? reason.message : "Could not sign in with Google.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    await supabase?.auth.signOut();
    setSession(null);
    setRecommendationFeed(emptyFeed);
    setLibraryFeed(emptyFeed);
    setProgressCounts(blankProgress);
    setProfile(null);
    setProfileData(blankProfileData);
    profileDataLoadedFor.current = null;
    profileDataLoadedAt.current = 0;
    libraryLoadedKey.current = null;
    libraryLoadedAt.current = 0;
    recommendationLoadedKey.current = null;
    recommendationLoadedAt.current = 0;
    setMfa({ required: false, code: "" });
  }

  async function verifyMfa() {
    if (!supabase || !mfa.factorId || !mfa.challengeId) return;
    const code = mfa.code.replace(/\D/g, "");
    if (code.length !== 6) {
      setMfa(current => ({ ...current, error: "Enter the 6-digit code from your authenticator app." }));
      return;
    }
    setMfaBusy(true);
    try {
      const { error: verifyError } = await withTimeout(
        supabase.auth.mfa.verify({ factorId: mfa.factorId, challengeId: mfa.challengeId, code }),
        12_000,
        "Two-step verification timed out. Please try a new code."
      );
      if (verifyError) throw verifyError;
      const { data: assurance, error: assuranceError } = await withTimeout(
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        12_000,
        "Could not confirm two-step verification. Please try again."
      );
      if (assuranceError || assurance?.currentLevel !== "aal2") throw assuranceError ?? new Error("Verification did not finish. Please try a new code.");
      setMfa({ required: false, code: "" });
      const { data } = await supabase.auth.getSession();
      await acceptSession(data.session ?? session);
      await loadLibrary();
      await loadProfileData();
      await loadRecommendations();
    } catch (reason) {
      setMfa(current => ({ ...current, error: reason instanceof Error ? reason.message : "That code did not work." }));
    } finally {
      setMfaBusy(false);
    }
  }

  async function refreshPicks() {
    const currentSession = usableSession ?? (await supabase?.auth.getSession())?.data.session ?? null;
    if (mfa.required) return Alert.alert("Authenticator needed", "Verify your authenticator code before loading recommendations.");
    if (!currentSession?.access_token) return Alert.alert("Sign in needed", "Recommendations use your MovieTracker account.");
    setRefreshing(true);
    try {
      await refreshRecommendations(currentSession.access_token);
      recommendationLoadedKey.current = null;
      recommendationLoadedAt.current = 0;
      await loadRecommendations(recommendationFilters, true);
    } catch (reason) {
      Alert.alert("Could not refresh picks", reason instanceof Error ? reason.message : "Your app session is signed in, but the website recommendation endpoint did not return picks.");
    } finally {
      setRefreshing(false);
    }
  }

  async function hideRecommendation(item: MediaSummary) {
    if (!usableSession?.access_token) return;
    setActionItem(null);
    setRecommendationFeed(current => ({ ...current, items: current.items.filter(candidate => candidate.kind !== item.kind || candidate.id !== item.id) }));
    await setNotInterested(item, usableSession.access_token).catch(() => undefined);
  }

  async function loadMoreActive() {
    if (loadingMore || loading || refreshing || selectedList || searchMode) return;
    setLoadingMore(true);
    try {
      if (tab === "profile" && profileView === "recommendations" && usableSession?.access_token && recommendationFeed.nextCursor != null) {
        const next = await fetchRecommendations(recommendationFilters, usableSession.access_token, recommendationFeed.nextCursor);
        setRecommendationFeed(current => {
          const seen = new Set(current.items.map(item => `${item.kind}-${item.id}`));
          return {
            ...next,
            items: [...current.items, ...next.items.filter(item => !seen.has(`${item.kind}-${item.id}`))]
          };
        });
      } else if (tab === "discover" && (discoverFeed.page ?? 1) < (discoverFeed.totalPages ?? 1)) {
        const next = await fetchDiscover(discoverFilters, (discoverFeed.page ?? 1) + 1, usableSession?.access_token);
        setDiscoverFeed(current => {
          const seen = new Set(current.items.map(item => `${item.kind}-${item.id}`));
          return {
            ...next,
            items: [...current.items, ...next.items.filter(item => !seen.has(`${item.kind}-${item.id}`))]
          };
        });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load more titles.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function removeHistoryEvent(eventId: string, title: string, onSuccess?: () => void) {
    if (!usableSession?.user.id || !supabase) return;
    const client = supabase;
    const userId = usableSession.user.id;
    Alert.alert("Remove watch?", `Remove this ${title} watch from your history?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setRefreshing(true);
          try {
            const { error: deleteError } = await client.from("watch_events").delete().eq("id", eventId).eq("user_id", userId);
            if (deleteError) throw deleteError;
            onSuccess?.();
            await loadProfileData();
          } catch (reason) {
            Alert.alert("Could not remove watch", reason instanceof Error ? reason.message : "Try again.");
          } finally {
            setRefreshing(false);
          }
        }
      }
    ]);
  }

  function openDiscoverSection(title: string) {
    const normalized = title.toLowerCase();
    if (normalized.includes("film")) setDiscoverFilters({ ...initialDiscoverFilters, kind: "movie", sort: "newest", view: "films" });
    else if (normalized.includes("series")) setDiscoverFilters({ ...initialDiscoverFilters, kind: "show", sort: "newest", view: "series" });
    else setDiscoverFilters({ ...initialDiscoverFilters, view: "trending" });
    goTab("discover");
  }

  function openCalendarEvent(event: CalendarEvent) {
    if (event.episodeTarget) {
      setSelected(null);
      setSelectedStack([]);
      setSelectedEntity(null);
      setSelectedSeason(null);
      setSelectedSeriesEpisodes(null);
      setSelectedEpisode(event.episodeTarget);
      return;
    }
    if (event.item) openItem(event.item);
  }

  function openHistoryItem(item: HistoryItem) {
    if (item.episodeTarget) {
      setSelected(null);
      setSelectedStack([]);
      setSelectedEntity(null);
      setSelectedSeason(null);
      setSelectedSeriesEpisodes(null);
      setSelectedEpisode(item.episodeTarget);
      return;
    }
    if (item.item) openItem(item.item);
  }

  const selectedListFranchiseGroups = useMemo(() => availableListFranchiseGroups(selectedListFeed.items), [selectedListFeed.items]);
  const sortedSelectedListItems = useMemo(() => sortListItems(selectedListFeed.items, listSort), [listSort, selectedListFeed.items]);

  function renderHeader() {
    if (featureView === "tonight") {
      return <><AppHeader session={headerSession} onHome={() => goTab("home")} onSearch={() => setSearchMode(true)} onNotifications={() => openProfileView("notifications")} onProfile={() => openProfileView("profile")} /><TonightScreen token={usableSession?.access_token} onBack={() => setFeatureView(null)} onOpen={openItem} /></>;
    }
    if (featureView === "up-next") {
      return <><AppHeader session={headerSession} onHome={() => goTab("home")} onSearch={() => setSearchMode(true)} onNotifications={() => openProfileView("notifications")} onProfile={() => openProfileView("profile")} />{usableSession ? <UpNextScreen token={usableSession.access_token} onBack={() => setFeatureView(null)} onOpen={openItem} /> : <><SectionTitle kicker="Your unfinished viewing" title="Up Next" action="Back" onAction={() => setFeatureView(null)} /><EmptyPanel title="Sign in for Up Next" body="Your unfinished episodes and evening queue are private to your account." /></>}</>;
    }
    if (searchMode) {
      return (
        <>
          <AppHeader session={headerSession} onHome={() => goTab("home")} onSearch={() => undefined} onNotifications={() => openProfileView("notifications")} onProfile={() => { setSearchMode(false); openProfileView("profile"); }} />
          <SectionTitle kicker="Across films and television" title="Search" action="Close" onAction={() => { setSearchMode(false); setSearchFeed(emptyFeed); }} />
          <SearchPanel query={searchQuery} onQuery={setSearchQuery} onSearch={() => loadSearch()} onClear={() => { setSearchQuery(""); setSearchFeed(emptyFeed); }} />
          {searchLoading ? <View style={styles.searchResultsLoading}><ActivityIndicator color={colors.accent} /><Text style={styles.searchResultsLoadingText}>Searching titles and people...</Text></View> : null}
        </>
      );
    }
    if (selectedList) {
      return (
        <>
          <AppHeader session={headerSession} onHome={() => goTab("home")} onSearch={() => setSearchMode(true)} onNotifications={() => openProfileView("notifications")} onProfile={() => { setSelectedList(null); openProfileView("profile"); }} />
          <ListDetailHeader
            list={selectedList}
            loadedCount={selectedListFeed.items.length}
            sort={listSort}
            groupBy={listGroup}
            onSort={() => setPicker({ title: "Sort titles", value: listSort, options: listSortOptions, onPick: value => { setListSort(value as ListSort); setListGroup("none"); } })}
            onGroupBy={value => { setListGroup(value); setListSort(value === "collections" ? "none" : "list_order"); }}
            onBack={() => {
              setSelectedList(null);
              setSelectedListFeed(emptyFeed);
              setListGroup("none");
              setListSort("title_asc");
              setLibraryFilter("lists");
              setProfileView("profile");
              setProfilePanel("overview");
              goTab("library");
            }} />
          {listGroup === "collections" ? <GroupedListContent groups={groupedListItems(selectedListFeed.items, listGroup)} onOpen={openItem} onMenu={setActionItem} /> : null}
        </>
      );
    }
    return (
      <>
        <AppHeader session={headerSession} onHome={() => goTab("home")} onSearch={() => setSearchMode(true)} onNotifications={() => openProfileView("notifications")} onProfile={() => openProfileView("profile")} />
        {tab === "home" ? (
          <>
            <Hero item={homeHero[heroIndex] ?? null} index={heroIndex} count={homeHero.length} onOpen={openItem} onPrevious={() => setHeroIndex(index => (index - 1 + homeHero.length) % homeHero.length)} onNext={() => setHeroIndex(index => (index + 1) % homeHero.length)} />
            {homeSections.map(section => (
              <View key={section.title} style={styles.homeSection}>
                <SectionTitle kicker={section.kicker} title={section.title} action="View everything" onAction={() => openDiscoverSection(section.title)} />
                <CardGrid items={section.items} onOpen={openItem} onMenu={setActionItem} />
              </View>
            ))}
          </>
        ) : null}
        {tab === "discover" ? (
            <>
              <DiscoverHeading view={discoverFilters.view} onTonight={() => setFeatureView("tonight")} onForYou={() => openProfileView("recommendations")} />
            <DiscoverFiltersCard filters={discoverFilters} onChange={setDiscoverFilters} onSelect={pickerHelpers.discover} />
            <View style={styles.afterFilters} />
          </>
        ) : null}
        {tab === "calendar" ? (
          <>
            <SectionTitle kicker="Your viewing schedule and diary" title="Calendar" />
            {!authReady ? (
              <EmptyPanel title="Checking your account" body="Restoring your saved MovieTracker session." />
            ) : usableSession ? (
              <CalendarPanel mode={calendarMode} month={calendarMonth} events={calendarEvents} onMode={setCalendarMode} onMonth={setCalendarMonth} onOpen={openCalendarEvent} onMenu={setActionItem} />
            ) : (
              <EmptyPanel title="Sign in for your calendar" body="The app can show upcoming episodes and watched history after you sign in." action="Go to profile" onAction={() => goTab("profile")} />
            )}
          </>
        ) : null}
        {tab === "library" ? (
          <>
            <SectionTitle kicker="Your screen life" title="My library" action="Up Next ->" onAction={() => setFeatureView("up-next")} />
            {usableSession ? (
              <>
                <LibraryFilters value={libraryFilter} onChange={setLibraryFilter} />
                {libraryFilter === "lists" ? <ListGrid lists={libraryLists} onOpen={openList} /> : null}
              </>
            ) : (
              <AuthPanel email={email} password={password} mode={authMode} busy={authBusy} onEmail={setEmail} onPassword={setPassword} onMode={setAuthMode} onSubmit={submitAuth} onGoogle={submitGoogleAuth} />
            )}
          </>
        ) : null}
        {tab === "profile" ? (
          <>
            {!authReady ? (
              <>
                <SectionTitle kicker="Account" title="Checking sign in" />
                <EmptyPanel title="Restoring your session" body="Checking the account saved on this device." />
              </>
            ) : session && mfa.required ? (
              <>
                <SectionTitle kicker="Two-step verification" title="Confirm it's you" action="Sign out" onAction={signOut} />
                <MfaPanel code={mfa.code} error={mfa.error} busy={mfaBusy} onCode={code => setMfa(current => ({ ...current, code: code.replace(/\D/g, "").slice(0, 6), error: undefined }))} onVerify={verifyMfa} />
              </>
            ) : usableSession && profileView === "settings" ? (
              <SettingsScreen session={usableSession} profile={profile} tab={settingsTab} onTab={setSettingsTab} onBack={() => openProfileView("profile")} onSignOut={signOut} onSaved={async () => { await Promise.all([loadProfileInfo(), loadProfileData()]); }} />
            ) : usableSession && profileView === "recommendations" ? (
              <>
                <SectionTitle kicker="Calculated from your actual taste" title="For you" action="Back to profile ->" onAction={() => openProfileView("profile")} />
                <Text style={styles.recommendationIntro}>Personal picks shaped by your ratings, favorites, watch history and Trakt activity.</Text>
                <RecommendationFiltersCard filters={recommendationFilters} onChange={setRecommendationFilters} onSelect={pickerHelpers.recommendations} onRefresh={refreshPicks} />
                <View style={styles.afterFilters} />
              </>
            ) : usableSession && profileView === "notifications" ? (
              <NotificationScreen session={usableSession} onBack={() => openProfileView("profile")} />
            ) : usableSession && profileView === "history" ? (
              <FullHistoryPage data={profileData} token={usableSession.access_token} onOpen={openHistoryItem} onMenu={setActionItem} onBack={() => openProfileView("profile")} onRemove={removeHistoryEvent} onScrollTop={scrollToTop} />
            ) : usableSession && profileView === "reviews" ? (
              <FullReviewsPage reviews={profileData.reviews} onBack={() => openProfileView("profile")} onOpen={openItem} />
            ) : usableSession && profileView === "statistics" ? (
              <StatisticsPage data={profileData} onBack={() => openProfileView("profile")} onWrapped={() => openProfileView("wrapped")} onOpen={openItem} onGenreShelf={offset => setTimeout(() => listRef.current?.scrollToOffset({ offset, animated: true }), 80)} />
            ) : usableSession && profileView === "wrapped" ? (
              <WrappedScreen token={usableSession.access_token} onBack={() => openProfileView("statistics")} />
            ) : usableSession ? (
              <>
                <ProfileHero profile={profile} session={usableSession} data={profileData} fallbackName={profileTitle} onSettings={() => { setSettingsTab("profile"); openProfileView("settings"); }} />
                <ProfileNav value={profilePanel} onChange={next => {
                  if (next === "history") openProfileView("history");
                  else if (next === "reviews") openProfileView("reviews");
                  else if (next === "statistics") openProfileView("statistics");
                  else if (next === "lists") { setLibraryFilter("lists"); goTab("library"); }
                  else setProfilePanel(next);
                }} />
                {(profilePanel === "overview" || profilePanel === "statistics") ? <ProfileStatBand data={profileData} onNavigate={target => {
                  if (target === "completed") { setLibraryFilter("completed"); goTab("library"); }
                  if (target === "history") openProfileView("history");
                  if (target === "reviews") openProfileView("reviews");
                  if (target === "lists") { setLibraryFilter("lists"); goTab("library"); }
                }} /> : null}
                {(profilePanel === "overview" || profilePanel === "history" || profilePanel === "activity") ? <ProfileHistorySection items={profileData.history} onOpen={openHistoryItem} onMenu={setActionItem} onHistory={() => openProfileView("history")} /> : null}
                {(profilePanel === "overview" || profilePanel === "statistics") ? <ProfileProgressSection data={profileData} onLibrary={() => { setLibraryFilter("all"); goTab("library"); }} onStatus={status => { setLibraryFilter(status === "active" ? "watching" : status); goTab("library"); }} onWatching={() => { setLibraryFilter("watching"); goTab("library"); }} onOpen={openItem} onMenu={setActionItem} /> : null}
                {(profilePanel === "overview" || profilePanel === "reviews") ? <ReviewSection reviews={profileData.reviews} onAll={() => openProfileView("reviews")} onOpen={openItem} /> : null}
                {profilePanel === "overview" ? <><ProfileMediaSection kicker="Personal canon" title="Favorites" action="See all favorites ->" items={profileData.favorites.slice(0, 6)} onAction={() => { setLibraryFilter("favorites"); goTab("library"); }} onOpen={openItem} onMenu={setActionItem} /><ProfileListsSection owner={profile?.display_name || profile?.username || "you"} lists={profileData.lists} onOpenLists={() => { setLibraryFilter("lists"); goTab("library"); }} onOpenList={openList} /></> : null}
                <ProfileShortcuts onCalendar={() => goTab("calendar")} onHistory={() => openProfileView("history")} onReviews={() => openProfileView("reviews")} onSettings={() => openProfileView("settings")} />
              </>
            ) : (
              <>
                <SectionTitle kicker="Account" title="Sign in" />
                <AuthPanel email={email} password={password} mode={authMode} busy={authBusy} onEmail={setEmail} onPassword={setPassword} onMode={setAuthMode} onSubmit={submitAuth} onGoogle={submitGoogleAuth} />
              </>
            )}
          </>
        ) : null}
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </>
    );
  }

  const listHeader = renderHeader();

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar hidden />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        {selectedEntity ? (
          <EntityScreen target={selectedEntity} session={usableSession} onBack={() => setSelectedEntity(null)} onOpen={openItem} onMenu={setActionItem} />
        ) : selectedEpisode ? (
          <EpisodeDetailScreen target={selectedEpisode} session={usableSession} onBack={() => setSelectedEpisode(null)} onOpen={openItem} onOpenEntity={openEntity} onChanged={refreshAfterAction} onOpenSeason={(season, show, seasons) => {
            setSelectedEpisode(null);
            if (isLimitedSeries(show, seasons)) setSelectedSeriesEpisodes({ show, seasons });
            else setSelectedSeason({ show, season });
          }} />
        ) : selectedSeriesEpisodes ? (
          <SeriesEpisodesScreen target={selectedSeriesEpisodes} session={usableSession} onBack={() => setSelectedSeriesEpisodes(null)} onOpenSeason={season => {
            if (isLimitedSeries(selectedSeriesEpisodes.show, selectedSeriesEpisodes.seasons)) return;
            setSelectedSeriesEpisodes(null);
            setSelectedSeason({ show: selectedSeriesEpisodes.show, season });
          }} onOpenEpisode={(season, episode) => setSelectedEpisode({
            episodeId: Number(episode.db_episode_id ?? episode.episodeDbId ?? episode.episode_id ?? 0) || undefined,
            show: selectedSeriesEpisodes.show,
            seasonNumber: season.seasonNumber,
            episodeNumber: Number(episode.episode_number ?? episode.episodeNumber ?? 0),
            title: episode.name ?? null,
            overview: episode.overview ?? null,
            airDate: episode.air_date ?? episode.airDate ?? null,
            artwork: episode.still_path ?? episode.stillPath ?? selectedSeriesEpisodes.show.backdropPath ?? selectedSeriesEpisodes.show.posterPath,
            runtime: episode.runtime ?? null,
            voteAverage: episode.vote_average ?? episode.voteAverage ?? null
          })} />
        ) : selectedSeason ? (
          <SeasonDetailScreen target={selectedSeason} session={usableSession} onBack={() => setSelectedSeason(null)} onOpenEpisode={episode => setSelectedEpisode({
            episodeId: Number(episode.db_episode_id ?? episode.episodeDbId ?? episode.episode_id ?? 0) || undefined,
            show: selectedSeason.show,
            seasonNumber: selectedSeason.season.seasonNumber,
            episodeNumber: Number(episode.episode_number ?? episode.episodeNumber ?? 0),
            title: episode.name ?? null,
            overview: episode.overview ?? null,
            airDate: episode.air_date ?? episode.airDate ?? null,
            artwork: episode.still_path ?? episode.stillPath ?? selectedSeason.show.backdropPath ?? selectedSeason.show.posterPath,
            runtime: episode.runtime ?? null,
            voteAverage: episode.vote_average ?? episode.voteAverage ?? null
          })} />
        ) : selected ? (
          <DetailScreenV2 key={`${selected.kind}-${selected.id}`} item={selected} session={usableSession} onBack={closeSelected} onOpen={openItem} onOpenEntity={openEntity} onOpenSeason={season => setSelectedSeason({ show: selected, season })} onOpenAllSeasons={seasons => setSelectedSeriesEpisodes({ show: selected, seasons })} onHide={hideRecommendation} onChanged={refreshAfterAction} />
        ) : selectedList && listGroup === "collections" ? (
          <ScrollView contentContainerStyle={styles.listContent} refreshControl={<RefreshControl tintColor={colors.accent} refreshing={refreshing} onRefresh={refresh} />}>{listHeader}</ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={selectedList && listGroup === "none" ? sortedSelectedListItems : selectedList ? [] : activeFeed.items}
            keyExtractor={(item, index) => `${item.kind}-${item.id}-${item.reason ?? index}`}
            numColumns={2}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={!loading && !featureView ? (selectedList && listGroup === "none" ? <EmptyPanel title="No titles in this list yet" body="Add titles from search, discovery, or a title page." /> : !selectedList && tab !== "home" && tab !== "calendar" && !(tab === "library" && libraryFilter === "lists" && !selectedList) && !(tab === "profile" && (profileView !== "recommendations" || !usableSession || mfa.required)) ? <EmptyPanel title="Nothing loaded yet" body={searchMode ? "Search for a title, person, or keyword." : emptyText(tab, Boolean(usableSession))} /> : null) : null}
            contentContainerStyle={styles.listContent}
            columnWrapperStyle={styles.columns}
            refreshControl={<RefreshControl tintColor={colors.accent} refreshing={refreshing} onRefresh={refresh} />}
            renderItem={({ item }) => <TitleCard item={item} onOpen={openItem} onMenu={setActionItem} />}
            onEndReached={loadMoreActive}
            onEndReachedThreshold={0.75}
            ListFooterComponent={loadingMore ? <View style={styles.feedFooter}><ActivityIndicator color={colors.accent} /><Text style={styles.feedFooterText}>Loading more titles...</Text></View> : null}
          />
        )}
      </KeyboardAvoidingView>
      {loading ? <View pointerEvents="none" style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View> : null}
      <BottomNav tab={tab} onTab={goTab} />
      <PickerSheet title={picker?.title ?? ""} visible={Boolean(picker)} options={picker?.options ?? []} value={picker?.value ?? ""} multiValues={picker?.multiValues} anchor={picker?.anchor} onPick={value => picker?.onPick(value)} onApply={values => picker?.onApply?.(values)} onClose={() => setPicker(null)} />
      <MovieActionSheet item={actionItem} visible={Boolean(actionItem)} session={usableSession} currentList={selectedList} franchiseGroups={selectedListFranchiseGroups} allowNotInterested={tab === "profile" && profileView === "recommendations" && !selectedList && !selected} onClose={() => setActionItem(null)} onOpen={openItem} onNotInterested={hideRecommendation} onChanged={refreshAfterAction} />
    </SafeAreaView>
  );
}

function PosterRail({ section, onOpen, onMenu }: { section: HomeSection; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  if (!section.items.length) return null;
  return (
    <View style={styles.railBlock}>
      <SectionTitle kicker={section.kicker} title={section.title} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent}>
        {section.items.map(item => <RailCard key={`${section.title}-${item.kind}-${item.id}`} item={item} onOpen={onOpen} onMenu={onMenu} />)}
      </ScrollView>
    </View>
  );
}

function RailCard({ item, onOpen, onMenu }: { item: MediaSummary; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  const image = tmdbImage(item.posterPath || item.backdropPath, "w342");
  const longPressed = useRef(false);
  return (
    <Pressable
      onPress={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        onOpen(item);
      }}
      onLongPress={() => {
        longPressed.current = true;
        onMenu(item);
      }}
      delayLongPress={360}
      style={styles.railCard}
    >
      <View style={styles.railPoster}>
        {image ? <RemoteImage uri={image} style={styles.posterImage} resizeMode="cover" /> : <Text style={styles.posterFallback}>{item.title}</Text>}
        {userRatingLabel(item) ? <View style={styles.railRating}><Text style={styles.railRatingText}>{userRatingLabel(item)}</Text></View> : null}
      </View>
      <Text style={styles.railTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={styles.railMeta} numberOfLines={1}>{titleYear(item)} - {item.kind === "show" ? "Series" : "Film"}</Text>
    </Pressable>
  );
}

function CardGrid({ items, onOpen, onMenu }: { items: MediaSummary[]; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  return (
    <View style={styles.inlineGrid}>
      {items.map(item => <TitleCard key={`${item.kind}-${item.id}`} item={item} onOpen={onOpen} onMenu={onMenu} />)}
    </View>
  );
}

function SearchPanel({ query, onQuery, onSearch, onClear }: { query: string; onQuery: (value: string) => void; onSearch: () => void; onClear: () => void }) {
  return (
    <View style={styles.searchPanel}>
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={22} color={colors.muted} />
        <TextInput value={query} onChangeText={onQuery} onSubmitEditing={onSearch} autoCapitalize="none" autoCorrect={false} returnKeyType="search" placeholder="Title, person, or keyword..." placeholderTextColor="#6f7477" style={styles.searchInput} />
        {query ? (
          <Pressable onPress={onClear} hitSlop={10} style={styles.searchClearButton}>
            <Ionicons name="close-circle" size={22} color={colors.muted} />
            <Text style={styles.searchClearText}>Clear all</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable onPress={onSearch} style={styles.searchButton}>
        <Text style={styles.searchButtonText}>Search</Text>
      </Pressable>
    </View>
  );
}

function DiscoverHeading({ view, onTonight, onForYou }: { view?: string; onTonight: () => void; onForYou: () => void }) {
  const heading = view === "trending"
    ? { kicker: "Everyone is watching", title: "Trending now" }
    : view === "films"
      ? { kicker: "Fresh from the cinema", title: "New & upcoming films" }
      : view === "series"
        ? { kicker: "Stories worth settling into", title: "Series premieres" }
        : { kicker: "Find your next obsession", title: "Discover" };
  return (
    <View style={styles.discoverHeading}>
      <View style={styles.discoverTitleCopy}>
        <Text style={styles.kickerText}>{heading.kicker}</Text>
        <Text style={styles.discoverTitle}>{heading.title}</Text>
      </View>
      <View style={styles.discoverHeadingActions}><Pressable onPress={onTonight} style={styles.forYouButton}><Ionicons name="moon-outline" size={18} color={colors.text} /><Text style={styles.forYouText}>Tonight</Text></Pressable><Pressable onPress={onForYou} style={styles.forYouButton}><Ionicons name="sparkles-outline" size={18} color={colors.text} /><Text style={styles.forYouText}>For you</Text></Pressable></View>
    </View>
  );
}

function ListDetailHeader({ list, loadedCount, sort, groupBy, onSort, onGroupBy, onBack }: { list: UserList; loadedCount?: number; sort: ListSort; groupBy: ListGroup; onSort: () => void; onGroupBy: (value: ListGroup) => void; onBack: () => void }) {
  const sortLabel = sort === "none" ? "—" : listSortOptions.find(option => option.value === sort)?.label ?? "Name A-Z";
  const displayCount = loadedCount ?? list.count;
  return (
    <View style={styles.listDetailHeader}>
      <Pressable onPress={onBack} style={styles.backChip}><Ionicons name="chevron-back" size={18} color={colors.text} /><Text style={styles.backChipText}>Lists</Text></Pressable>
      <PosterStack posters={list.posters} />
      <Text style={styles.listVisibility}>{list.visibility ?? "private"}</Text>
      <Text style={styles.listDetailTitle}>{list.name}</Text>
      <Text style={styles.listDetailBody}>{list.description || "A hand-picked collection."}</Text>
      <Text style={styles.listCount}>{displayCount} {displayCount === 1 ? "title" : "titles"}</Text>
      <View style={styles.listDetailTools}>
        <Pressable onPress={onSort} style={styles.groupChip}>
          <Ionicons name="swap-vertical-outline" size={15} color={colors.muted} />
          <Text style={styles.groupChipText} numberOfLines={1}>{sortLabel}</Text>
        </Pressable>
        <Pressable onPress={() => onGroupBy(groupBy === "collections" ? "none" : "collections")} style={[styles.groupChip, groupBy === "collections" && styles.groupChipActive]}>
          <Ionicons name="git-branch-outline" size={15} color={groupBy === "collections" ? colors.text : colors.muted} />
          <Text style={[styles.groupChipText, groupBy === "collections" && styles.groupChipTextActive]}>Group franchises</Text>
        </Pressable>
      </View>
    </View>
  );
}

function LibraryFilters({ value, onChange }: { value: LibraryFilter; onChange: (value: LibraryFilter) => void }) {
  const filters: Array<{ value: LibraryFilter; label: string; icon?: keyof typeof Ionicons.glyphMap }> = [
    { value: "all", label: "Everything" },
    { value: "planned", label: "Watchlist" },
    { value: "watching", label: "Watching" },
    { value: "completed", label: "Completed" },
    { value: "paused", label: "Paused" },
    { value: "dropped", label: "Dropped" },
    { value: "favorites", label: "Favorites", icon: "heart-outline" },
    { value: "lists", label: "Lists", icon: "list-outline" }
  ];
  return (
    <View style={styles.filterPills}>
      {filters.map(filter => (
        <Pressable key={filter.value} onPress={() => onChange(filter.value)} style={[styles.filterPill, value === filter.value && styles.filterPillActive]}>
          {filter.icon ? <Ionicons name={filter.icon} size={15} color={value === filter.value ? colors.text : colors.muted} /> : null}
          <Text style={[styles.filterPillText, value === filter.value && styles.filterPillTextActive]}>{filter.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CalendarPanel({ mode, month, events, onMode, onMonth, onOpen, onMenu }: { mode: CalendarMode; month: string; events: CalendarEvent[]; onMode: (mode: CalendarMode) => void; onMonth: (month: string) => void; onOpen: (event: CalendarEvent) => void; onMenu: (item: MediaSummary) => void }) {
  const { cells, label } = calendarCells(month);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [posterCalendar, setPosterCalendar] = useState(false);
  const eventsByDate = new Map<string, CalendarEvent[]>();
  events.forEach(event => eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]));
  const eventDays = [...eventsByDate.entries()].sort(([a], [b]) => b.localeCompare(a));
  const orderedEventDays = selectedDate ? [...eventDays].sort(([a], [b]) => a === selectedDate ? -1 : b === selectedDate ? 1 : 0) : eventDays;
  return (
    <View style={styles.calendarWrap}>
      <View style={styles.segmented}>
        <Pressable onPress={() => onMode("upcoming")} style={[styles.segment, mode === "upcoming" && styles.segmentActive]}><Text style={styles.segmentText}>Upcoming</Text></Pressable>
        <Pressable onPress={() => onMode("watched")} style={[styles.segment, mode === "watched" && styles.segmentActive]}><Text style={styles.segmentText}>Watched</Text></Pressable>
      </View>
      <View style={styles.monthToolbar}>
        <Pressable onPress={() => onMonth(shiftMonth(month, -1))} style={styles.monthButton}><Ionicons name="chevron-back" size={22} color={colors.text} /></Pressable>
        <Text style={styles.monthTitle}>{label}</Text>
        <Pressable onPress={() => onMonth(shiftMonth(month, 1))} style={styles.monthButton}><Ionicons name="chevron-forward" size={22} color={colors.text} /></Pressable>
      </View>
      <Pressable onPress={() => setPosterCalendar(value => !value)} style={styles.calendarDisplayToggle}>
        <Ionicons name={posterCalendar ? "grid-outline" : "image-outline"} size={15} color={colors.muted} />
        <Text style={styles.calendarDisplayToggleText}>{posterCalendar ? "Compact calendar" : "Poster calendar"}</Text>
      </Pressable>
      <View style={styles.calendarGrid}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}
        {cells.map((date, index) => {
          const dayEvents = date ? eventsByDate.get(date) ?? [] : [];
          const count = dayEvents.length;
          const today = date === localDateKey();
          return (
            <Pressable key={date ?? `blank-${index}`} disabled={!date || !count} onPress={() => date && setSelectedDate(date)} style={[styles.dayCell, posterCalendar && styles.dayCellPosterMode, !date && styles.blankDay, today && styles.todayCell, date === selectedDate && styles.selectedDayCell]}>
              {date ? <Text style={[styles.dayText, today && styles.todayText]}>{Number(date.slice(8, 10))}</Text> : null}
              {count ? <Text style={styles.dayCount}>{count}</Text> : null}
              {posterCalendar && count ? <View style={styles.dayPosterStrip}>{dayEvents.slice(0, 2).map(event => {
                const thumb = tmdbImage(event.artwork, "w342");
                return thumb ? <RemoteImage key={event.id} uri={thumb} style={styles.dayPosterThumb} resizeMode="cover" /> : null;
              })}{count > 2 ? <Text style={styles.dayPosterMore}>+{count - 2}</Text> : null}</View> : null}
            </Pressable>
          );
        })}
      </View>
      {eventDays.length ? (
        <View style={styles.agenda}>
          {orderedEventDays.map(([date, dayEvents]) => (
            <View key={date} style={styles.agendaDay}>
              <View style={styles.agendaHeader}><Text style={styles.agendaDate}>{formatCalendarDate(date)}</Text><Text style={styles.agendaCount}>{dayEvents.length}</Text></View>
              {dayEvents.map(event => <AgendaRow key={event.id} event={event} onOpen={onOpen} onMenu={onMenu} />)}
            </View>
          ))}
        </View>
      ) : (
        <EmptyPanel title={mode === "watched" ? "Nothing logged this month" : "No upcoming episodes found"} body={mode === "watched" ? "Your watched movies and episodes will appear here." : "Track shows to populate upcoming air dates."} />
      )}
    </View>
  );
}

function AgendaRow({ event, onOpen, onMenu }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void; onMenu: (item: MediaSummary) => void }) {
  const image = tmdbImage(event.artwork, "w342");
  return (
    <Pressable onPress={() => onOpen(event)} onLongPress={() => event.item && onMenu(event.item)} delayLongPress={280} style={styles.agendaRow}>
      <View style={styles.agendaImage}>{image ? <RemoteImage uri={image} style={styles.posterImage} resizeMode="cover" /> : <Ionicons name="calendar-outline" size={20} color={colors.muted} />}</View>
      <View style={styles.agendaCopy}><Text style={styles.agendaTitle} numberOfLines={1}>{event.title}</Text><Text style={styles.agendaSub} numberOfLines={1}>{event.subtitle}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function NotificationScreen({ session, onBack }: { session: Session; onBack: () => void }) {
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

  return <View style={styles.profileSection}>
    <SectionTitle kicker="Signals, not noise" title="Notifications" action="Back to profile" onAction={onBack} />
    {loadingItems ? <ActivityIndicator color={colors.accent} /> : loadError ? <EmptyPanel title="Notifications did not load" body={loadError} action="Try again" onAction={() => void loadItems()} /> : items.length ? <View style={styles.notificationList}>{items.map(item => {
      const image = item.payload?.image;
      return <Pressable key={item.id} disabled={!item.payload?.href} onPress={() => item.payload?.href && WebBrowser.openBrowserAsync(`${API_URL}${item.payload.href}`)} style={[styles.notificationCard, !item.read_at && styles.notificationCardUnread]}>
        {image ? <RemoteImage uri={image} style={styles.notificationImage} /> : <View style={styles.notificationIcon}><Ionicons name={item.kind === "episode_release" ? "film-outline" : "notifications-outline"} size={22} color={colors.accent} /></View>}
        <View style={styles.notificationCopy}><Text style={styles.notificationTitle}>{item.payload?.title ?? "MovieTracker"}</Text><Text style={styles.notificationBody}>{item.payload?.message ?? String(item.kind).replaceAll("_", " ")}</Text><Text style={styles.notificationDate}>{new Date(item.created_at).toLocaleString()}</Text></View>
        {item.payload?.href ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
      </Pressable>;
    })}</View> : <EmptyPanel title="All quiet" body="New episode releases and account activity will appear here." />}
  </View>;
}

function ProfileStatBand({ data, onNavigate }: { data: ProfileData; onNavigate?: (target: "completed" | "history" | "reviews" | "lists") => void }) {
  const stats = [
    { icon: "film-outline" as const, value: data.tracked, label: "unique watched titles", target: "completed" as const },
    { icon: "time-outline" as const, value: data.watchEvents, label: "watch events", target: "history" as const },
    { icon: "speedometer-outline" as const, value: data.averageRating, label: "average rating", target: "reviews" as const },
    { icon: "chatbox-outline" as const, value: data.reviewCount, label: "reviews", target: "reviews" as const },
    { icon: "list-outline" as const, value: data.listCount, label: "lists", target: "lists" as const }
  ];
  return (
    <View style={styles.profileStats}>
      {stats.map((stat, index) => (
        <Pressable key={stat.label} onPress={() => onNavigate?.(stat.target)} style={[styles.profileStat, index % 2 === 0 && styles.profileStatRight, index < 4 && styles.profileStatBottom]}>
          <Ionicons name={stat.icon} size={19} color={colors.accent} />
          <Text style={styles.profileStatValue}>{stat.value}</Text>
          <Text style={styles.profileStatLabel}>{stat.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ProfileNav({ value, onChange }: { value: ProfilePanel; onChange: (value: ProfilePanel) => void }) {
  const tabs: Array<{ value: ProfilePanel; label: string }> = [
    { value: "overview", label: "Overview" },
    { value: "activity", label: "Activity" },
    { value: "lists", label: "Lists" },
    { value: "reviews", label: "Reviews" },
    { value: "history", label: "Full history" },
    { value: "statistics", label: "Statistics" }
  ];
  return (
    <View style={styles.profileNavOuter}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileNav}>
        {tabs.map(tab => (
          <Pressable key={tab.value} onPress={() => onChange(tab.value)} style={[styles.profileNavPill, value === tab.value && styles.profileNavPillActive]}>
            <Text style={[styles.profileNavText, value === tab.value && styles.profileNavTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function ProfileHistorySection({ items, onOpen, onMenu, onHistory }: { items: HistoryItem[]; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void; onHistory: () => void }) {
  if (!items.length) return null;
  return <View style={styles.profileSection}><SectionTitle kicker="A dated viewing diary" title="Recent history" action="See complete history ->" onAction={onHistory} /><View style={styles.historyGrid}>{items.slice(0, 6).map(item => <HistoryCard key={item.id} item={item} onOpen={onOpen} onMenu={onMenu} />)}</View></View>;
}

function FullHistoryPage({ data, token, onOpen, onMenu, onBack, onRemove, onScrollTop }: { data: ProfileData; token: string; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void; onBack: () => void; onRemove: (id: string, title: string, onSuccess?: () => void) => void; onScrollTop: () => void }) {
  const [items, setItems] = useState(() => data.history.map(normalizeHistoryItemTime));
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(data.history.length >= 40);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const groups = useMemo(() => {
    const grouped = new Map<string, HistoryItem[]>();
    items.forEach(item => {
      const existing = grouped.get(item.dateKey);
      if (existing) existing.push(item);
      else grouped.set(item.dateKey, [item]);
    });
    return [...grouped.entries()].map(([dateKey, dayItems]) => ({ dateKey, dateTitle: dayItems[0]?.dateTitle ?? "Unknown", dateSubtitle: dayItems[0]?.dateSubtitle ?? "Watched date not specified", items: dayItems }));
  }, [items]);
  useEffect(() => {
    let alive = true;
    setLoadingHistory(true);
    setHistoryError("");
    fetchMobileHistory(token, page, filter, query).then(result => {
      if (!alive) return;
      setItems((result.items ?? []).map(normalizeHistoryItemTime));
      setHasMore(result.hasMore);
    }).catch(reason => {
      if (alive) setHistoryError(reason instanceof Error ? reason.message : "Could not load this history page.");
    }).finally(() => { if (alive) setLoadingHistory(false); });
    return () => { alive = false; };
  }, [filter, page, query, token]);

  function changeFilter(next: HistoryFilter) {
    setLoadingHistory(true);
    setFilter(next);
    setPage(1);
    onScrollTop();
  }

  function submitSearch() {
    setLoadingHistory(true);
    setQuery(queryDraft.trim());
    setPage(1);
    onScrollTop();
  }

  function changePage(nextPage: number) {
    setLoadingHistory(true);
    setPage(Math.max(1, nextPage));
    onScrollTop();
  }

  function removeItem(id: string, title: string) {
    onRemove(id, title, () => setItems(current => current.filter(item => item.id !== id)));
  }

  return (
    <View style={styles.profileSection}>
      <SectionTitle kicker="Every play, kept in order" title="Watch history" action="Back to profile ->" onAction={onBack} />
      <View style={styles.historyTools}>
        <View style={styles.historySearchRow}>
          <Ionicons name="search-outline" size={19} color={colors.muted} />
          <TextInput value={queryDraft} onChangeText={setQueryDraft} onSubmitEditing={submitSearch} returnKeyType="search" placeholder="Search your watch history" placeholderTextColor={colors.muted} style={styles.historySearchInput} />
          {queryDraft ? <Pressable onPress={() => { setLoadingHistory(true); setQueryDraft(""); setQuery(""); setPage(1); onScrollTop(); }} hitSlop={8}><Ionicons name="close-circle" size={20} color={colors.muted} /></Pressable> : null}
          <Pressable disabled={loadingHistory} onPress={submitSearch} style={[styles.historySearchButton, loadingHistory && styles.historySearchButtonBusy]}>{loadingHistory ? <ActivityIndicator size="small" color={colors.text} /> : <Text style={styles.historySearchButtonText}>Search</Text>}</Pressable>
        </View>
        <View style={styles.historyFilterRow}>{([['all', 'Everything'], ['movies', 'Movies'], ['episodes', 'Episodes']] as Array<[HistoryFilter, string]>).map(([value, label]) => <Pressable key={value} onPress={() => changeFilter(value)} style={[styles.historyFilterPill, filter === value && styles.historyFilterPillActive]}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78} style={[styles.historyFilterText, filter === value && styles.historyFilterTextActive]}>{label}</Text></Pressable>)}</View>
      </View>
      {items.length ? (
        <>
          <View style={styles.historySummary}>
            <HistorySummary icon="time-outline" value={data.watchEvents} label="watch events" />
            <HistorySummary icon="time-outline" value={`${data.screenTimeHours}h`} label="screen time" />
            <HistorySummary icon="film-outline" value={data.historyUniqueTitles} label="unique titles" last />
          </View>
          <View style={styles.historyTimeline}>
            {groups.map(group => <MemoHistoryDay key={group.dateKey} group={group} onOpen={onOpen} onMenu={onMenu} onRemove={removeItem} />)}
          </View>
          <View style={styles.historyPager}>
            <Pressable disabled={page === 1 || loadingHistory} onPress={() => changePage(page - 1)} style={[styles.historyPageButton, (page === 1 || loadingHistory) && styles.historyPageButtonDisabled]}><Ionicons name="chevron-back" size={18} color={colors.text} /><Text style={styles.historyPageButtonText}>Newer</Text></Pressable>
            <Text style={styles.historyPageLabel}>Page {page}</Text>
            <Pressable disabled={!hasMore || loadingHistory} onPress={() => changePage(page + 1)} style={[styles.historyPageButton, (!hasMore || loadingHistory) && styles.historyPageButtonDisabled]}><Text style={styles.historyPageButtonText}>Older</Text><Ionicons name="chevron-forward" size={18} color={colors.text} /></Pressable>
          </View>
        </>
      ) : !loadingHistory ? <EmptyPanel title={query || filter !== "all" ? "No matching watches" : "No watch history yet"} body={query || filter !== "all" ? "Try another search or history filter." : "Your watched movies and episodes will appear here."} /> : null}
      {loadingHistory ? <View style={styles.historyInlineLoading}><ActivityIndicator color={colors.accent} /><Text style={styles.historyInlineLoadingText}>Loading history...</Text></View> : null}
      {historyError ? <Text style={styles.errorText}>{historyError}</Text> : null}
    </View>
  );
}

function HistorySummary({ icon, value, label, last }: { icon: keyof typeof Ionicons.glyphMap; value: string | number; label: string; last?: boolean }) {
  return <View style={[styles.historySummaryCell, last && styles.historySummaryCellLast]}><Ionicons name={icon} size={18} color={colors.accent} /><Text style={styles.historySummaryValue}>{value}</Text><Text style={styles.historySummaryLabel}>{label}</Text></View>;
}

function HistoryDay({ group, onOpen, onMenu, onRemove }: { group: { dateTitle: string; dateSubtitle: string; items: HistoryItem[] }; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void; onRemove: (id: string, title: string) => void }) {
  return (
    <View style={styles.historyDay}>
      <View style={styles.historyDayDate}><Text style={styles.historyDayTitle}>{group.dateTitle}</Text><Text style={styles.historyDaySub}>{group.dateSubtitle}</Text></View>
      <View style={styles.historyEventList}>{group.items.map(item => <MemoHistoryEventRow key={item.id} item={item} onOpen={onOpen} onMenu={onMenu} onRemove={onRemove} />)}</View>
    </View>
  );
}

function HistoryEventRow({ item, onOpen, onMenu, onRemove }: { item: HistoryItem; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void; onRemove: (id: string, title: string) => void }) {
  const image = tmdbImage(item.artwork, "w500");
  return (
    <Pressable onPress={() => onOpen(item)} onLongPress={() => item.item && onMenu(item.item)} delayLongPress={280} style={styles.historyEvent}>
      <View style={styles.historyEventArt}>{image ? <RemoteImage uri={image} style={styles.posterImage} resizeMode="cover" /> : <Ionicons name="film-outline" size={22} color={colors.muted} />}{item.rating != null ? <Text style={styles.historyRating}>{item.rating.toFixed(1)}<Text style={styles.historyRatingSmall}>/10</Text></Text> : null}</View>
      <View style={styles.historyEventCopy}>
        <Text style={styles.historyEventKicker}>{item.metaLabel}</Text>
        <Text style={styles.historyEventTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.historyEventSubtitle} numberOfLines={1}>{item.subtitle}</Text>
      </View>
      <View style={styles.historyEventMeta}>
        {item.rewatchNumber ? <View style={styles.historyMetaInline}><Ionicons name="refresh-outline" size={13} color={colors.accent} /><Text style={styles.historyRewatch}>Rewatch {item.rewatchNumber}</Text></View> : null}
        <Text style={styles.historyEventTime}>{item.timeLabel}</Text>
        <Pressable onPress={() => onRemove(item.id, item.title)} hitSlop={10} style={styles.historyRemoveButton}>
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const MemoHistoryDay = React.memo(HistoryDay);
const MemoHistoryEventRow = React.memo(HistoryEventRow);

function HistoryCard({ item, onOpen, onMenu }: { item: HistoryItem; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void }) {
  const image = tmdbImage(item.artwork, "w500");
  const badgeDate = item.dateKey && item.dateKey !== "unknown" ? new Date(`${item.dateKey}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : formatShortDate(item.date);
  return <Pressable onPress={() => onOpen(item)} onLongPress={() => item.item && onMenu(item.item)} delayLongPress={280} style={styles.historyCard}><View style={styles.historyArt}>{image ? <RemoteImage uri={image} style={styles.posterImage} resizeMode="cover" /> : null}{item.rating != null ? <Text style={styles.historyRating}>{item.rating.toFixed(1)}/10</Text> : null}{item.rewatchNumber ? <View style={styles.historyCardRewatch}><Ionicons name="refresh-outline" size={12} color={colors.accent} /><Text style={styles.historyCardRewatchText}>Rewatch {item.rewatchNumber}</Text></View> : null}<Text style={styles.historyDate}>{badgeDate}</Text></View><Text style={styles.historyTitle} numberOfLines={1}>{item.title}</Text><Text style={styles.historySub} numberOfLines={1}>{item.subtitle}</Text></Pressable>;
}

function ProfileProgressSection({ data, onLibrary, onStatus, onWatching, onOpen, onMenu }: { data: ProfileData; onLibrary: () => void; onStatus: (status: "completed" | "active" | "dropped") => void; onWatching: () => void; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  return <View style={styles.profileSection}><SectionTitle kicker="Your viewing momentum" title="Progress" action="Open library ->" onAction={onLibrary} /><View style={styles.progressGroups}>{data.progressGroups.map(group => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${group.label.toLowerCase()} titles`} onPress={() => onStatus(group.key)} key={group.key} style={({ pressed }) => [styles.progressGroup, pressed && { opacity: .68 }]}><Text style={styles.progressCount}>{group.count}</Text><Text style={styles.progressLabel}>{group.label}</Text><View style={styles.miniPosters}>{group.posters.map((poster, index) => <Image key={`${poster}-${index}`} source={{ uri: poster }} style={styles.miniPoster} />)}</View></Pressable>)}</View><View style={styles.streakRow}><Ionicons name="flame-outline" size={30} color={colors.accent} /><View><Text style={styles.streakLabel}>Current streak</Text><Text style={styles.streakValue}>{data.currentStreak} {data.currentStreak === 1 ? "day" : "days"}</Text><Text style={styles.streakMeta}>Longest streak - {data.longestStreak} days</Text></View></View>{data.currentlyWatching.length ? <><View style={styles.profileSubhead}><Text style={styles.profileSubheadTitle}>Currently watching</Text><Pressable onPress={onWatching}><Text style={styles.profileSubheadAction}>{"See all ->"}</Text></Pressable></View><CardGrid items={data.currentlyWatching.slice(0, 4)} onOpen={onOpen} onMenu={onMenu} /></> : null}</View>;
}

function ReviewSection({ reviews, onAll, onOpen }: { reviews: ReviewItem[]; onAll?: () => void; onOpen: (item: MediaSummary) => void }) {
  if (!reviews.length) return null;
  return <View style={styles.profileSection}><SectionTitle kicker="Your opinions, collected" title="Your reviews" action={onAll ? "See all reviews ->" : undefined} onAction={onAll} /><View style={styles.reviewList}>{reviews.slice(0, onAll ? 6 : reviews.length).map(review => <ReviewRow key={review.id} review={review} onOpen={onOpen} />)}</View></View>;
}

function FullReviewsPage({ reviews, onBack, onOpen }: { reviews: ReviewItem[]; onBack: () => void; onOpen: (item: MediaSummary) => void }) {
  return (
    <View style={styles.profileSection}>
      <SectionTitle kicker="Every take in one place" title="Your reviews" action="Back to profile ->" onAction={onBack} />
      {reviews.length ? <View style={styles.reviewList}>{reviews.map(review => <ReviewRow key={review.id} review={review} onOpen={onOpen} />)}</View> : <EmptyPanel title="No reviews yet" body="Reviews you write on MovieTracker will appear here." />}
    </View>
  );
}

function ChoiceChips({ values, value, onChange }: { values: Array<[string, string]>; value: string; onChange: (value: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featureChoices}>{values.map(([key, label]) => <Pressable key={key} onPress={() => onChange(key)} style={[styles.featureChoice, value === key && styles.featureChoiceActive]}><Text style={[styles.featureChoiceText, value === key && styles.featureChoiceTextActive]}>{label}</Text></Pressable>)}</ScrollView>;
}

function TonightScreen({ token, onBack, onOpen }: { token?: string; onBack: () => void; onOpen: (item: MediaSummary) => void }) {
  const [filters, setFilters] = useState({ minutes: "120", mood: "comforting", kind: "movie", company: "solo", source: token ? "personal" : "generic", services: "" });
  const [picks, setPicks] = useState<Array<{ item: MediaSummary; reason: string }>>([]); const [busy, setBusy] = useState(false); const [exclude, setExclude] = useState<string[]>([]);
  const choose = async (blocked?: string) => { setBusy(true); const next = blocked ? [...exclude, blocked] : exclude; if (blocked) setExclude(next); try { const data = await fetchTonight({ ...filters, exclude: next.join(",") }, token); setPicks(data.picks ?? []); } finally { setBusy(false); } };
  const row = (label: string, key: keyof typeof filters, values: Array<[string, string]>) => <View style={styles.featureField}><Text style={styles.featureLabel}>{label}</Text><ChoiceChips values={values} value={filters[key]} onChange={value => setFilters(current => ({ ...current, [key]: value }))} /></View>;
  return <View style={styles.profileSection}><SectionTitle kicker="Decision mode" title="What should we watch tonight?" action="Back ->" onAction={onBack} /><Text style={styles.featureIntro}>A few useful questions, then three strong choices. No endless grid.</Text><View style={styles.featureForm}>{row("Available time", "minutes", [["30", "30 min"], ["60", "1 hour"], ["90", "90 min"], ["120", "2+ hours"]])}{row("Mood", "mood", [["comforting", "Comforting"], ["intense", "Intense"], ["funny", "Funny"], ["weird", "Weird"], ["emotional", "Emotional"]])}{row("Format", "kind", [["movie", "Movie"], ["show", "Series"]])}{row("Who is watching?", "company", [["solo", "Solo"], ["date", "Date night"], ["family", "Family"], ["group", "Group"]])}{row("Choose from", "source", token ? [["personal", "For me"], ["generic", "Surprise me"], ["new", "Something new"], ["saved", "Already saved"]] : [["generic", "Surprise me"], ["new", "Something new"]])}{row("Streaming service", "services", [["", "Any"], ["netflix", "Netflix"], ["prime", "Prime"], ["disney", "Disney+"], ["max", "Max"], ["apple", "Apple TV+"]])}<Pressable disabled={busy} onPress={() => choose()} style={styles.featurePrimary}><Ionicons name="sparkles-outline" size={20} color="#fff" /><Text style={styles.featurePrimaryText}>{busy ? "Choosing…" : "Give me three choices"}</Text></Pressable></View>{picks.map(({ item, reason }) => <View style={styles.tonightMobileCard} key={`${item.kind}-${item.id}`}><Pressable onPress={() => onOpen(item)}><RemoteImage uri={tmdbImage(item.backdropPath || item.posterPath, "w780")} style={styles.tonightMobileArt} resizeMode="cover" /></Pressable><Text style={styles.kickerText}>{item.kind === "movie" ? "Film" : "Series"}</Text><Text style={styles.tonightMobileTitle}>{item.title}</Text><Text style={styles.featureIntro}>{reason}</Text><View style={styles.featureChoices}>{[["Wrong mood", "close-circle-outline"], ["Seen it", "checkmark-circle-outline"], ["Too long", "time-outline"]].map(([label, icon]) => <Pressable key={label} onPress={() => choose(`${item.kind}-${item.id}`)} style={styles.featureChoice}><Ionicons name={icon as any} size={15} color={colors.muted} /><Text style={styles.featureChoiceText}>{label}</Text></Pressable>)}</View></View>)}</View>;
}

function UpNextScreen({ token, onBack, onOpen }: { token: string; onBack: () => void; onOpen: (item: MediaSummary) => void }) {
  const [minutes, setMinutes] = useState("120"); const [data, setData] = useState<any>(null); const [busy, setBusy] = useState(true);
  useEffect(() => { let live = true; setBusy(true); fetchUpNext(token, Number(minutes)).then(value => live && setData(value)).finally(() => live && setBusy(false)); return () => { live = false; }; }, [minutes, token]);
  const shelf = (title: string, items: any[]) => items?.length ? <View style={styles.featureShelf}><Text style={styles.statsSectionTitle}>{title}</Text>{items.map((entry: any) => <Pressable key={`${title}-${entry.item.kind}-${entry.item.id}`} onPress={() => onOpen(entry.item)} style={styles.upNextMobileRow}><RemoteImage uri={tmdbImage(entry.item.backdropPath || entry.item.posterPath, "w500")} style={styles.upNextMobileArt} resizeMode="cover" /><View style={{ flex: 1 }}><Text style={styles.kickerText}>{entry.label}</Text><Text style={styles.upNextMobileTitle}>{entry.item.title}</Text><Text style={styles.featureLinkBody}>{entry.episodeTitle || entry.reason}</Text><Text style={styles.upNextMobileMeta}>{entry.runtime ?? "?"} min · {entry.reason}</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable>)}</View> : null;
  return <View style={styles.profileSection}><SectionTitle kicker="Your unfinished viewing" title="Up Next" action="Back ->" onAction={onBack} /><Text style={styles.featureIntro}>What is ready, nearly finished, newly released, or waiting for you.</Text><View style={styles.eveningMobile}><Text style={styles.kickerText}>Clear an evening</Text><Text style={styles.statsSectionTitle}>Build a queue</Text><ChoiceChips values={[["60", "60 min"], ["90", "90 min"], ["120", "2 hours"], ["180", "3 hours"]]} value={minutes} onChange={setMinutes} />{data?.evening ? <><Text style={styles.eveningTotal}>{data.evening.minutes} of {minutes} min planned</Text>{data.evening.items.map((entry: any) => <Pressable key={`${entry.item.kind}-${entry.item.id}`} onPress={() => onOpen(entry.item)} style={styles.eveningQueueRow}><Text style={styles.upNextMobileTitle}>{entry.item.title}</Text><Text style={styles.featureLinkBody}>{entry.label} · {entry.runtime ?? 45} min</Text></Pressable>)}</> : null}</View>{busy ? <ActivityIndicator color={colors.accent} /> : null}{shelf("Watch next", data?.entries)}{shelf("New this week", data?.newThisWeek)}{shelf("Close to completion", data?.closeToCompletion)}{shelf("Pick it back up", data?.dormant)}</View>;
}

function WrappedScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  useEffect(() => { fetchWrapped(token).then(setData).catch(() => setData({ error: true })); }, [token]);
  if (!data) return <View style={styles.profileSection}><SectionTitle kicker="Your year" title="Wrapped" action="Back ->" onAction={onBack} /><ActivityIndicator color={colors.accent} /></View>;
  const cards = [[data.yearHours, "hours watched"], [data.movieEvents, "movie watches"], [data.seriesEvents, "episode watches"], [data.longestStreak, "day longest streak"], [`${data.completionRate}%`, "series completion"], [data.productiveDay || "—", "top viewing day"]];
  return <View style={styles.profileSection}><SectionTitle kicker="January 1 through today" title={`Your ${data.year}, so far.`} action="Back ->" onAction={onBack} /><Text style={styles.wrappedMobileLine}>{data.shareLine}</Text><Pressable style={styles.featurePrimary} onPress={() => Share.share({ title: "My MovieTracker Wrapped", message: data.shareLine })}><Ionicons name="share-social-outline" size={20} color="#fff" /><Text style={styles.featurePrimaryText}>Share my year</Text></Pressable><View style={styles.statisticsGrid}>{cards.map(([value, label]) => <View style={styles.statisticsCard} key={String(label)}><Text style={styles.statisticsValue}>{value}</Text><Text style={styles.statisticsLabel}>{label}</Text></View>)}</View><View style={styles.statsSectionHead}><Text style={styles.kickerText}>Your viewing fingerprint</Text><Text style={styles.statsSectionTitle}>Taste, by the numbers</Text></View>{(data.genres ?? []).map(([name, count]: [string, number]) => <View key={name} style={styles.wrappedMobileBar}><Text style={styles.genreStatName}>{name}</Text><View style={styles.genreStatBar}><View style={[styles.genreStatFill, { width: `${count / (data.genres[0]?.[1] || 1) * 100}%`, backgroundColor: colors.accent }]} /></View><Text style={styles.genreStatTotal}>{count}</Text></View>)}<View style={styles.featureForm}>{[["Highest-rated director", data.topDirector], ["Most-watched actor", data.mostWatchedActor], ["Most generous rating", data.generous ? `${data.generous.title} · ${data.generous.score}/10` : null], ["Harshest rating", data.harshest ? `${data.harshest.title} · ${data.harshest.score}/10` : null]].map(([label, value]) => <View key={label} style={styles.wrappedMobileCallout}><Text style={styles.featureLinkBody}>{label}</Text><Text style={styles.featureLinkTitle}>{value || "More watches needed"}</Text></View>)}</View></View>;
}

function StatisticsPage({ data, onBack, onWrapped, onOpen, onGenreShelf }: { data: ProfileData; onBack: () => void; onWrapped: () => void; onOpen: (item: MediaSummary) => void; onGenreShelf: (offset: number) => void }) {
  const [selectedGenre, setSelectedGenre] = useState("");
  const [shelfOffset, setShelfOffset] = useState(0);
  const pendingShelfScroll = useRef(false);
  const completed = data.progressGroups.find(group => group.key === "completed")?.count ?? 0;
  const cards = [
    { value: data.watchEvents, label: "watch events" },
    { value: `${data.screenTimeHours}h`, label: "screen time" },
    { value: completed, label: "completed titles" },
    { value: data.averageRating, label: "average rating" }
  ];
  const maxGenreCount = data.genreStats[0]?.total ?? 1;
  const selected = data.genreStats.find(genre => genre.name === selectedGenre);

  useEffect(() => {
    if (!selectedGenre || !pendingShelfScroll.current || !shelfOffset) return;
    pendingShelfScroll.current = false;
    onGenreShelf(Math.max(0, shelfOffset + 72));
  }, [onGenreShelf, selectedGenre, shelfOffset]);

  return (
    <View style={styles.profileSection}>
      <SectionTitle kicker="The numbers behind your taste" title="Statistics" action="Back to profile ->" onAction={onBack} />
      <Pressable onPress={onWrapped} style={styles.featureLink}><Ionicons name="sparkles-outline" size={20} color={colors.accent} /><View><Text style={styles.featureLinkTitle}>Your wrapped, so far</Text><Text style={styles.featureLinkBody}>A shareable look at this year’s viewing.</Text></View><Ionicons name="chevron-forward" size={20} color={colors.muted} /></Pressable>
      <View style={styles.statisticsGrid}>
        {cards.map(card => (
          <View key={card.label} style={styles.statisticsCard}>
            <Text style={styles.statisticsValue}>{card.value}</Text>
            <Text style={styles.statisticsLabel}>{card.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.statsSectionHead}><Text style={styles.kickerText}>Your recurring moods</Text><Text style={styles.statsSectionTitle}>Top genres</Text></View>
      {data.genreStats.length ? (
        <View style={styles.genreStatsPanel}>
          <View style={styles.genreLegend}>{trackedStatusOrder.map(status => <View key={status} style={styles.genreLegendItem}><View style={[styles.genreLegendDot, { backgroundColor: genreStatusColor(status) }]} /><Text style={styles.genreLegendText}>{status}</Text></View>)}</View>
          {data.genreStats.map(genre => <GenreStatRow key={genre.name} genre={genre} max={maxGenreCount} selected={selectedGenre === genre.name} onPress={() => {
            setSelectedGenre(current => current === genre.name ? "" : genre.name);
            if (selectedGenre !== genre.name) {
              pendingShelfScroll.current = true;
              if (shelfOffset) onGenreShelf(Math.max(0, shelfOffset + 72));
            }
          }} />)}
        </View>
      ) : <EmptyPanel title="A blank slate" body="Track a title and your genre profile will grow here." />}
      {selected ? (
        <View style={styles.genreShelf} onLayout={event => setShelfOffset(event.nativeEvent.layout.y)}>
          <SectionTitle kicker="Genre shelf" title={selected.name} action="Clear genre ->" onAction={() => setSelectedGenre("")} />
          <CardGrid items={selected.items.map(entry => entry.item)} onOpen={onOpen} onMenu={() => undefined} />
        </View>
      ) : null}
    </View>
  );
}

function GenreStatRow({ genre, max, selected, onPress }: { genre: GenreStat; max: number; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.genreStatRow, selected && styles.genreStatRowActive]}>
      <Text style={styles.genreStatName}>{genre.name}</Text>
      <View style={styles.genreStatBar}>
        <View style={[styles.genreStatFill, { width: `${Math.max(8, genre.total / max * 100)}%` }]}>
          {trackedStatusOrder.map(status => genre.statuses[status] ? <View key={status} style={{ flex: genre.statuses[status], backgroundColor: genreStatusColor(status) }} /> : null)}
        </View>
      </View>
      <Text style={styles.genreStatTotal}>{genre.total}</Text>
    </Pressable>
  );
}

function genreStatusColor(status: TrackedStatus) {
  if (status === "completed") return "#35cf86";
  if (status === "watching") return colors.accent;
  if (status === "planned") return "#6c8cff";
  if (status === "paused") return "#f1bf4a";
  return "#9b78b8";
}

function ratingCellStyle(score: number | null, colorized: boolean) {
  if (score == null) return { backgroundColor: "#aeb0b2", color: "#151515" };
  if (!colorized) return { backgroundColor: "#f5c20b", color: "#151515" };
  if (score >= 9.5) return { backgroundColor: "#28a8f4", color: "#06131b" };
  if (score >= 8) return { backgroundColor: "#24bf74", color: "#06170e" };
  if (score >= 7) return { backgroundColor: "#f2cf3c", color: "#17130a" };
  if (score >= 6) return { backgroundColor: "#f39b19", color: "#17130a" };
  if (score >= 5) return { backgroundColor: "#e8584f", color: "#ffffff" };
  return { backgroundColor: "#8151a8", color: "#ffffff" };
}

function RatingLegend() {
  const buckets = [
    ["Absolute", "#28a8f4"],
    ["Great", "#24bf74"],
    ["Good", "#f2cf3c"],
    ["Regular", "#f39b19"],
    ["Bad", "#e8584f"],
    ["Garbage", "#8151a8"]
  ];
  return <View style={styles.ratingLegend}>{buckets.map(([label, color]) => <View key={label} style={styles.ratingLegendItem}><View style={[styles.ratingLegendDot, { backgroundColor: color }]} /><Text style={styles.ratingLegendText}>{label}</Text></View>)}</View>;
}

async function sharePublicTitle(path: string, title: string, text?: string | null) {
  const url = `${API_URL}${path}`;
  const message = text ? `${title}\n${text}\n${url}` : `${title}\n${url}`;
  try {
    await Share.share({ title, message, url });
  } catch {
    // Native share sheets reject when the user cancels.
  }
}

function SeasonDetailScreen({ target, session, onBack, onOpenEpisode }: { target: SeasonTarget; session: Session | null; onBack: () => void; onOpenEpisode: (episode: any) => void }) {
  const [payload, setPayload] = useState<any | null>(null);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [source, setSource] = useState<"movietracker" | "tmdb" | "imdb">("tmdb");
  const [colorized, setColorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ratingSheetVisible, setRatingSheetVisible] = useState(false);
  const [quickWatchEpisode, setQuickWatchEpisode] = useState<any | null>(null);
  const heldEpisode = useRef<number | null>(null);
  const season = payload?.season ?? target.season;
  const episodes = [...(payload?.episodes ?? [])].sort((a, b) => Number(a.episode_number ?? a.episodeNumber ?? 0) - Number(b.episode_number ?? b.episodeNumber ?? 0));
  const imdbRatings = new Map<number, number | null>((payload?.imdbRatings ?? []).map((rating: any) => [Number(rating.episode), typeof rating.imdbRating === "number" ? rating.imdbRating : null]));
  const movieTrackerRatings = new Map<number, number | null>((payload?.episodeRatings ?? []).map((rating: any) => [Number(rating.episode), typeof rating.score === "number" ? rating.score : null]));
  const imdbAvailable = [...imdbRatings.values()].some(value => typeof value === "number");
  const movieTrackerAvailable = [...movieTrackerRatings.values()].some(value => typeof value === "number");
  const seasonRatingSources = [
    { label: "MovieTracker", value: payload?.communityRating != null ? `${Number(payload.communityRating).toFixed(1)}/10` : "—/10" },
    ...(payload?.tmdbRating != null ? [{ label: "TMDB", value: `${Number(payload.tmdbRating).toFixed(1)}/10` }] : []),
    ...(payload?.imdbRating != null ? [{ label: "IMDb", value: `${Number(payload.imdbRating).toFixed(1)}/10` }] : [])
  ];
  const poster = tmdbImage(season.poster_path ?? season.posterPath ?? target.season.posterPath ?? target.show.posterPath, "w500");
  const backdrop = tmdbImage(target.show.backdropPath || target.show.posterPath, "w780");

  useEffect(() => {
    let alive = true;
    setLoadingSeason(true);
    fetchMobileSeason(target.show.id, target.season.seasonNumber, session?.access_token)
      .then(data => { if (alive) setPayload(data); })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoadingSeason(false); });
    return () => { alive = false; };
  }, [session?.access_token, target.season.seasonNumber, target.show.id]);

  function episodeScore(episode: any): number | null {
    const episodeNumber = Number(episode.episode_number ?? episode.episodeNumber ?? 0);
    if (source === "movietracker") return movieTrackerRatings.get(episodeNumber) ?? null;
    if (source === "imdb") return imdbRatings.get(episodeNumber) ?? null;
    const tmdbScore = Number(episode.vote_average ?? episode.voteAverage);
    return Number.isFinite(tmdbScore) && tmdbScore > 0 ? tmdbScore : null;
  }

  async function refreshSeasonFeedback() {
    const data = await fetchMobileSeason(target.show.id, target.season.seasonNumber, session?.access_token);
    setPayload(data);
  }

  async function saveSeasonRating(score: number | null) {
    if (!session?.user.id || !payload?.seasonId || !supabase) return Alert.alert("Sign in needed", "Sign in before rating seasons.");
    setBusy(true);
    try {
      if (score == null) {
        await supabase.from("ratings").delete().eq("user_id", session.user.id).eq("season_id", payload.seasonId);
        setPayload((current: any) => current ? { ...current, userRating: null } : current);
        return;
      }
      const nextScore = clampRating(score);
      const { data: existing } = await supabase.from("ratings").select("id").eq("user_id", session.user.id).eq("season_id", payload.seasonId).maybeSingle();
      const result = existing
        ? await supabase.from("ratings").update({ score: nextScore, updated_at: new Date().toISOString() }).eq("id", existing.id)
        : await supabase.from("ratings").insert({ user_id: session.user.id, season_id: payload.seasonId, score: nextScore });
      if (result.error) throw result.error;
      setPayload((current: any) => current ? { ...current, userRating: nextScore } : current);
    } finally {
      setBusy(false);
      setRatingSheetVisible(false);
    }
  }

  async function saveSeasonReview(values: { score: number | null; title: string; body: string; containsSpoilers: boolean }) {
    if (!session?.user.id || !payload?.seasonId || !supabase) return Alert.alert("Sign in needed", "Sign in before reviewing seasons.");
    setBusy(true);
    try {
      let ratingId: string | null = payload.myReview?.ratingId ?? null;
      if (values.score != null) {
        const nextScore = clampRating(values.score);
        const { data: existing } = await supabase.from("ratings").select("id").eq("user_id", session.user.id).eq("season_id", payload.seasonId).maybeSingle();
        const { data, error } = existing
          ? await supabase.from("ratings").update({ score: nextScore, updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
          : await supabase.from("ratings").insert({ user_id: session.user.id, season_id: payload.seasonId, score: nextScore }).select("id").single();
        if (error) throw error;
        ratingId = data?.id ?? ratingId;
      }
      const body = values.body.trim();
      const title = values.title.trim();
      const reviewPayload = { user_id: session.user.id, season_id: payload.seasonId, rating_id: ratingId, title: title || null, body: body || null, contains_spoilers: values.containsSpoilers };
      const { data: existingReview } = await supabase.from("reviews").select("id").eq("user_id", session.user.id).eq("season_id", payload.seasonId).maybeSingle();
      const { error } = existingReview
        ? await supabase.from("reviews").update({ ...reviewPayload, updated_at: new Date().toISOString() }).eq("id", existingReview.id)
        : await supabase.from("reviews").insert(reviewPayload);
      if (error) throw error;
      await refreshSeasonFeedback();
    } finally {
      setBusy(false);
    }
  }

  function episodeNumberOf(episode: any) { return Number(episode.episode_number ?? episode.episodeNumber ?? 0); }
  function openEpisodePress(episode: any) {
    const episodeNumber = episodeNumberOf(episode);
    if (heldEpisode.current === episodeNumber) { heldEpisode.current = null; return; }
    onOpenEpisode(episode);
  }
  function openQuickEpisodeWatch(episode: any) {
    heldEpisode.current = episodeNumberOf(episode);
    if (!session?.user.id) return Alert.alert("Sign in needed", "Sign in before tracking episodes.");
    if (!payload?.mediaId || !episode.db_episode_id) return Alert.alert("Unavailable", "This episode is not ready for tracking yet.");
    setQuickWatchEpisode(episode);
  }
  async function saveQuickEpisodeWatch(values: WatchLogValues) {
    if (!session?.user.id || !payload?.mediaId || !quickWatchEpisode?.db_episode_id || !supabase) return;
    const watchedAt = resolveWatchLogDate(values, quickWatchEpisode.air_date, quickWatchEpisode.runtime ?? 0);
    setBusy(true);
    try {
      const { error } = await supabase.from("watch_events").insert({ user_id: session.user.id, media_id: payload.mediaId, episode_id: quickWatchEpisode.db_episode_id, duration_minutes: quickWatchEpisode.runtime ?? null, watched_at: watchedAt });
      if (error) throw error;
      await supabase.from("progress").upsert({ user_id: session.user.id, media_id: payload.mediaId, status: "watching", updated_at: new Date().toISOString() });
      const watchedNumber = episodeNumberOf(quickWatchEpisode);
      setPayload((current: any) => current ? { ...current, episodes: current.episodes.map((episode: any) => episodeNumberOf(episode) === watchedNumber ? { ...episode, watched: true } : episode) } : current);
      setQuickWatchEpisode(null);
    } finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.episodeHero}>
        {backdrop ? <RemoteImage uri={backdrop} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.detailShadeV2} />
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}><Ionicons name="chevron-back" size={22} color={colors.text} /><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.detailHeroCopyV2}>
          {poster ? <RemoteImage uri={poster} style={styles.detailPosterV2} resizeMode="cover" /> : null}
          <Text style={styles.detailKicker}>{target.show.title}</Text>
          <Text style={styles.detailTitleV2}>{season.name ?? target.season.name}</Text>
          <Text style={styles.detailMeta}>{episodes.length || target.season.episodeCount || "?"} episodes - {season.air_date?.slice(0, 4) ?? season.airDate?.slice(0, 4) ?? target.season.airDate?.slice(0, 4) ?? "TBA"}</Text>
          {payload ? <View style={styles.ratingSourceRow}>{seasonRatingSources.map(rating => <RatingSource key={rating.label} label={rating.label} value={rating.value} />)}</View> : null}
          <Text style={styles.detailOverview}>{season.overview || target.season.overview || "No season overview has been published yet."}</Text>
          <View style={styles.detailQuickActions}>
            <Pressable onPress={() => sharePublicTitle(`/title/show/${target.show.id}/season/${target.season.seasonNumber}`, `${target.show.title} - ${season.name ?? target.season.name}`, season.overview || target.season.overview || target.show.overview)} style={styles.quickAction}><Ionicons name="share-social-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Share</Text></Pressable>
          </View>
        </View>
      </View>
      <View style={styles.detailBody}>
        <SectionTitle kicker="Season ratings" title="Episodes" />
        <Pressable disabled={busy || !payload?.seasonId} onPress={() => setRatingSheetVisible(true)} style={styles.ratingAction}>
          <Ionicons name="speedometer-outline" size={24} color="#ffc24b" />
          <View style={styles.ratingActionCopy}>
            <Text style={styles.ratingActionLabel}>Your season rating</Text>
            <Text style={styles.ratingActionValue}>{payload?.userRating != null ? `${payload.userRating.toFixed(1)}/10` : "Rate this season"}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        </Pressable>
        <RatingSheet visible={ratingSheetVisible} value={payload?.userRating ?? null} busy={busy} onClose={() => setRatingSheetVisible(false)} onSave={saveSeasonRating} />
        <WatchLogSheet visible={Boolean(quickWatchEpisode)} title={`${target.show.title} - ${quickWatchEpisode?.name ?? "Episode"}`} releaseDate={quickWatchEpisode?.air_date ?? null} runtime={quickWatchEpisode?.runtime ?? null} busy={busy} watched={Boolean(quickWatchEpisode?.watched)} onClose={() => setQuickWatchEpisode(null)} onSave={saveQuickEpisodeWatch} />
        {session?.user.id && payload?.seasonId ? <ReviewComposerPanel existingReview={payload.myReview} currentRating={payload.userRating} busy={busy} onSubmit={saveSeasonReview} /> : null}
        <View style={styles.sourceTabs}>
          <Pressable disabled={!movieTrackerAvailable} onPress={() => setSource("movietracker")} style={[styles.sourceTab, source === "movietracker" && styles.sourceTabActive, !movieTrackerAvailable && styles.sourceTabDisabled]}><Text style={styles.sourceTabText}>MovieTracker</Text></Pressable>
          <Pressable onPress={() => setSource("tmdb")} style={[styles.sourceTab, source === "tmdb" && styles.sourceTabActive]}><Text style={styles.sourceTabText}>TMDB</Text></Pressable>
          <Pressable disabled={!imdbAvailable} onPress={() => setSource("imdb")} style={[styles.sourceTab, source === "imdb" && styles.sourceTabActive, !imdbAvailable && styles.sourceTabDisabled]}><Text style={styles.sourceTabText}>IMDb</Text></Pressable>
          <View style={[styles.sourceTab, styles.sourceTabDisabled]}><Text style={styles.sourceTabText}>Rotten Tomatoes</Text></View>
        </View>
        <View style={styles.ratingGraphControls}>
          <Pressable onPress={() => setColorized(value => !value)} style={[styles.ratingGraphToggle, colorized && styles.ratingGraphToggleActive]}><Text style={styles.ratingGraphToggleText}>Colored scores</Text><Switch value={colorized} onValueChange={setColorized} trackColor={{ false: "#343a3d", true: colors.accent }} thumbColor={colors.text} /></Pressable>
        </View>
        {colorized ? <RatingLegend /> : null}
        {loadingSeason ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 18 }} /> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasonEpisodeGrid}>
          {episodes.map(episode => {
            const score = episodeScore(episode);
            const episodeNumber = Number(episode.episode_number ?? episode.episodeNumber ?? 0);
            const cellColors = ratingCellStyle(score, colorized);
            return (
              <Pressable key={`${episode.id ?? episodeNumber}`} onPress={() => openEpisodePress(episode)} onLongPress={() => openQuickEpisodeWatch(episode)} delayLongPress={300} style={[styles.seasonEpisodeCell, { backgroundColor: cellColors.backgroundColor }]}>
                <Text style={[styles.seasonEpisodeCode, { color: cellColors.color }]}>E{episodeNumber}</Text>
                <Text style={[styles.seasonEpisodeScore, { color: cellColors.color }]}>{score != null ? score.toFixed(1) : "-"}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.seasonList}>
          {episodes.map(episode => {
            const still = tmdbImage(episode.still_path ?? episode.stillPath, "w342");
            const episodeNumber = Number(episode.episode_number ?? episode.episodeNumber ?? 0);
            return (
              <Pressable key={`row-${episode.id ?? episodeNumber}`} onPress={() => openEpisodePress(episode)} onLongPress={() => openQuickEpisodeWatch(episode)} delayLongPress={300} style={styles.seasonCard}>
                {still ? <RemoteImage uri={still} style={styles.seasonPoster} resizeMode="cover" /> : <View style={styles.seasonPoster}><Ionicons name="film-outline" size={20} color={colors.muted} /></View>}
                <View style={styles.seasonCopy}>
                  <Text style={styles.seasonName} numberOfLines={1}>E{episodeNumber} - {episode.name ?? "Episode"}</Text>
                  <Text style={styles.seasonMeta}>{episode.air_date ?? "Air date TBA"}{episode.runtime ? ` - ${episode.runtime} min` : ""}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

function SeriesEpisodesScreen({ target, session, onBack, onOpenSeason, onOpenEpisode }: { target: SeriesEpisodesTarget; session: Session | null; onBack: () => void; onOpenSeason: (season: DetailSeason) => void; onOpenEpisode: (season: DetailSeason, episode: any) => void }) {
  const [payloads, setPayloads] = useState<any[]>([]);
  const [loadingAll, setLoadingAll] = useState(false);
  const [source, setSource] = useState<"movietracker" | "tmdb" | "imdb">("tmdb");
  const [colorized, setColorized] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [dimUnwatched, setDimUnwatched] = useState(false);
  const [quickWatch, setQuickWatch] = useState<{ season: DetailSeason; payload: any; episode: any } | null>(null);
  const [quickWatchBusy, setQuickWatchBusy] = useState(false);
  const heldEpisode = useRef<string | null>(null);
  const seasons = useMemo(() => [...target.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber), [target.seasons]);
  const payloadBySeason = useMemo(() => new Map(payloads.map(payload => [Number(payload?.season?.season_number ?? payload?.season?.seasonNumber ?? payload?.seasonNumber ?? 0), payload])), [payloads]);
  const hasImdb = payloads.some(payload => (payload?.imdbRatings ?? []).some((rating: any) => typeof rating.imdbRating === "number"));
  const hasMovieTracker = payloads.some(payload => (payload?.episodeRatings ?? []).some((rating: any) => typeof rating.score === "number"));
  const seasonRows = useMemo(() => seasons.map(season => {
    const payload = payloadBySeason.get(season.seasonNumber);
    const episodes = [...(payload?.episodes ?? [])].sort((a, b) => Number(a.episode_number ?? a.episodeNumber ?? 0) - Number(b.episode_number ?? b.episodeNumber ?? 0));
    return { season, payload, episodes };
  }), [payloadBySeason, seasons]);
  const maxEpisodes = Math.max(0, ...seasonRows.map(row => row.episodes.length));
  const watchProgress = useMemo(() => {
    const watchedKeys = new Set<string>();
    let total = 0;
    seasonRows.forEach(({ season, episodes }) => episodes.forEach(episode => {
      const episodeNumber = Number(episode.episode_number ?? episode.episodeNumber ?? 0);
      if (!episodeNumber) return;
      total += 1;
      if (episode.watched) watchedKeys.add(`${season.seasonNumber}-${episodeNumber}`);
    }));
    return { total, watched: watchedKeys.size, watchedKeys };
  }, [seasonRows]);

  useEffect(() => {
    let alive = true;
    setLoadingAll(true);
    const load = async () => {
      const data = new Array(seasons.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < seasons.length && alive) {
          const index = cursor++;
          const season = seasons[index];
          data[index] = await fetchMobileSeason(target.show.id, season.seasonNumber, session?.access_token).catch(() => ({ season, episodes: [], imdbRatings: [] }));
          if (alive) setPayloads(data.filter(Boolean));
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, seasons.length) }, worker));
      if (alive) setLoadingAll(false);
    };
    void load();
    return () => { alive = false; };
  }, [seasons, session?.access_token, target.show.id]);

  function episodeScore(payload: any, episode: any): number | null {
    const episodeNumber = Number(episode.episode_number ?? episode.episodeNumber ?? 0);
    if (source === "movietracker") {
      const rating = (payload?.episodeRatings ?? []).find((item: any) => Number(item.episode) === episodeNumber);
      return typeof rating?.score === "number" ? rating.score : null;
    }
    if (source === "imdb") {
      const rating = (payload?.imdbRatings ?? []).find((item: any) => Number(item.episode) === episodeNumber);
      return typeof rating?.imdbRating === "number" ? rating.imdbRating : null;
    }
    const tmdbScore = Number(episode.vote_average ?? episode.voteAverage);
    return Number.isFinite(tmdbScore) && tmdbScore > 0 ? tmdbScore : null;
  }

  function isEpisodeWatched(seasonNumber: number, episode: any) {
    const episodeNumber = Number(episode.episode_number ?? episode.episodeNumber ?? 0);
    return Boolean(episode.watched) || watchProgress.watchedKeys.has(`${seasonNumber}-${episodeNumber}`);
  }

  function episodeKey(season: DetailSeason, episode: any) { return `${season.seasonNumber}-${Number(episode.episode_number ?? episode.episodeNumber ?? 0)}`; }
  function openEpisodePress(season: DetailSeason, episode: any) {
    const key = episodeKey(season, episode);
    if (heldEpisode.current === key) { heldEpisode.current = null; return; }
    onOpenEpisode(season, episode);
  }
  function openQuickEpisodeWatch(season: DetailSeason, payload: any, episode: any) {
    heldEpisode.current = episodeKey(season, episode);
    if (!session?.user.id) return Alert.alert("Sign in needed", "Sign in before tracking episodes.");
    if (!payload?.mediaId || !episode.db_episode_id) return Alert.alert("Unavailable", "This episode is not ready for tracking yet.");
    setQuickWatch({ season, payload, episode });
  }
  async function saveQuickEpisodeWatch(values: WatchLogValues) {
    if (!session?.user.id || !quickWatch?.payload?.mediaId || !quickWatch.episode?.db_episode_id || !supabase) return;
    setQuickWatchBusy(true);
    try {
    const watchedAt = resolveWatchLogDate(values, quickWatch.episode.air_date, quickWatch.episode.runtime ?? 0);
    const seasonNumber = quickWatch.season.seasonNumber;
    const episodeNumber = Number(quickWatch.episode.episode_number ?? quickWatch.episode.episodeNumber ?? 0);
    const { error } = await supabase.from("watch_events").insert({ user_id: session.user.id, media_id: quickWatch.payload.mediaId, episode_id: quickWatch.episode.db_episode_id, duration_minutes: quickWatch.episode.runtime ?? null, watched_at: watchedAt });
    if (error) throw error;
    await supabase.from("progress").upsert({ user_id: session.user.id, media_id: quickWatch.payload.mediaId, status: "watching", updated_at: new Date().toISOString() });
    setPayloads(current => current.map(payload => Number(payload?.season?.season_number ?? payload?.season?.seasonNumber) === seasonNumber ? { ...payload, episodes: payload.episodes.map((episode: any) => Number(episode.episode_number ?? episode.episodeNumber) === episodeNumber ? { ...episode, watched: true } : episode) } : payload));
    setQuickWatch(null);
    } finally { setQuickWatchBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.entityHeader}>
        <Pressable onPress={onBack} style={styles.backChip}><Ionicons name="chevron-back" size={18} color={colors.text} /><Text style={styles.backChipText}>Back</Text></Pressable>
        <Text style={styles.detailKicker}>{target.show.title}</Text>
        <Text style={styles.entityTitle}>All episodes & ratings</Text>
      </View>
      <View style={styles.sourceTabs}>
        <Pressable disabled={!hasMovieTracker} onPress={() => setSource("movietracker")} style={[styles.sourceTab, source === "movietracker" && styles.sourceTabActive, !hasMovieTracker && styles.sourceTabDisabled]}><Text style={styles.sourceTabText}>MovieTracker</Text></Pressable>
        <Pressable onPress={() => setSource("tmdb")} style={[styles.sourceTab, source === "tmdb" && styles.sourceTabActive]}><Text style={styles.sourceTabText}>TMDB</Text></Pressable>
        <Pressable disabled={!hasImdb} onPress={() => setSource("imdb")} style={[styles.sourceTab, source === "imdb" && styles.sourceTabActive, !hasImdb && styles.sourceTabDisabled]}><Text style={styles.sourceTabText}>IMDb</Text></Pressable>
        <View style={[styles.sourceTab, styles.sourceTabDisabled]}><Text style={styles.sourceTabText}>Rotten Tomatoes</Text></View>
      </View>
      <View style={styles.ratingGraphControls}>
        <Pressable onPress={() => setColorized(value => !value)} style={[styles.ratingGraphToggle, colorized && styles.ratingGraphToggleActive]}><Text style={styles.ratingGraphToggleText}>Colored scores</Text><Switch value={colorized} onValueChange={setColorized} trackColor={{ false: "#343a3d", true: colors.accent }} thumbColor={colors.text} /></Pressable>
        <Pressable onPress={() => setInverted(value => !value)} style={[styles.ratingGraphToggle, inverted && styles.ratingGraphToggleActive]}><Text style={styles.ratingGraphToggleText}>Inverted axes</Text><Switch value={inverted} onValueChange={setInverted} trackColor={{ false: "#343a3d", true: colors.accent }} thumbColor={colors.text} /></Pressable>
      </View>
      <WatchLogSheet visible={Boolean(quickWatch)} title={`${target.show.title} - ${quickWatch?.episode?.name ?? "Episode"}`} releaseDate={quickWatch?.episode?.air_date ?? null} runtime={quickWatch?.episode?.runtime ?? null} busy={quickWatchBusy} watched={Boolean(quickWatch?.episode?.watched)} onClose={() => setQuickWatch(null)} onSave={saveQuickEpisodeWatch} />
      {colorized ? <RatingLegend /> : null}
      {loadingAll ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 18 }} /> : null}
      {seasonRows.length && maxEpisodes ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.fullMatrixScroll}><View style={styles.fullEpisodeMatrix}>
        {!inverted ? <>
          <View style={styles.matrixRow}><Text style={styles.matrixAxisCell}>Season</Text>{Array.from({ length: maxEpisodes }, (_, index) => <Text key={index} style={styles.matrixHeaderCell}>E{index + 1}</Text>)}</View>
          {seasonRows.map(({ season, payload, episodes }) => <View key={`matrix-${season.seasonNumber}`} style={styles.matrixRow}><Text style={styles.matrixAxisCell}>S{season.seasonNumber}</Text>{Array.from({ length: maxEpisodes }, (_, index) => {
            const episode = episodes[index];
            if (!episode) return <View key={index} style={styles.matrixEmptyCell} />;
            const score = episodeScore(payload, episode);
            const cellColors = ratingCellStyle(score, colorized);
            const episodeNumber = Number(episode.episode_number ?? episode.episodeNumber ?? 0);
            const dimmed = dimUnwatched && !isEpisodeWatched(season.seasonNumber, episode);
            return <Pressable key={`${season.seasonNumber}-${episode.id ?? index}`} onPress={() => openEpisodePress(season, episode)} onLongPress={() => openQuickEpisodeWatch(season, payload, episode)} delayLongPress={300} style={[styles.matrixCell, { backgroundColor: cellColors.backgroundColor }, dimmed && styles.dimmedEpisode]}><Text style={[styles.matrixCellText, { color: cellColors.color }]}>{score != null ? score.toFixed(1) : "-"}</Text></Pressable>;
          })}</View>)}
        </> : <>
          <View style={styles.matrixRow}><Text style={styles.matrixAxisCell}>Episode</Text>{seasonRows.map(({ season }) => <Text key={season.seasonNumber} style={styles.matrixHeaderCell}>S{season.seasonNumber}</Text>)}</View>
          {Array.from({ length: maxEpisodes }, (_, index) => <View key={`episode-row-${index}`} style={styles.matrixRow}><Text style={styles.matrixAxisCell}>E{index + 1}</Text>{seasonRows.map(({ season, payload, episodes }) => {
            const episode = episodes[index];
            if (!episode) return <View key={season.seasonNumber} style={styles.matrixEmptyCell} />;
            const score = episodeScore(payload, episode);
            const cellColors = ratingCellStyle(score, colorized);
            const dimmed = dimUnwatched && !isEpisodeWatched(season.seasonNumber, episode);
            return <Pressable key={`${season.seasonNumber}-${episode.id ?? index}`} onPress={() => openEpisodePress(season, episode)} onLongPress={() => openQuickEpisodeWatch(season, payload, episode)} delayLongPress={300} style={[styles.matrixCell, { backgroundColor: cellColors.backgroundColor }, dimmed && styles.dimmedEpisode]}><Text style={[styles.matrixCellText, { color: cellColors.color }]}>{score != null ? score.toFixed(1) : "-"}</Text></Pressable>;
          })}</View>)}
        </>}
      </View></ScrollView> : null}
      <View style={styles.detailSection}>
        <SectionTitle kicker="Progress and episode guide" title="Seasons & episodes" />
        {session?.user.id && watchProgress.total ? (
          <View style={styles.watchProgressCard}>
            <View style={styles.watchProgressHeader}>
              <View>
                <Text style={styles.watchProgressLabel}>Watch progress</Text>
                <Text style={styles.watchProgressValue}>{watchProgress.watched} / {watchProgress.total} episodes</Text>
              </View>
              <Pressable onPress={() => setDimUnwatched(value => !value)} style={[styles.watchProgressToggle, dimUnwatched && styles.watchProgressToggleActive]}>
                <Ionicons name={dimUnwatched ? "eye-off-outline" : "eye-outline"} size={18} color={dimUnwatched ? colors.text : colors.muted} />
                <Text style={[styles.watchProgressToggleText, dimUnwatched && styles.watchProgressToggleTextActive]}>Dim unwatched</Text>
              </Pressable>
            </View>
            <View style={styles.watchProgressTrack}><View style={[styles.watchProgressFill, { width: `${Math.round((watchProgress.watched / watchProgress.total) * 100)}%` }]} /></View>
          </View>
        ) : null}
      </View>
      {seasonRows.map(({ season, payload, episodes }) => {
        return (
          <View key={`${season.id ?? season.seasonNumber}`} style={styles.detailSection}>
            <SectionTitle kicker={`Season ${season.seasonNumber}`} title={isLimitedSeries(target.show, seasons) ? "Limited Series" : season.name || `Season ${season.seasonNumber}`} action={isLimitedSeries(target.show, seasons) ? undefined : "Open season ->"} onAction={isLimitedSeries(target.show, seasons) ? undefined : () => onOpenSeason(season)} />
            <View style={styles.seasonList}>
              {episodes.map(episode => {
                const still = tmdbImage(episode.still_path ?? episode.stillPath, "w342");
                const episodeNumber = Number(episode.episode_number ?? episode.episodeNumber ?? 0);
                const dimmed = dimUnwatched && !isEpisodeWatched(season.seasonNumber, episode);
                return (
                  <Pressable key={`row-${season.seasonNumber}-${episode.id ?? episodeNumber}`} onPress={() => openEpisodePress(season, episode)} onLongPress={() => openQuickEpisodeWatch(season, payload, episode)} delayLongPress={300} style={[styles.seasonCard, dimmed && styles.dimmedEpisodeCard]}>
                    {still ? <RemoteImage uri={still} style={styles.seasonPoster} resizeMode="cover" /> : <View style={styles.seasonPoster}><Ionicons name="film-outline" size={20} color={colors.muted} /></View>}
                    <View style={styles.seasonCopy}>
                      <Text style={styles.seasonName} numberOfLines={1}>E{episodeNumber} - {episode.name ?? "Episode"}</Text>
                      <Text style={styles.seasonMeta}>{episode.air_date ?? "Air date TBA"}{episode.runtime ? ` - ${episode.runtime} min` : ""}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                  </Pressable>
                );
              })}
              {!episodes.length && !loadingAll ? <Text style={styles.mutedBody}>No episodes loaded for this season.</Text> : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function ReviewRow({ review, onOpen }: { review: ReviewItem; onOpen: (item: MediaSummary) => void }) {
  const image = tmdbImage(review.artwork, "w342");
  const score = typeof review.score === "number" ? review.score : null;
  return (
    <Pressable disabled={!review.item} onPress={() => review.item && onOpen(review.item)} style={styles.reviewRow}>
      {image ? <RemoteImage uri={image} style={styles.reviewImage} resizeMode="cover" /> : <View style={styles.reviewImage} />}
      <View style={styles.reviewCopy}>
        <View style={styles.reviewKindRow}>
          <Text style={styles.reviewKind}>{review.kind === "show" ? "Series review" : "Film review"}</Text>
          {score != null ? <View style={styles.reviewScore}><Ionicons name="star" size={14} color="#ffc24b" /><Text style={styles.reviewScoreText}>{score.toFixed(1)}</Text></View> : null}
        </View>
        <Text style={styles.reviewMedia} numberOfLines={1}>{review.mediaTitle}</Text>
        <Text style={styles.reviewMeta}>{review.kind === "show" ? "Show" : "Movie"} - {formatShortDate(review.created_at)}{isEditedReview(review) ? " - edited" : ""}</Text>
        <Text style={styles.reviewTitle} numberOfLines={1}>{review.title}</Text>
        <Text style={styles.reviewBody} numberOfLines={2}>{review.body}</Text>
      </View>
    </Pressable>
  );
}

function ProfileMediaSection({ kicker, title, action, items, onAction, onOpen, onMenu }: { kicker: string; title: string; action: string; items: MediaSummary[]; onAction: () => void; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  if (!items.length) return null;
  return <View style={styles.profileSection}><SectionTitle kicker={kicker} title={title} action={action} onAction={onAction} /><CardGrid items={items} onOpen={onOpen} onMenu={onMenu} /></View>;
}

function ProfileListsSection({ owner, lists, onOpenLists, onOpenList }: { owner: string; lists: UserList[]; onOpenLists: () => void; onOpenList: (list: UserList) => void }) {
  if (!lists.length) return null;
  return <View style={styles.profileSection}><SectionTitle kicker={`Curated by ${owner}`} title="Lists" action="Manage lists ->" onAction={onOpenLists} /><ListGrid lists={lists.slice(0, 6)} onOpen={onOpenList} /></View>;
}

function ListGrid({ lists, onOpen }: { lists: UserList[]; onOpen?: (list: UserList) => void }) {
  if (!lists.length) return <EmptyPanel title="No lists yet" body="Create lists on the website and they will appear here." />;
  return <View style={styles.listGrid}>{lists.map(list => <Pressable key={list.id} onPress={() => onOpen?.(list)} style={styles.listCard}><PosterStack posters={list.posters} /><Text style={styles.listVisibility}>{list.visibility ?? "private"}</Text><Text style={styles.listName} numberOfLines={1}>{list.name}</Text><Text style={styles.listDescription} numberOfLines={2}>{list.description || "A hand-picked collection."}</Text><Text style={styles.listCount}>{list.count} {list.count === 1 ? "title" : "titles"}</Text></Pressable>)}</View>;
}

function sortListItems(items: MediaSummary[], sort: ListSort) {
  const titleCompare = (a: MediaSummary, b: MediaSummary) => a.title.localeCompare(b.title);
  const dateValue = (value?: string | null, newest = true) => value || (newest ? "0000-00-00" : "9999-99-99");
  const listFields = (item: MediaSummary) => item as MediaSummary & { listAddedAt?: string | null; listPosition?: number | null };
  return [...items].sort((a, b) => {
    const aList = listFields(a);
    const bList = listFields(b);
    if (sort === "none") return (aList.listPosition ?? 999_999) - (bList.listPosition ?? 999_999);
    if (sort === "title_desc") return b.title.localeCompare(a.title);
    if (sort === "release_desc") return dateValue(b.releaseDate).localeCompare(dateValue(a.releaseDate)) || titleCompare(a, b);
    if (sort === "release_asc") return dateValue(a.releaseDate, false).localeCompare(dateValue(b.releaseDate, false)) || titleCompare(a, b);
    if (sort === "added_desc") return dateValue(bList.listAddedAt).localeCompare(dateValue(aList.listAddedAt)) || titleCompare(a, b);
    if (sort === "added_asc") return dateValue(aList.listAddedAt, false).localeCompare(dateValue(bList.listAddedAt, false)) || titleCompare(a, b);
    if (sort === "list_order") return (aList.listPosition ?? 999_999) - (bList.listPosition ?? 999_999) || titleCompare(a, b);
    return titleCompare(a, b);
  });
}

function groupedListItems(items: MediaSummary[], groupBy: ListGroup) {
  const ordered = sortListItems(items, "list_order");
  if (groupBy === "none") return [{ title: "Titles", items }];
  const groups = groupBy === "collections" ? groupFranchises(ordered) : new Map<string, MediaSummary[]>();
  return [...groups.entries()]
    .map(([title, groupItems]) => ({ title, items: title.startsWith("Other") ? groupItems : sortListItems(groupItems, "release_asc") }))
    .sort((a, b) => (a.title.startsWith("Other") ? 1 : b.title.startsWith("Other") ? -1 : a.title.localeCompare(b.title)));
}

function availableListFranchiseGroups(items: MediaSummary[]) {
  return [...new Set(items.flatMap(item => {
    const name = listFranchiseName(item)?.name;
    return name ? [name] : [];
  }))].sort((a, b) => a.localeCompare(b));
}

function GroupedListContent({ groups, onOpen, onMenu }: { groups: Array<{ title: string; items: MediaSummary[] }>; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  if (!groups.some(group => group.items.length)) return <EmptyPanel title="No titles in this list" body="Add titles on the website and they will appear here." />;
  return <View>{groups.map(group => group.items.length ? <View key={group.title} style={styles.listGroupBlock}>{groups.length > 1 ? <Text style={styles.listGroupTitle}>{group.title}</Text> : null}<CardGrid items={group.items} onOpen={onOpen} onMenu={onMenu} /></View> : null)}</View>;
}

function PosterStack({ posters }: { posters: string[] }) {
  return <View style={styles.posterStack}>{posters.slice(0, 4).map((poster, index) => <Image key={`${poster}-${index}`} source={{ uri: tmdbImage(poster, "w342") ?? poster }} style={[styles.stackPoster, { left: 16 + index * 32, transform: [{ rotate: `${(index - 1.5) * 5}deg` }] }]} />)}{!posters.length ? <Ionicons name="list-outline" size={38} color={colors.muted} /> : null}</View>;
}

function ProfileShortcuts({ onCalendar, onHistory, onReviews, onSettings }: { onCalendar: () => void; onHistory: () => void; onReviews: () => void; onSettings: () => void }) {
  return <View style={styles.shortcuts}><Shortcut icon="settings-outline" title="Settings" body="Profile, privacy, security and integrations" onPress={onSettings} /><Shortcut icon="calendar-outline" title="Episode calendar" body="See what airs next" onPress={onCalendar} /><Shortcut icon="time-outline" title="Watch history" body="Browse your complete diary" onPress={onHistory} /><Shortcut icon="chatbox-outline" title="Your reviews" body="Open every review and its title" onPress={onReviews} /></View>;
}

function Shortcut({ icon, title, body, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={styles.shortcut}><Ionicons name={icon} size={22} color={colors.accent} /><View><Text style={styles.shortcutTitle}>{title}</Text><Text style={styles.shortcutBody}>{body}</Text></View></Pressable>;
}

function ProfileHero({ profile, session, data, fallbackName, onSettings }: { profile: Profile | null; session: Session; data: ProfileData; fallbackName: string; onSettings: () => void }) {
  const avatarUrl = profile?.avatar_url || (session.user.user_metadata?.avatar_url || session.user.user_metadata?.picture) as string | undefined;
  const bannerUrl = profile?.banner_url || null;
  const displayName = profile?.display_name || profile?.username || fallbackName;
  const handle = profile?.username ? `@${profile.username}` : session.user.email ?? "";
  const memberSince = profile?.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" }) : null;
  const initial = (displayName || session.user.email || "M").slice(0, 1).toUpperCase();

  return (
    <View style={styles.profileHero}>
      {bannerUrl ? <RemoteImage uri={bannerUrl} style={styles.profileBanner} resizeMode="cover" /> : <View style={styles.profileBannerFallback} />}
      <View style={styles.profileShade} />
      <View style={styles.profileContent}>
        <View style={styles.profileAvatarLarge}>
          {avatarUrl ? <RemoteImage uri={avatarUrl} style={styles.profileAvatarImage} /> : <Text style={styles.profileAvatarInitial}>{initial}</Text>}
        </View>
        <View style={styles.profileNameRow}>
          <View style={styles.profileNameCopy}>
            <Text style={styles.profileKicker}>{memberSince ? `Member since ${memberSince}` : "Signed in"}</Text>
            <Text style={styles.profileName} numberOfLines={2}>{displayName}</Text>
            {handle ? <Text style={styles.profileHandle} numberOfLines={1}>{handle}     {data.followers} followers     {data.following} following</Text> : null}
          </View>
        </View>
        {profile?.bio ? <Text style={styles.profileBio} numberOfLines={3}>{profile.bio}</Text> : null}
        {profile?.region ? (
          <View style={styles.profileRegion}>
            <Ionicons name="location-outline" size={15} color={colors.muted} />
            <Text style={styles.profileRegionText}>{profile.region}</Text>
          </View>
        ) : null}
        <Pressable onPress={onSettings} style={styles.editProfileButton}>
          <Ionicons name="settings-outline" size={20} color={colors.text} />
          <Text style={styles.editProfileText}>Edit profile</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MfaPanel({ code, error, busy, onCode, onVerify }: { code: string; error?: string; busy: boolean; onCode: (code: string) => void; onVerify: () => void }) {
  return (
    <View style={styles.mfaPanel}>
      <View style={styles.mfaIcon}>
        <Ionicons name="shield-checkmark-outline" size={34} color={colors.accent} />
      </View>
      <Text style={styles.mfaTitle}>Authenticator required</Text>
      <Text style={styles.mfaBody}>Enter the current six-digit code from the authenticator connected to your MovieTracker account.</Text>
      <TextInput value={code} onChangeText={onCode} keyboardType="number-pad" maxLength={6} placeholder="000000" placeholderTextColor="#71777a" style={styles.mfaInput} />
      {error ? <Text style={styles.mfaError}>{error}</Text> : null}
      <Pressable disabled={busy} onPress={onVerify} style={[styles.authButton, busy && styles.disabledButton]}>
        {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.authButtonText}>Verify and continue</Text>}
      </Pressable>
    </View>
  );
}

function MovieActionSheet({ item, visible, session, currentList, franchiseGroups = [], allowNotInterested, onClose, onOpen, onNotInterested, onChanged }: { item: MediaSummary | null; visible: boolean; session: Session | null; currentList?: UserList | null; franchiseGroups?: string[]; allowNotInterested?: boolean; onClose: () => void; onOpen: (item: MediaSummary) => void; onNotInterested: (item: MediaSummary) => void; onChanged: (reason?: ActionRefreshReason) => Promise<void> }) {
  const [dbId, setDbId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [lists, setLists] = useState<ListMembership[]>([]);
  const [listsLoading, setListsLoading] = useState(false);
  const [listsError, setListsError] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [manualGroup, setManualGroup] = useState("");
  const [newManualGroup, setNewManualGroup] = useState("");
  const [busy, setBusy] = useState(false);
  const [watchSheetVisible, setWatchSheetVisible] = useState(false);
  const poster = tmdbImage(item?.posterPath ?? item?.backdropPath ?? null, "w342");
  const filteredLists = lists.filter(list => list.name.toLowerCase().includes(listQuery.trim().toLowerCase()));
  const isCurrentListItem = Boolean(currentList && lists.some(list => list.id === currentList.id && list.contains));
  const activeCurrentList = isCurrentListItem ? currentList : null;

  const loadState = useCallback(async () => {
    if (!visible || !item || !session?.user.id || !supabase) return;
    setListsLoading(true);
    setListsError("");
    try {
      const [{ data: media, error: mediaError }, userLists] = await Promise.all([
        supabase.from("media").select("id").eq("tmdb_id", item.id).eq("kind", item.kind).maybeSingle(),
        loadUserLists(session.user.id)
      ]);
      if (mediaError) throw mediaError;
      let mediaId = media?.id ? Number(media.id) : null;
      if (!mediaId && session.access_token) {
        const hydrated = await fetchMobileTitle(item.kind, item.id, session.access_token).catch(() => null);
        mediaId = hydrated?.dbId ? Number(hydrated.dbId) : null;
      }
      setDbId(mediaId);
      if (!mediaId) {
        setLists(userLists.map(list => ({ ...list, contains: false })));
        return;
      }
      const [progress, fav, contains] = await Promise.all([
        supabase.from("progress").select("status").eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle(),
        supabase.from("favorites").select("media_id").eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle(),
        supabase.from("list_items").select("list_id").eq("media_id", mediaId)
      ]);
      if (progress.error) throw progress.error;
      if (fav.error) throw fav.error;
      if (contains.error) throw contains.error;
      const containing = new Set((contains.data ?? []).map((row: any) => row.list_id));
      setStatus(progress.data?.status ?? null);
      setFavorite(Boolean(fav.data));
      setLists(userLists.map(list => ({ ...list, contains: containing.has(list.id) })));
    } catch (reason) {
      setListsError(reason instanceof Error ? reason.message : "Lists could not be loaded.");
    } finally {
      setListsLoading(false);
    }
  }, [item, session?.user.id, visible]);

  useEffect(() => { void loadState(); }, [loadState]);

  useEffect(() => {
    if (!visible) return;
    setManualGroup(item?.franchiseGroup?.trim() ?? "");
    setNewManualGroup("");
  }, [item?.franchiseGroup, visible]);

  async function ensureActionMediaId() {
    if (dbId) return dbId;
    if (!session?.user.id || !supabase || !item) return null;
    const { data: media } = await supabase.from("media").select("id").eq("tmdb_id", item.id).eq("kind", item.kind).maybeSingle();
    let mediaId = media?.id ? Number(media.id) : null;
    if (!mediaId && session.access_token) {
      const hydrated = await fetchMobileTitle(item.kind, item.id, session.access_token).catch(() => null);
      mediaId = hydrated?.dbId ? Number(hydrated.dbId) : null;
    }
    if (mediaId) setDbId(mediaId);
    return mediaId;
  }

  async function updateStatus(nextStatus: string) {
    const mediaId = await ensureActionMediaId();
    if (!session?.user.id || !supabase || !mediaId) return Alert.alert("Unavailable", "Could not prepare this title yet. Try again in a second.");
    setBusy(true);
    try {
      await supabase.from("progress").upsert({ user_id: session.user.id, media_id: mediaId, status: nextStatus, completed_at: null, updated_at: new Date().toISOString() });
      setStatus(nextStatus);
      await onChanged("profile");
    } finally {
      setBusy(false);
    }
  }

  async function clearStatus() {
    const mediaId = await ensureActionMediaId();
    if (!session?.user.id || !supabase || !mediaId) return Alert.alert("Unavailable", "Could not prepare this title yet. Try again in a second.");
    setBusy(true);
    try {
      await supabase.from("progress").delete().eq("user_id", session.user.id).eq("media_id", mediaId);
      setStatus(null);
      await onChanged("profile");
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite() {
    const mediaId = await ensureActionMediaId();
    if (!session?.user.id || !supabase || !mediaId) return Alert.alert("Unavailable", "Could not prepare this title yet. Try again in a second.");
    setBusy(true);
    try {
      if (favorite) await supabase.from("favorites").delete().eq("user_id", session.user.id).eq("media_id", mediaId);
      else await supabase.from("favorites").insert({ user_id: session.user.id, media_id: mediaId });
      setFavorite(!favorite);
      await onChanged("profile");
    } finally {
      setBusy(false);
    }
  }

  async function performToggleList(list: ListMembership) {
    const mediaId = await ensureActionMediaId();
    if (!supabase || !mediaId) return Alert.alert("Still preparing", "Try again in a second.");
    const nextContains = !list.contains;
    const snapshot = lists;
    setBusy(true);
    setLists(current => current.map(candidate => candidate.id === list.id ? { ...candidate, contains: nextContains } : candidate));
    try {
      if (list.contains) {
        await supabase.from("list_items").delete().eq("list_id", list.id).eq("media_id", mediaId);
      } else {
        const { data: existing } = await supabase.from("list_items").select("id").eq("list_id", list.id).eq("media_id", mediaId).maybeSingle();
        if (!existing?.id) {
          const { count } = await supabase.from("list_items").select("id", { count: "exact", head: true }).eq("list_id", list.id);
          await supabase.from("list_items").insert({ list_id: list.id, media_id: mediaId, position: count ?? 0 });
        }
      }
      await onChanged("list");
    } catch (reason) {
      setLists(snapshot);
      Alert.alert("Could not update list", reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function toggleList(list: ListMembership) {
    if (!list.contains) {
      void performToggleList(list);
      return;
    }
    Alert.alert("Remove from list?", `Remove ${item?.title ?? "this title"} from ${list.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void performToggleList(list) }
    ]);
  }

  async function saveFranchiseGroup() {
    const mediaId = item?.listMediaId ?? await ensureActionMediaId();
    if (!supabase || !currentList?.id || !mediaId) return Alert.alert("Unavailable", "Could not prepare this title yet. Try again in a second.");
    const group = (newManualGroup || manualGroup).trim();
    setBusy(true);
    try {
      await supabase.from("list_items").update({ franchise_group: group || null }).eq("list_id", currentList.id).eq("media_id", mediaId);
      setManualGroup(group);
      setNewManualGroup("");
      await onChanged("list");
    } finally {
      setBusy(false);
    }
  }

  async function saveActionWatchLog(values: WatchLogValues) {
    const mediaId = await ensureActionMediaId();
    if (!session?.user.id || !supabase || !mediaId || !item) return Alert.alert("Unavailable", "Could not prepare this title yet. Try again in a second.");
    const runtime = Number((item.raw as any)?.runtime ?? 0) || 0;
    const watchedAt = resolveWatchLogDate(values, item.releaseDate, runtime);
    setBusy(true);
    try {
      const [watchResult, progressResult] = await Promise.all([
        supabase.from("watch_events").insert({ user_id: session.user.id, media_id: mediaId, duration_minutes: runtime || null, watched_at: watchedAt }),
        supabase.from("progress").upsert({ user_id: session.user.id, media_id: mediaId, status: "completed", completed_at: watchedAt, updated_at: new Date().toISOString() })
      ]);
      if (watchResult.error) throw watchResult.error;
      if (progressResult.error) throw progressResult.error;
      setStatus("completed");
      await onChanged("watch");
      Alert.alert("Watch added", "Your watch history was updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Modal visible={visible && Boolean(item)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <View style={styles.actionSheet}>
        <View style={styles.grabber} />
        <View style={styles.actionHeader}>
          {poster ? <RemoteImage uri={poster} style={styles.actionThumb} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle} numberOfLines={2}>{item?.title}</Text>
            <Text style={styles.actionSub}>{session ? "Movie actions" : "Sign in to edit lists and status"}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
        </View>
        {session ? (
          <>
            <View style={styles.contextPrimaryActions}>
              {item ? <Pressable style={styles.contextPrimaryButton} onPress={() => { onClose(); onOpen(item); }}><Ionicons name="open-outline" size={22} color={colors.text} /><Text style={styles.contextPrimaryText}>Details</Text></Pressable> : null}
              <Pressable disabled={busy} style={styles.contextPrimaryButton} onPress={() => status === "planned" ? clearStatus() : updateStatus("planned")}><Ionicons name="list-outline" size={22} color={colors.text} /><Text style={styles.contextPrimaryText}>{status === "planned" ? "Remove plan" : "Watchlist"}</Text></Pressable>
              <Pressable disabled={busy} style={styles.contextPrimaryButton} onPress={() => setWatchSheetVisible(true)}><Ionicons name={status === "completed" ? "repeat-outline" : "checkmark"} size={22} color={colors.text} /><Text style={styles.contextPrimaryText}>{status === "completed" ? "Add watch" : "Watched"}</Text></Pressable>
              <Pressable disabled={busy} style={styles.contextPrimaryButton} onPress={toggleFavorite}><Ionicons name={favorite ? "heart" : "heart-outline"} size={22} color={colors.text} /><Text style={styles.contextPrimaryText}>{favorite ? "Unfavorite" : "Favorite"}</Text></Pressable>
            </View>
            <View style={styles.actionDivider} />
            {activeCurrentList ? (
              <View style={styles.currentListSection}>
                <Text style={styles.actionSectionLabel}>Current list</Text>
                <Pressable disabled={busy} onPress={() => {
                  const list = lists.find(candidate => candidate.id === activeCurrentList.id);
                  if (list) toggleList(list);
                }} style={styles.currentListRemove}><Ionicons name="trash-outline" size={17} color={colors.danger} /><Text style={styles.currentListRemoveText}>Remove from {activeCurrentList.name}</Text></Pressable>
              </View>
            ) : null}
            {isCurrentListItem ? (
              <View style={styles.currentListSection}>
                <Text style={styles.actionSectionLabel}>Franchise group</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.franchiseGroupChips}>
                  <Pressable disabled={busy} onPress={() => setManualGroup("")} style={[styles.groupChip, !manualGroup && styles.groupChipActive]}><Text style={[styles.groupChipText, !manualGroup && styles.groupChipTextActive]}>Auto / none</Text></Pressable>
                  {franchiseGroups.map(group => (
                    <Pressable disabled={busy} key={group} onPress={() => setManualGroup(group)} style={[styles.groupChip, manualGroup === group && styles.groupChipActive]}><Text style={[styles.groupChipText, manualGroup === group && styles.groupChipTextActive]} numberOfLines={1}>{group}</Text></Pressable>
                  ))}
                </ScrollView>
                <View style={styles.franchiseGroupCreateRow}>
                  <TextInput value={newManualGroup} onChangeText={setNewManualGroup} placeholder="Create group" placeholderTextColor={colors.muted} style={styles.franchiseGroupInput} />
                  <Pressable disabled={busy} onPress={saveFranchiseGroup} style={styles.franchiseGroupSave}><Text style={styles.franchiseGroupSaveText}>Save</Text></Pressable>
                </View>
              </View>
            ) : null}
            <Text style={styles.actionSectionLabel}>Custom lists</Text>
            {lists.length ? <View style={styles.contextListSearch}><Ionicons name="search-outline" size={18} color={colors.muted} /><TextInput value={listQuery} onChangeText={setListQuery} placeholder="Find a list" placeholderTextColor={colors.muted} style={styles.contextListInput} /></View> : null}
            <ScrollView style={[styles.actionListScroll, isCurrentListItem && styles.actionListScrollCompact]} contentContainerStyle={styles.actionListContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
              {listsLoading ? <ActivityIndicator color={colors.accent} /> : listsError ? <Pressable onPress={() => void loadState()} style={styles.listRetryButton}><Text style={styles.actionSub}>Lists did not load. Tap to retry.</Text></Pressable> : filteredLists.length ? filteredLists.map(list => (
                <Pressable disabled={busy} key={list.id} onPress={() => toggleList(list)} style={[styles.listActionRow, list.contains && styles.listActionRowActive]}>
                  <Text style={[styles.listActionName, list.contains && styles.listActionNameActive]} numberOfLines={1}>{list.name}</Text>
                  <View style={styles.listActionState}>
                    <Ionicons name={list.contains ? "checkmark" : "list-outline"} size={16} color={list.contains ? "#6ee7a8" : colors.muted} />
                    <Text style={[styles.listActionText, list.contains && styles.listActionTextActive]}>{list.contains ? "Added" : "Add"}</Text>
                  </View>
                </Pressable>
              )) : <Text style={styles.actionSub}>{lists.length ? "No lists match that search." : "No lists yet."}</Text>}
            </ScrollView>
            {allowNotInterested && item ? <><View style={styles.actionDivider} /><ActionRow icon="ban-outline" label="Not interested" danger onPress={() => onNotInterested(item)} /></> : null}
          </>
        ) : item ? <ActionRow icon="open-outline" label="Details" onPress={() => { onClose(); onOpen(item); }} /> : null}
      </View>
    </Modal>
    <WatchLogSheet visible={watchSheetVisible} title={item?.title ?? ""} releaseDate={item?.releaseDate ?? null} runtime={Number((item?.raw as any)?.runtime ?? 0) || null} busy={busy} watched={status === "completed"} onClose={() => setWatchSheetVisible(false)} onSave={saveActionWatchLog} />
    </>
  );
}

function ActionRow({ icon, label, danger, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; danger?: boolean; onPress?: () => void }) {
  return (
    <Pressable style={styles.actionRow} onPress={onPress}>
      <Ionicons name={icon} size={23} color={danger ? colors.danger : colors.text} style={styles.actionIcon} />
      <Text style={[styles.actionText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

function EpisodeDetailScreen({ target, session, onBack, onOpen, onOpenEntity, onOpenSeason, onChanged }: { target: EpisodeTarget; session: Session | null; onBack: () => void; onOpen: (item: MediaSummary) => void; onOpenEntity: (entity: EntityTarget) => void; onOpenSeason: (season: DetailSeason, show: MediaSummary, seasons: DetailSeason[]) => void; onChanged?: (reason?: ActionRefreshReason) => Promise<void> }) {
  const [episode, setEpisode] = useState<any | null>(() => ({
    id: target.episodeId,
    name: target.title ?? `Episode ${target.episodeNumber}`,
    overview: target.overview ?? null,
    episode_number: target.episodeNumber,
    episodeNumber: target.episodeNumber,
    air_date: target.airDate ?? null,
    airDate: target.airDate ?? null,
    still_path: target.artwork ?? null,
    runtime: target.runtime ?? null,
    vote_average: target.voteAverage ?? null,
    seasons: [{ season_number: target.seasonNumber, seasonNumber: target.seasonNumber, media: [target.show] }]
  }));
  const [episodeLoading, setEpisodeLoading] = useState(true);
  const [episodeLoadError, setEpisodeLoadError] = useState<string | null>(null);
  const [watched, setWatched] = useState(false);
  const [lastWatchedAt, setLastWatchedAt] = useState<string | null>(null);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [communityRating, setCommunityRating] = useState<number | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [myReview, setMyReview] = useState<ReviewItem | null>(null);
  const [episodeExternalRatings, setEpisodeExternalRatings] = useState<Array<{ label: string; value: string }>>([]);
  const [episodeCompanies, setEpisodeCompanies] = useState<DetailCompany[]>([]);
  const [episodeRecommendations, setEpisodeRecommendations] = useState<MediaSummary[]>([]);
  const [showSeasons, setShowSeasons] = useState<DetailSeason[]>([]);
  const [busy, setBusy] = useState(false);
  const [ratingSheetVisible, setRatingSheetVisible] = useState(false);
  const [watchSheetVisible, setWatchSheetVisible] = useState(false);
  const art = tmdbImage(episode?.still_path ?? target.artwork ?? target.show.backdropPath ?? target.show.posterPath, "w780");

  const loadEpisode = useCallback(async () => {
    setEpisode((current: any | null) => current ?? {
      id: target.episodeId, name: target.title ?? `Episode ${target.episodeNumber}`, overview: target.overview ?? null,
      episode_number: target.episodeNumber, episodeNumber: target.episodeNumber, air_date: target.airDate ?? null,
      airDate: target.airDate ?? null, still_path: target.artwork ?? null, runtime: target.runtime ?? null, vote_average: target.voteAverage ?? null,
      seasons: [{ season_number: target.seasonNumber, seasonNumber: target.seasonNumber, media: [target.show] }]
    });
    setEpisodeLoading(true);
    setEpisodeLoadError(null);
    const mobileEpisode = await fetchMobileEpisode(target.show.id, target.seasonNumber, target.episodeNumber, session?.access_token).catch(() => null);
    if (mobileEpisode) {
      setEpisode({
        ...mobileEpisode.episode,
        id: mobileEpisode.episodeId ?? mobileEpisode.episode.id,
        seasons: [{
          ...mobileEpisode.season,
          media_id: mobileEpisode.mediaId,
          media: [mobileEpisode.show]
        }]
      });
      setWatched(Boolean(mobileEpisode.watched));
      setLastWatchedAt(mobileEpisode.lastWatchedAt ?? null);
      setUserRating(mobileEpisode.userRating ?? null);
      setCommunityRating(mobileEpisode.communityRating ?? null);
      setReviews(mobileEpisode.reviews ?? []);
      setMyReview(mobileEpisode.myReview ?? null);
      setEpisodeExternalRatings(mobileEpisode.externalRatings ?? []);
      setEpisodeCompanies(mobileEpisode.companies ?? []);
      setEpisodeRecommendations(dedupeMedia(mobileEpisode.recommendations ?? []).filter(recommendation => !(recommendation.kind === mobileEpisode.show.kind && recommendation.id === mobileEpisode.show.id)));
      setShowSeasons((mobileEpisode.show as any).seasons?.map((candidate: any) => ({ id: candidate.id, seasonNumber: Number(candidate.seasonNumber ?? candidate.season_number), name: candidate.name, overview: candidate.overview, posterPath: candidate.posterPath ?? candidate.poster_path, airDate: candidate.airDate ?? candidate.air_date, episodeCount: candidate.episodeCount ?? candidate.episode_count })).filter((candidate: DetailSeason) => candidate.seasonNumber > 0) ?? []);
      setEpisodeLoading(false);
      return;
    }
    if (!supabase) {
      setEpisodeLoadError("Episode details did not load. Please try again.");
      setEpisodeLoading(false);
      return;
    }
    const query = supabase.from("episodes").select("id,name,overview,episode_number,air_date,still_path,runtime,vote_average,credits,raw,seasons(season_number,name,media_id,media(*))");
    const result = target.episodeId
      ? await query.eq("id", target.episodeId).maybeSingle()
      : await query.eq("episode_number", target.episodeNumber).maybeSingle();
    if (result.data) setEpisode(result.data);
    const episodeId = result.data?.id ?? target.episodeId;
    const season = firstRow(result.data?.seasons);
    const show = firstRow(season?.media) ? fromDbMedia(firstRow(season?.media)) : target.show;
    fetchWebsiteTitleMetadata(show.kind, show.id).then(metadata => {
      const recommendations = dedupeMedia(metadata.recommendations ?? []).filter(recommendation => !(recommendation.kind === show.kind && recommendation.id === show.id));
      setEpisodeRecommendations(recommendations);
      setEpisodeExternalRatings(metadata.ratings ?? []);
    }).catch(() => setEpisodeRecommendations([]));
    if (episodeId) {
      const reviewSelect = "id,title,body,created_at,updated_at,user_id,rating_id,contains_spoilers,ratings(score)";
      const [allRatings, reviewRows, myRatingRow, myReviewRow] = await Promise.all([
        supabase.from("ratings").select("score").eq("episode_id", episodeId),
        supabase.from("reviews").select(reviewSelect).eq("episode_id", episodeId).order("created_at", { ascending: false }).limit(20),
        session?.user.id ? supabase.from("ratings").select("score").eq("user_id", session.user.id).eq("episode_id", episodeId).maybeSingle() : Promise.resolve({ data: null }),
        session?.user.id ? supabase.from("reviews").select(reviewSelect).eq("user_id", session.user.id).eq("episode_id", episodeId).maybeSingle() : Promise.resolve({ data: null })
      ]);
      const ratingRows = allRatings.data ?? [];
      setCommunityRating(ratingRows.length ? ratingRows.reduce((sum: number, row: any) => sum + Number(row.score), 0) / ratingRows.length : null);
      setUserRating(typeof myRatingRow.data?.score === "number" ? Number(myRatingRow.data.score) : null);
      setReviews((reviewRows.data ?? []).flatMap((review: any) => mapTargetReview(review, show, "episode")));
      setMyReview(mapTargetReview(myReviewRow.data, show, "episode")[0] ?? null);
      if (session?.user.id) {
        let watchQuery = supabase.from("watch_events").select("id,watched_at").eq("user_id", session.user.id).eq("episode_id", episodeId);
        if (season?.media_id) watchQuery = watchQuery.eq("media_id", season.media_id);
        const { data } = await watchQuery.order("watched_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        setWatched(Boolean(data));
        setLastWatchedAt(data?.watched_at ?? null);
      }
    }
    setEpisodeLoading(false);
  }, [session?.access_token, session?.user.id, target.episodeId, target.episodeNumber, target.seasonNumber, target.show]);

  useEffect(() => {
    loadEpisode().catch(() => {
      setEpisodeLoadError("Episode details did not load. Please try again.");
      setEpisodeLoading(false);
    });
  }, [loadEpisode]);

  async function withEpisodeBusy(work: () => Promise<void>, reason: ActionRefreshReason = "watch", reload = true) {
    setBusy(true);
    try {
      await work();
      if (reload) await loadEpisode();
      await onChanged?.(reason);
    } finally {
      setBusy(false);
    }
  }

  async function markWatched() {
    if (!session?.user.id || !supabase) return Alert.alert("Sign in needed", "Sign in before tracking episodes.");
    const season = firstRow(episode?.seasons);
    const mediaId = season?.media_id;
    const episodeId = episode?.id ?? target.episodeId;
    if (!mediaId || !episodeId) return Alert.alert("Unavailable", "This episode is not ready for tracking yet.");
    await withEpisodeBusy(async () => {
      await supabase!.from("watch_events").insert({ user_id: session.user.id, media_id: mediaId, episode_id: episodeId, watched_at: new Date().toISOString() });
      await supabase!.from("progress").upsert({ user_id: session.user.id, media_id: mediaId, status: "watching", updated_at: new Date().toISOString() });
      setWatched(true);
      setLastWatchedAt(new Date().toISOString());
    }, "watch", false);
  }

  async function saveEpisodeWatchLog(values: WatchLogValues) {
    if (!session?.user.id || !supabase) return Alert.alert("Sign in needed", "Sign in before tracking episodes.");
    const season = firstRow(episode?.seasons);
    const mediaId = season?.media_id;
    const episodeId = episode?.id ?? target.episodeId;
    if (!mediaId || !episodeId) return Alert.alert("Unavailable", "This episode is not ready for tracking yet.");
    const watchedAt = resolveWatchLogDate(values, episode?.air_date ?? target.airDate, episode?.runtime ?? 0);
    await withEpisodeBusy(async () => {
      const [watchResult, progressResult] = await Promise.all([
        supabase!.from("watch_events").insert({ user_id: session.user.id, media_id: mediaId, episode_id: episodeId, duration_minutes: episode?.runtime ?? null, watched_at: watchedAt }),
        supabase!.from("progress").upsert({ user_id: session.user.id, media_id: mediaId, status: "watching", updated_at: new Date().toISOString() })
      ]);
      if (watchResult.error) throw watchResult.error;
      if (progressResult.error) throw progressResult.error;
      setWatched(true);
      setLastWatchedAt(watchedAt);
    }, "watch", false);
  }

  const season = firstRow(episode?.seasons);
  const showCandidate = firstRow(season?.media) as any;
  const show = showCandidate?.tmdb_id ? fromDbMedia(showCandidate) : showCandidate?.kind ? showCandidate as MediaSummary : target.show;
  const title = episode?.name ?? target.title ?? `Episode ${target.episodeNumber}`;
  const episodeId = episode?.id ?? target.episodeId ?? null;
  const cast = [...(episode?.credits?.cast ?? []), ...(episode?.credits?.guest_stars ?? []), ...(episode?.raw?.credits?.cast ?? []), ...(episode?.raw?.credits?.guest_stars ?? [])].slice(0, 18);
  const images = (episode?.raw?.images?.stills ?? episode?.raw?.images ?? []).slice(0, 12);
  const videos = (episode?.raw?.videos?.results ?? []).filter((video: any) => video.site === "YouTube");
  const trailer = videos.find((video: any) => video.type === "Trailer") ?? videos[0];
  const seasonTarget: DetailSeason = { id: season?.id, seasonNumber: target.seasonNumber, name: season?.name || `Season ${target.seasonNumber}`, overview: null, posterPath: null, airDate: null, episodeCount: null };
  const episodeRatingSources = [
    ...(communityRating != null ? [{ label: "MovieTracker", value: `${communityRating.toFixed(1)}/10` }] : []),
    ...(episode?.vote_average ? [{ label: "TMDB", value: `${Number(episode.vote_average).toFixed(1)}/10` }] : []),
    ...episodeExternalRatings.filter(source => source.label.toLowerCase() !== "tmdb")
  ];

  async function saveEpisodeRating(score: number | null) {
    if (!session?.user.id || !supabase || !episodeId) return Alert.alert("Unavailable", "This episode is not ready for rating yet.");
    const nextScore = score == null ? null : clampRating(score);
    await withEpisodeBusy(async () => {
      if (nextScore == null) {
        await supabase!.from("ratings").delete().eq("user_id", session.user.id).eq("episode_id", episodeId);
        await supabase!.from("reviews").update({ rating_id: null, updated_at: new Date().toISOString() }).eq("user_id", session.user.id).eq("episode_id", episodeId);
        return;
      }
      const { data: existing } = await supabase!.from("ratings").select("id").eq("user_id", session.user.id).eq("episode_id", episodeId).maybeSingle();
      const operation = existing?.id
        ? supabase!.from("ratings").update({ score: nextScore, updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
        : supabase!.from("ratings").insert({ user_id: session.user.id, episode_id: episodeId, score: nextScore }).select("id").single();
      const { data: savedRating, error } = await operation;
      if (error) throw error;
      if (savedRating?.id) await supabase!.from("reviews").update({ rating_id: savedRating.id, updated_at: new Date().toISOString() }).eq("user_id", session.user.id).eq("episode_id", episodeId);
    });
    setRatingSheetVisible(false);
  }

  async function saveEpisodeReview(values: { score: number | null; title: string; body: string; containsSpoilers: boolean }) {
    if (!session?.user.id || !supabase || !episodeId) return Alert.alert("Unavailable", "This episode is not ready for review yet.");
    if (!values.body.trim()) return Alert.alert("Review needed", "Write a few words before publishing your review.");
    const nextScore = values.score == null ? null : clampRating(values.score);
    await withEpisodeBusy(async () => {
      let ratingId: string | null = null;
      if (nextScore != null) {
        const { data: existing } = await supabase!.from("ratings").select("id").eq("user_id", session.user.id).eq("episode_id", episodeId).maybeSingle();
        const operation = existing?.id
          ? supabase!.from("ratings").update({ score: nextScore, updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
          : supabase!.from("ratings").insert({ user_id: session.user.id, episode_id: episodeId, score: nextScore }).select("id").single();
        const { data: savedRating, error } = await operation;
        if (error) throw error;
        ratingId = savedRating?.id ?? null;
      }
      const payload = { title: values.title.trim() || null, body: values.body.trim(), contains_spoilers: values.containsSpoilers, rating_id: ratingId };
      const { data: existingReview } = await supabase!.from("reviews").select("id").eq("user_id", session.user.id).eq("episode_id", episodeId).maybeSingle();
      const result = existingReview?.id ? await supabase!.from("reviews").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", existingReview.id) : await supabase!.from("reviews").insert({ user_id: session.user.id, episode_id: episodeId, ...payload });
      if (result.error) throw result.error;
    });
    Alert.alert(myReview ? "Review updated" : "Review published", "Your episode review is saved.");
  }

  if (episodeLoading && !episode) {
    return (
      <View style={styles.detailLoadingScreen}>
        {art ? <RemoteImage uri={art} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.detailShadeV2} />
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}><Ionicons name="chevron-back" size={22} color={colors.text} /><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.detailLoadingCard}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.detailLoadingTitle}>Loading episode details</Text>
          <Text style={styles.detailLoadingText}>Getting ratings, description, watch history and episode extras...</Text>
        </View>
      </View>
    );
  }

  if (episodeLoadError && !episode) {
    return (
      <View style={styles.detailLoadingScreen}>
        {art ? <RemoteImage uri={art} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.detailShadeV2} />
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}><Ionicons name="chevron-back" size={22} color={colors.text} /><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.detailLoadingCard}>
          <Ionicons name="warning-outline" size={32} color={colors.accent} />
          <Text style={styles.detailLoadingTitle}>Episode did not load</Text>
          <Text style={styles.detailLoadingText}>{episodeLoadError}</Text>
          <Pressable onPress={() => loadEpisode().catch(() => undefined)} style={styles.trailerButton}><Text style={styles.trailerButtonText}>Try again</Text></Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.episodeHero}>
        {art ? <RemoteImage uri={art} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.detailShadeV2} />
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}><Ionicons name="chevron-back" size={22} color={colors.text} /><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.detailHeroCopyV2}>
          <Text style={styles.detailKicker}>Season {target.seasonNumber} · Episode {target.episodeNumber}</Text>
          <Text style={styles.detailTitleV2}>{title}</Text>
          <Text style={styles.detailMeta}>{show.title} · {episode?.air_date ?? target.airDate ?? "Air date TBA"}{episode?.runtime ? ` · ${episode.runtime} min` : ""}</Text>
          <View style={styles.ratingSourceRow}>{episodeRatingSources.map(source => <RatingSource key={source.label} label={source.label} value={source.value} />)}</View>
          <Text style={styles.detailOverview}>{episode?.overview || "No description has been released for this episode yet."}</Text>
          <View style={styles.detailQuickActions}>
            <Pressable onPress={() => onOpen(show)} style={styles.quickAction}><Ionicons name="albums-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Open show</Text></Pressable>
            <Pressable onPress={() => onOpenSeason(seasonTarget, show, showSeasons.length ? showSeasons : [seasonTarget])} style={styles.quickAction}><Ionicons name="layers-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>{isLimitedSeries(show, showSeasons.length ? showSeasons : [seasonTarget]) ? "All episodes" : "Open season"}</Text></Pressable>
            <Pressable onPress={() => setWatchSheetVisible(true)} style={styles.quickAction}><Ionicons name="ellipsis-horizontal-circle-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Actions</Text></Pressable>
            <Pressable disabled={busy} onPress={() => setWatchSheetVisible(true)} style={styles.quickAction}><Ionicons name={watched ? "repeat-outline" : "calendar-outline"} size={19} color={colors.text} /><Text style={styles.quickActionText}>{watched ? "Add another watch" : "Mark watched"}</Text></Pressable>
            <Pressable disabled={busy || !episodeId} onPress={() => setRatingSheetVisible(true)} style={styles.quickAction}><Ionicons name="speedometer-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>{userRating != null ? `${userRating.toFixed(1)}/10` : "Rate"}</Text></Pressable>
            <Pressable onPress={() => sharePublicTitle(`/title/show/${show.id}/season/${target.seasonNumber}/episode/${target.episodeNumber}`, `${show.title} - ${title}`, episode?.overview || show.overview)} style={styles.quickAction}><Ionicons name="share-social-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Share</Text></Pressable>
          </View>
          {lastWatchedAt ? <Text style={styles.lastWatchedText}>Last watched {formatLastWatched(lastWatchedAt)}</Text> : null}
        </View>
      </View>
      <View style={styles.detailBody}>
        <RatingSheet visible={ratingSheetVisible} value={userRating} busy={busy} onClose={() => setRatingSheetVisible(false)} onSave={saveEpisodeRating} />
        <WatchLogSheet visible={watchSheetVisible} title={`${show.title} - ${title}`} releaseDate={episode?.air_date ?? target.airDate ?? null} runtime={episode?.runtime ?? null} busy={busy} watched={watched} onClose={() => setWatchSheetVisible(false)} onSave={saveEpisodeWatchLog} />
        {images.length || trailer ? <TitleMediaPreview trailer={trailer} images={images} /> : null}
        {cast.length ? <CastSection cast={cast} onOpen={onOpenEntity} /> : null}
        {episodeCompanies.length ? <CompanySection companies={episodeCompanies} onOpen={onOpenEntity} /> : null}
        {session?.user.id && episodeId ? <ReviewComposerPanel existingReview={myReview} currentRating={userRating} busy={busy} onSubmit={saveEpisodeReview} /> : null}
        <DetailReviewsSection reviews={reviews} onOpen={onOpen} />
        {episodeRecommendations.length ? <DetailMediaSection kicker="If this stayed with you" title="More like this" items={episodeRecommendations} onOpen={onOpen} /> : null}
      </View>
    </ScrollView>
  );
}

function EntityScreen({ target, session, onBack, onOpen, onMenu }: { target: EntityTarget; session: Session | null; onBack: () => void; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  const [items, setItems] = useState<MediaSummary[]>([]);
  const [visibleCount, setVisibleCount] = useState(40);
  const [loadingEntity, setLoadingEntity] = useState(true);
  const [loadingMoreEntity, setLoadingMoreEntity] = useState(false);
  const [companyPages, setCompanyPages] = useState({ movie: { page: 1, totalPages: 1 }, show: { page: 1, totalPages: 1 } });
  const image = target.type === "person" ? tmdbImage(target.imagePath ?? null, "w342") : tmdbImage(target.imagePath ?? null, "w500");

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoadingEntity(true);
      setVisibleCount(40);
      if (target.type === "person") {
        const payload = await fetchMobilePerson(target.id, session?.access_token).catch(() => null);
        if (payload) {
          if (alive) setItems(dedupeMedia(payload.items ?? payload.person?.credits ?? []));
          return;
        }
      }
      if (target.type === "company") {
        const payload = await fetchMobileCompany(target.id, undefined, 1, session?.access_token).catch(() => null);
        if (payload) {
          const movies = payload.movies ?? { items: [], page: 1, totalPages: 1 };
          const shows = payload.shows ?? { items: [], page: 1, totalPages: 1 };
          if (alive) {
            setCompanyPages({
              movie: { page: movies.page ?? 1, totalPages: movies.totalPages ?? 1 },
              show: { page: shows.page ?? 1, totalPages: shows.totalPages ?? 1 }
            });
            setItems(dedupeMedia([...(movies.items ?? []), ...(shows.items ?? [])]));
          }
          return;
        }
      }
      const website = await fetchWebsiteEntityMetadata(target.type, target.id).catch(() => ({ items: [] as MediaSummary[] }));
      const websiteItems = website.items ?? [];
      if (!supabase) {
        if (alive) setItems(dedupeMedia(websiteItems));
        return;
      }
      const { data, error } = await supabase.from("media").select("*").is("deleted_at", null).order("popularity", { ascending: false }).limit(1000);
      if (error) throw error;
      const matches = (data ?? []).filter((row: any) => {
        if (target.type === "company") return (row.companies ?? row.raw?.production_companies ?? []).some((company: any) => Number(company?.id) === target.id);
        const cast = row.credits?.cast ?? row.raw?.credits?.cast ?? [];
        const crew = row.credits?.crew ?? row.raw?.credits?.crew ?? [];
        return [...cast, ...crew].some((person: any) => Number(person?.id) === target.id);
      }).map((row: any) => fromDbMedia(row));
      if (alive) setItems(dedupeMedia([...websiteItems, ...matches]));
    }
    load().catch(() => {
      if (alive) setItems([]);
    }).finally(() => {
      if (alive) setLoadingEntity(false);
    });
    return () => { alive = false; };
  }, [session?.access_token, target.id, target.type]);

  const visibleItems = items.slice(0, visibleCount);
  const canLoadMoreLocal = visibleCount < items.length;
  const canLoadMoreRemote = target.type === "company" && (companyPages.movie.page < companyPages.movie.totalPages || companyPages.show.page < companyPages.show.totalPages);
  const canLoadMore = canLoadMoreLocal || canLoadMoreRemote;

  const loadMoreCompany = useCallback(async () => {
    if (target.type !== "company" || loadingMoreEntity) return;
    const nextKind: MediaKind | null = companyPages.movie.page < companyPages.movie.totalPages ? "movie" : companyPages.show.page < companyPages.show.totalPages ? "show" : null;
    if (!nextKind) return;
    const nextPage = companyPages[nextKind].page + 1;
    setLoadingMoreEntity(true);
    try {
      const payload = await fetchMobileCompany(target.id, nextKind, nextPage, session?.access_token);
      const pageItems = payload.items ?? [];
      setCompanyPages(current => ({ ...current, [nextKind]: { page: payload.page ?? nextPage, totalPages: payload.totalPages ?? current[nextKind].totalPages } }));
      setItems(current => dedupeMedia([...current, ...pageItems]));
    } catch {
      setCompanyPages(current => ({ ...current, [nextKind]: { ...current[nextKind], page: current[nextKind].totalPages } }));
    } finally {
      setLoadingMoreEntity(false);
    }
  }, [companyPages, loadingMoreEntity, session?.access_token, target.id, target.type]);

  const handleEntityScroll = useCallback((event: any) => {
    if (!canLoadMore) return;
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y > contentSize.height - 900) {
      if (canLoadMoreLocal) setVisibleCount(count => Math.min(count + 40, items.length));
      else void loadMoreCompany();
    }
  }, [canLoadMore, canLoadMoreLocal, items.length, loadMoreCompany]);

  return (
    <ScrollView contentContainerStyle={styles.detailContent} onScroll={handleEntityScroll} scrollEventThrottle={300}>
      <View style={styles.entityHeader}>
        <Pressable onPress={onBack} style={styles.backChip}><Ionicons name="chevron-back" size={18} color={colors.text} /><Text style={styles.backChipText}>Back</Text></Pressable>
        <View style={styles.entityHeroRow}>
          <View style={target.type === "person" ? styles.entityPortrait : styles.entityLogoBox}>{image ? <RemoteImage uri={image} style={styles.posterImage} resizeMode={target.type === "person" ? "cover" : "contain"} /> : <Ionicons name={target.type === "person" ? "person-outline" : "business-outline"} size={44} color={colors.muted} />}</View>
          <View style={styles.entityCopy}>
            <Text style={styles.detailKicker}>{target.type === "person" ? "Cast & crew" : "Production company"}</Text>
            <Text style={styles.entityTitle}>{target.name}</Text>
            {target.subtitle ? <Text style={styles.entitySubtitle}>{target.subtitle}</Text> : null}
          </View>
        </View>
      </View>
      <SectionTitle kicker={target.type === "person" ? "Complete screen credits" : `Produced by ${target.name}`} title="Movies & series" />
      {loadingEntity ? <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} /> : items.length ? <CardGrid items={visibleItems} onOpen={onOpen} onMenu={onMenu} /> : <EmptyPanel title="No titles found" body="No website credits were available for this page." />}
      {!loadingEntity && items.length ? <View style={styles.entityLoadMore}><Text style={styles.entityLoadMoreText}>{loadingMoreEntity ? "Loading more titles..." : canLoadMore ? `Showing ${visibleItems.length} loaded titles. Keep scrolling.` : `All ${items.length} loaded titles shown`}</Text></View> : null}
    </ScrollView>
  );
}

function DetailScreenV2({ item, session, onBack, onOpen, onOpenEntity, onOpenSeason, onOpenAllSeasons, onHide, onChanged }: { item: MediaSummary; session: Session | null; onBack: () => void; onOpen: (item: MediaSummary) => void; onOpenEntity: (entity: EntityTarget) => void; onOpenSeason: (season: DetailSeason) => void; onOpenAllSeasons: (seasons: DetailSeason[]) => void; onHide: (item: MediaSummary) => void; onChanged: (reason?: ActionRefreshReason) => Promise<void> }) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailLoadError, setDetailLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listSheetVisible, setListSheetVisible] = useState(false);
  const [ratingSheetVisible, setRatingSheetVisible] = useState(false);
  const [watchSheetVisible, setWatchSheetVisible] = useState(false);
  const detailCacheKey = titleDetailCacheKey(item, session?.user.id);
  const backdrop = tmdbImage(item.backdropPath || item.posterPath, "w780");
  const poster = tmdbImage(item.posterPath, "w500");
  const director = detail?.crew.find(person => person.job === "Director" || person.job === "Creator");
  const trailer = detail?.videos.find(video => video.type === "Trailer" && video.official) ?? detail?.videos.find(video => video.type === "Trailer") ?? detail?.videos[0];
  const detailYearItem = { ...item, releaseDate: detail?.releaseDate ?? item.releaseDate, endDate: detail?.endDate ?? item.endDate, status: detail?.status ?? item.status };
  const detailGenres = detail?.genres?.length ? detail.genres : item.genres ?? [];
  const detailOverview = detail?.overview || item.overview || "No overview has been published yet.";
  const loadedExternalRatingLabels = new Set((detail?.externalRatings ?? []).map(source => source.label.toLowerCase()));
  const ratingSources = [
    { label: "MovieTracker", value: detail?.communityRating != null ? `${detail.communityRating.toFixed(1)}/10` : "—/10" },
    { label: "TMDB", value: detail?.voteAverage != null ? `${detail.voteAverage.toFixed(1)}/10` : item.voteAverage ? `${item.voteAverage.toFixed(1)}/10` : "New" },
    ...(detail?.externalRatings ?? []),
    ...((detail?.pendingExternalRatingSources ?? [])
      .filter(label => !loadedExternalRatingLabels.has(label.toLowerCase()))
      .map(label => ({ label, value: "Loading", loading: true })))
  ];

  const loadDetail = useCallback(async () => {
    const rawRuntime = Number((item.raw as any)?.runtime ?? (item.raw as any)?.episode_run_time?.[0] ?? 0) || null;
    const preview: DetailData = {
      dbId: null, overview: item.overview || null, tagline: null, releaseDate: item.releaseDate ?? null, endDate: item.endDate ?? null,
      genres: item.genres ?? [], voteAverage: item.voteAverage ?? null, runtime: rawRuntime, originalLanguage: item.originalLanguage ?? null,
      status: item.status ?? null, userRating: item.userRating ?? null, communityRating: trustedCommunityRating(item), externalRatings: [],
      pendingExternalRatingSources: [], progressStatus: null, watched: false, lastWatchedAt: null, favorite: false, lists: [], cast: [], crew: [],
      companies: (item as any).companies ?? [], videos: [], images: [], seasons: [], reviews: [], myReview: null,
      collectionName: item.collectionName ?? null, collection: [], recommendations: []
    };
    setDetail(preview);
    setDetailLoading(true);
    setDetailLoadError(null);
    const applyMobileDetail = (mobileDetail: any) => {
      const next: DetailData = {
        dbId: mobileDetail.dbId,
        overview: mobileDetail.overview || item.overview || null,
        tagline: mobileDetail.tagline ?? null,
        releaseDate: mobileDetail.releaseDate ?? item.releaseDate ?? null,
        endDate: mobileDetail.endDate ?? item.endDate ?? null,
        genres: mobileDetail.genres ?? item.genres ?? [],
        voteAverage: mobileDetail.voteAverage ?? item.voteAverage ?? null,
        runtime: mobileDetail.runtime ?? null,
        originalLanguage: mobileDetail.originalLanguage ?? item.originalLanguage ?? null,
        status: mobileDetail.status ?? item.status ?? null,
        userRating: mobileDetail.userRating ?? item.userRating ?? null,
        communityRating: mobileDetail.communityRating ?? trustedCommunityRating(item),
        externalRatings: mobileDetail.externalRatings ?? [],
        pendingExternalRatingSources: mobileDetail.pendingExternalRatingSources ?? [],
        progressStatus: mobileDetail.progressStatus ?? null,
        watched: Boolean(mobileDetail.watched ?? mobileDetail.progressStatus === "completed"),
        lastWatchedAt: mobileDetail.lastWatchedAt ?? null,
        favorite: Boolean(mobileDetail.favorite),
        lists: (mobileDetail.lists ?? []).map((list: any) => ({
          id: list.id,
          name: list.name,
          description: list.description ?? null,
          visibility: list.visibility ?? null,
          count: list.count ?? 0,
          posters: list.posters ?? [],
          contains: Boolean(list.contains)
        })),
        cast: (mobileDetail.cast ?? []).slice(0, 18),
        crew: mobileDetail.crew ?? [],
        companies: mobileDetail.companies ?? [],
        videos: mobileDetail.videos ?? [],
        images: mobileDetail.images ?? [],
        seasons: (mobileDetail.seasons ?? []).map((season: any) => ({
          id: season.id,
          seasonNumber: Number(season.seasonNumber ?? season.season_number ?? 0),
          name: season.name ?? `Season ${season.seasonNumber ?? season.season_number ?? ""}`.trim(),
          overview: season.overview ?? null,
          posterPath: season.posterPath ?? season.poster_path ?? null,
          airDate: season.airDate ?? season.air_date ?? null,
          episodeCount: season.episodeCount ?? season.episode_count ?? null
        })).filter((season: DetailSeason) => season.seasonNumber > 0),
        reviews: mobileDetail.reviews ?? [],
        myReview: mobileDetail.myReview ?? null,
        collectionName: mobileDetail.collectionName ?? item.collectionName ?? null,
        collection: mobileDetail.collection ?? [],
        recommendations: mobileDetail.recommendations ?? []
      };
      setDetail(next);
      return next;
    };
    const cached = await AsyncStorage.getItem(detailCacheKey).catch(() => null);
    let hasCachedDetail = false;
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { detail?: any; savedAt?: number };
        if (parsed.detail) {
          hasCachedDetail = true;
          applyMobileDetail(parsed.detail);
          if (parsed.detail.completeness === "full" && Date.now() - (parsed.savedAt ?? 0) < 300000) {
            setDetailLoading(false);
            return;
          }
        }
      } catch { /* Ignore stale detail cache. */ }
    }
    const mobileDetail = await fetchMobileTitle(item.kind, item.id, session?.access_token, "full").catch(() => null);
    if (mobileDetail) {
      applyMobileDetail(mobileDetail);
      await AsyncStorage.setItem(detailCacheKey, JSON.stringify({ detail: mobileDetail, savedAt: Date.now() })).catch(() => undefined);
      setDetailLoading(false);
      return;
    }
    if (hasCachedDetail) {
      setDetailLoading(false);
      return;
    }
    const [mediaResult, websiteMetadata] = await Promise.all([
      supabase ? supabase.from("media").select("*").eq("tmdb_id", item.id).eq("kind", item.kind).maybeSingle() : Promise.resolve({ data: null }),
      fetchWebsiteTitleMetadata(item.kind, item.id).catch(() => ({ overview: "", ratings: [], collectionTitle: undefined, collectionItems: [], recommendations: [] }))
    ]);
    const websiteOverview = websiteMetadata.overview && !websiteMetadata.overview.toLowerCase().includes("no overview has been published") ? websiteMetadata.overview : "";
    const externalRatings = websiteMetadata.ratings;
    const media = mediaResult.data;
    if (!media) {
      setDetail({ dbId: null, overview: websiteOverview || item.overview || null, tagline: null, releaseDate: item.releaseDate ?? null, endDate: item.endDate ?? null, genres: item.genres ?? [], voteAverage: item.voteAverage ?? null, runtime: null, originalLanguage: item.originalLanguage ?? null, status: item.status ?? null, userRating: item.userRating ?? null, communityRating: trustedCommunityRating(item), externalRatings, pendingExternalRatingSources: [], progressStatus: null, watched: false, favorite: false, lists: [], cast: [], crew: [], companies: [], videos: [], images: [], seasons: [], reviews: [], myReview: null, collectionName: item.collectionName ?? null, collection: [], recommendations: [] });
      setDetailLoading(false);
      return;
    }
    const client = supabase!;
    const mediaId = Number(media.id);
    const raw = media.raw ?? {};
    const resolvedOverview = media.overview || raw.overview || websiteOverview || item.overview || null;
    const collectionId = media.collection_tmdb_id ?? raw.belongs_to_collection?.id ?? item.collectionTmdbId ?? null;
    const reviewSelect = "id,title,body,created_at,updated_at,user_id,rating_id,contains_spoilers,media(id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,runtime,genres,original_language,origin_countries,collection_tmdb_id,collection_name,collection_poster_path),ratings(score)";
    const [ratings, reviews, myReviewResult, progress, userRating, favorite, lists, contains, seasonRows, collectionRows] = await Promise.all([
      client.from("ratings").select("score").eq("media_id", mediaId),
      client.from("reviews").select(reviewSelect).eq("media_id", mediaId).order("created_at", { ascending: false }).limit(8),
      session?.user.id ? client.from("reviews").select(reviewSelect).eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle() : Promise.resolve({ data: null }),
      session?.user.id ? client.from("progress").select("status").eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle() : Promise.resolve({ data: null }),
      session?.user.id ? client.from("ratings").select("score").eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle() : Promise.resolve({ data: null }),
      session?.user.id ? client.from("favorites").select("media_id").eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle() : Promise.resolve({ data: null }),
      session?.user.id ? loadUserLists(session.user.id) : Promise.resolve([]),
      session?.user.id ? client.from("list_items").select("list_id").eq("media_id", mediaId) : Promise.resolve({ data: [] }),
      item.kind === "show" ? client.from("seasons").select("id,season_number,name,overview,poster_path,air_date,episode_count").eq("media_id", mediaId).gt("season_number", 0).order("season_number") : Promise.resolve({ data: [] }),
      collectionId ? client.from("media").select("*").eq("kind", "movie").eq("collection_tmdb_id", collectionId).order("release_date", { ascending: true }) : Promise.resolve({ data: [] })
    ]);
    const containing = new Set((contains.data ?? []).map((row: any) => row.list_id));
    const communityRows = ratings.data ?? [];
    const rawImages = [...(raw.images?.backdrops ?? []), ...(raw.images?.posters ?? [])].slice(0, 12);
    const rawSeasons = Array.isArray(raw.seasons) ? raw.seasons : [];
    const seasons = ((seasonRows.data?.length ? seasonRows.data : rawSeasons) ?? [])
      .map((season: any) => ({
        id: season.id,
        seasonNumber: Number(season.season_number ?? season.seasonNumber ?? 0),
        name: season.name ?? `Season ${season.season_number ?? season.seasonNumber ?? ""}`.trim(),
        overview: season.overview ?? null,
        posterPath: season.poster_path ?? season.posterPath ?? null,
        airDate: season.air_date ?? season.airDate ?? null,
        episodeCount: season.episode_count ?? season.episodeCount ?? null
      }))
      .filter((season: DetailSeason) => season.seasonNumber > 0);
    const dbCollection = (collectionRows.data ?? [])
      .filter((row: any) => Number(row.tmdb_id) !== item.id)
      .map((row: any) => fromDbMedia(row))
      .slice(0, 24);
    const collection = dedupeMedia([...(websiteMetadata.collectionItems ?? []), ...dbCollection])
      .filter(part => !(part.kind === item.kind && part.id === item.id))
      .sort((a, b) => (a.releaseDate ?? "9999").localeCompare(b.releaseDate ?? "9999"));
    const collectionKeys = new Set(collection.map((part: MediaSummary) => `${part.kind}-${part.id}`));
    const recommendations = websiteMetadata.recommendations?.length ? websiteMetadata.recommendations : dedupeMedia((raw.recommendations?.results ?? [])
      .flatMap((candidate: any) => {
        const summary = fromTmdbRaw(candidate, candidate.media_type ? undefined : item.kind);
        return summary ? [summary] : [];
      }))
      .filter(candidate => candidate.id !== item.id && !collectionKeys.has(`${candidate.kind}-${candidate.id}`))
      .slice(0, 20);
    setDetail({
      dbId: mediaId,
      overview: resolvedOverview,
      tagline: media.tagline ?? null,
      releaseDate: media.release_date ?? item.releaseDate ?? null,
      endDate: media.end_date ?? item.endDate ?? null,
      genres: media.genres ?? item.genres ?? [],
      voteAverage: typeof media.vote_average === "number" ? media.vote_average : item.voteAverage ?? null,
      runtime: media.runtime ?? null,
      originalLanguage: media.original_language ?? null,
      status: media.status ?? item.status ?? null,
      userRating: typeof userRating.data?.score === "number" ? Number(userRating.data.score) : item.userRating ?? null,
      communityRating: communityRows.length ? communityRows.reduce((sum: number, row: any) => sum + Number(row.score), 0) / communityRows.length : trustedCommunityRating(item),
      externalRatings,
      pendingExternalRatingSources: [],
      progressStatus: progress.data?.status ?? null,
      watched: progress.data?.status === "completed",
      favorite: Boolean(favorite.data),
      lists: (lists as UserList[]).map(list => ({ ...list, contains: containing.has(list.id) })),
      cast: (media.credits?.cast ?? raw.credits?.cast ?? []).slice(0, 18),
      crew: media.credits?.crew ?? raw.credits?.crew ?? [],
      companies: media.companies ?? raw.production_companies ?? [],
      videos: media.videos ?? raw.videos?.results ?? [],
      images: rawImages,
      seasons,
      reviews: (reviews.data ?? []).flatMap(mapDetailReview),
      myReview: mapDetailReview(myReviewResult.data)[0] ?? null,
      collectionName: websiteMetadata.collectionTitle?.replace(/^More from\s+/i, "") || media.collection_name || raw.belongs_to_collection?.name || item.collectionName || null,
      collection,
      recommendations
    });
    setDetailLoading(false);
  }, [detailCacheKey, item, session?.access_token]);

  useEffect(() => {
    loadDetail().catch(() => {
      setDetailLoadError("Details did not load. Please try again.");
      setDetailLoading(false);
    });
  }, [loadDetail]);

  async function withBusy(work: () => Promise<void>, reason: ActionRefreshReason = "profile") {
    setBusy(true);
    try {
      await work();
      await AsyncStorage.removeItem(detailCacheKey).catch(() => undefined);
      await onChanged(reason);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(nextStatus: string) {
    if (!session?.user.id || !supabase || !detail?.dbId) return Alert.alert("Unavailable", "Open this title on the website once before editing it in the app.");
    await withBusy(async () => {
      await supabase!.from("progress").upsert({ user_id: session.user.id, media_id: detail.dbId, status: nextStatus, completed_at: nextStatus === "completed" ? new Date().toISOString() : null, updated_at: new Date().toISOString() });
      setDetail(current => current ? { ...current, progressStatus: nextStatus } : current);
    }, "profile");
  }

  async function saveUserRating(score: number | null) {
    if (!session?.user.id || !supabase || !detail?.dbId) return Alert.alert("Unavailable", "Open this title on the website once before editing it in the app.");
    const nextScore = score == null ? null : clampRating(score);
    await withBusy(async () => {
      if (nextScore == null) {
        await supabase!.from("ratings").delete().eq("user_id", session.user.id).eq("media_id", detail.dbId);
        await supabase!.from("reviews").update({ rating_id: null, updated_at: new Date().toISOString() }).eq("user_id", session.user.id).eq("media_id", detail.dbId);
        setDetail(current => current ? { ...current, userRating: null, myReview: current.myReview ? { ...current.myReview, ratingId: null, score: null } : current.myReview } : current);
        return;
      }
      const { data: existing } = await supabase!.from("ratings").select("id").eq("user_id", session.user.id).eq("media_id", detail.dbId).maybeSingle();
      const operation = existing?.id
        ? supabase!.from("ratings").update({ score: nextScore, updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
        : supabase!.from("ratings").insert({ user_id: session.user.id, media_id: detail.dbId, score: nextScore }).select("id").single();
      const { data: savedRating, error } = await operation;
      if (error) throw error;
      if (savedRating?.id) await supabase!.from("reviews").update({ rating_id: savedRating.id, updated_at: new Date().toISOString() }).eq("user_id", session.user.id).eq("media_id", detail.dbId);
      setDetail(current => current ? { ...current, userRating: nextScore, myReview: current.myReview ? { ...current.myReview, ratingId: savedRating?.id ?? current.myReview.ratingId, score: nextScore } : current.myReview } : current);
    }, "rating");
    setRatingSheetVisible(false);
  }

  async function saveReviewDraft(values: { score: number | null; title: string; body: string; containsSpoilers: boolean }) {
    if (!session?.user.id || !supabase || !detail?.dbId) return Alert.alert("Unavailable", "Open this title on the website once before editing it in the app.");
    if (!values.body.trim()) return Alert.alert("Review needed", "Write a few words before publishing your review.");
    const nextScore = values.score == null ? null : clampRating(values.score);
    await withBusy(async () => {
      let ratingId: string | null = null;
      if (nextScore != null) {
        const { data: existing } = await supabase!.from("ratings").select("id").eq("user_id", session.user.id).eq("media_id", detail.dbId).maybeSingle();
        const operation = existing?.id
          ? supabase!.from("ratings").update({ score: nextScore, updated_at: new Date().toISOString() }).eq("id", existing.id).select("id").single()
          : supabase!.from("ratings").insert({ user_id: session.user.id, media_id: detail.dbId, score: nextScore }).select("id").single();
        const { data: savedRating, error } = await operation;
        if (error) throw error;
        ratingId = savedRating?.id ?? null;
      }
      const payload = { title: values.title.trim() || null, body: values.body.trim(), contains_spoilers: values.containsSpoilers, rating_id: ratingId };
      const { data: existingReview } = await supabase!.from("reviews").select("id").eq("user_id", session.user.id).eq("media_id", detail.dbId).maybeSingle();
      const result = existingReview?.id
        ? await supabase!.from("reviews").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", existingReview.id)
        : await supabase!.from("reviews").insert({ user_id: session.user.id, media_id: detail.dbId, ...payload });
      if (result.error) throw result.error;
      setDetail(current => current ? { ...current, userRating: nextScore ?? current.userRating } : current);
      await loadDetail();
    });
    Alert.alert(detail.myReview ? "Review updated" : "Review published", "Your take is saved.");
  }

  async function saveWatchLog(values: WatchLogValues) {
    if (!session?.user.id || !supabase || !detail?.dbId) return Alert.alert("Unavailable", "Open this title on the website once before editing it in the app.");
    const watchedAt = resolveWatchLogDate(values, detail.releaseDate || item.releaseDate, detail.runtime ?? 0);
    await withBusy(async () => {
      const [watchResult, progressResult] = await Promise.all([
        supabase!.from("watch_events").insert({ user_id: session.user.id, media_id: detail.dbId, duration_minutes: detail.runtime ?? null, watched_at: watchedAt }),
        supabase!.from("progress").upsert({ user_id: session.user.id, media_id: detail.dbId, status: "completed", completed_at: watchedAt, updated_at: new Date().toISOString() })
      ]);
      if (watchResult.error) throw watchResult.error;
      if (progressResult.error) throw progressResult.error;
      setDetail(current => current ? { ...current, progressStatus: "completed", watched: true, lastWatchedAt: watchedAt } : current);
      Alert.alert("Watch added", "Your watch history was updated.");
    }, "watch");
  }

  async function toggleFavorite() {
    if (!session?.user.id || !supabase || !detail?.dbId) return Alert.alert("Unavailable", "Open this title on the website once before editing it in the app.");
    await withBusy(async () => {
      if (detail.favorite) await supabase!.from("favorites").delete().eq("user_id", session.user.id).eq("media_id", detail.dbId);
      else await supabase!.from("favorites").insert({ user_id: session.user.id, media_id: detail.dbId });
      setDetail(current => current ? { ...current, favorite: !current.favorite } : current);
    });
  }

  async function performToggleDetailList(list: ListMembership) {
    if (!supabase || !detail?.dbId) return Alert.alert("Unavailable", "Open this title on the website once before editing it in the app.");
    await withBusy(async () => {
      if (list.contains) await supabase!.from("list_items").delete().eq("list_id", list.id).eq("media_id", detail.dbId);
      else {
        const { data: existing } = await supabase!.from("list_items").select("id").eq("list_id", list.id).eq("media_id", detail.dbId).maybeSingle();
        if (!existing?.id) {
          const { count } = await supabase!.from("list_items").select("id", { count: "exact", head: true }).eq("list_id", list.id);
          await supabase!.from("list_items").insert({ list_id: list.id, media_id: detail.dbId, position: count ?? 0 });
        }
      }
      setDetail(current => current ? { ...current, lists: current.lists.map(candidate => candidate.id === list.id ? { ...candidate, contains: !candidate.contains } : candidate) } : current);
    }, "list");
  }

  async function toggleDetailList(list: ListMembership) {
    if (!list.contains) return performToggleDetailList(list);
    Alert.alert("Remove from list?", `Remove ${item.title} from ${list.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void performToggleDetailList(list) }
    ]);
  }

  if (detailLoading && !detail) {
    return (
      <View style={styles.detailLoadingScreen}>
        {backdrop ? <RemoteImage uri={backdrop} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.detailShadeV2} />
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}><Ionicons name="chevron-back" size={22} color={colors.text} /><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.detailLoadingCard}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.detailLoadingTitle}>Loading full details</Text>
          <Text style={styles.detailLoadingText}>Getting ratings, description, lists and your status...</Text>
        </View>
      </View>
    );
  }

  if (detailLoadError && !detail) {
    return (
      <View style={styles.detailLoadingScreen}>
        {backdrop ? <RemoteImage uri={backdrop} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.detailShadeV2} />
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}><Ionicons name="chevron-back" size={22} color={colors.text} /><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.detailLoadingCard}>
          <Ionicons name="warning-outline" size={32} color={colors.accent} />
          <Text style={styles.detailLoadingTitle}>Details did not load</Text>
          <Text style={styles.detailLoadingText}>{detailLoadError}</Text>
          <Pressable onPress={() => loadDetail().catch(() => undefined)} style={styles.trailerButton}><Text style={styles.trailerButtonText}>Try again</Text></Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.detailHeroV2}>
        {backdrop ? <RemoteImage uri={backdrop} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.detailShadeV2} />
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}><Ionicons name="chevron-back" size={22} color={colors.text} /><Text style={styles.backText}>Back</Text></Pressable>
        <View style={styles.detailHeroCopyV2}>
          {poster ? <RemoteImage uri={poster} style={styles.detailPosterV2} resizeMode="cover" /> : null}
          <Text style={styles.detailKicker}>{item.kind === "show" ? "Television series" : "Film"}</Text>
          <Text style={styles.detailTitleV2}>{item.title}</Text>
          <Text style={styles.detailMeta}>{titleYear(detailYearItem)} · {detail?.runtime ? minutesToLabel(detail.runtime) : item.kind === "show" ? "Series" : "Film"} · {detail?.status ?? item.status ?? "Released"}</Text>
          <View style={styles.ratingSourceRow}>{ratingSources.map(source => <RatingSource key={`${source.label}-${source.value}`} label={source.label} value={source.value} loading={"loading" in source && Boolean(source.loading)} />)}</View>
          {detail?.tagline ? <Text style={styles.detailTagline}>"{detail.tagline}"</Text> : null}
          <Text style={styles.detailOverview}>{detailOverview}</Text>
          {trailer ? <Pressable style={styles.trailerButton} onPress={() => WebBrowser.openBrowserAsync(`https://www.youtube.com/watch?v=${trailer.key}`)}><Ionicons name="play" size={17} color={colors.text} /><Text style={styles.trailerButtonText}>View trailer</Text></Pressable> : null}
        </View>
      </View>
      <View style={styles.detailBody}>
        <View style={styles.titleActionDock}>
          <Text style={styles.actionLabelBig}>My status</Text>
          {detail?.lastWatchedAt ? <Text style={styles.lastWatchedText}>Last watched {formatLastWatched(detail.lastWatchedAt)}</Text> : null}
          <View style={styles.statusActions}>{[
            { value: "planned", label: detail?.progressStatus === "completed" ? "Plan rewatch" : "Plan", icon: "bookmark-outline" },
            { value: "watching", label: "Watching", icon: "eye-outline" },
            { value: "completed", label: detail?.watched ? "Watched" : "Mark watched", icon: "checkmark-circle-outline" },
            { value: "paused", label: "Paused", icon: "pause-circle-outline" },
            { value: "dropped", label: "Dropped", icon: "close-circle-outline" }
          ].map(action => <Pressable disabled={busy || (action.value === "completed" && Boolean(detail?.watched))} accessibilityState={{ selected: detail?.progressStatus === action.value }} key={action.value} onPress={() => action.value === "completed" ? setWatchSheetVisible(true) : setStatus(action.value)} style={[styles.detailStatusButton, detail?.progressStatus === action.value && styles.detailStatusButtonActive]}><Ionicons name={action.icon as keyof typeof Ionicons.glyphMap} size={17} color={detail?.progressStatus === action.value ? colors.accent : colors.muted} /><Text style={[styles.detailStatusText, detail?.progressStatus === action.value && styles.detailStatusTextActive]}>{action.label}</Text></Pressable>)}</View>
          <Pressable disabled={busy} onPress={() => setRatingSheetVisible(true)} style={styles.ratingAction}>
            <Ionicons name="speedometer-outline" size={24} color="#ffc24b" />
            <View style={styles.ratingActionCopy}>
              <Text style={styles.ratingActionLabel}>Your rating</Text>
              <Text style={styles.ratingActionValue}>{detail?.userRating != null ? `${detail.userRating.toFixed(1)}/10` : "Rate this title"}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
          <View style={styles.detailQuickActions}><Pressable disabled={busy} onPress={toggleFavorite} style={styles.quickAction}><Ionicons name={detail?.favorite ? "heart" : "heart-outline"} size={19} color={colors.text} /><Text style={styles.quickActionText}>{detail?.favorite ? "Favorited" : "Favorite"}</Text></Pressable><Pressable disabled={busy} onPress={() => session?.access_token ? onHide(item) : Alert.alert("Sign in needed", "Sign in before changing recommendations.")} style={styles.quickAction}><Ionicons name="ban-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Not interested</Text></Pressable><Pressable disabled={busy} onPress={() => setWatchSheetVisible(true)} style={styles.quickAction}><Ionicons name="calendar-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>{detail?.watched ? "Add another watch" : "First watch"}</Text></Pressable><Pressable onPress={() => sharePublicTitle(`/title/${item.kind}/${item.id}`, item.title, detailOverview)} style={styles.quickAction}><Ionicons name="share-social-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Share</Text></Pressable></View>
          {detail?.lists.length ? <View style={styles.detailLists}><Pressable disabled={busy} onPress={() => setListSheetVisible(true)} style={styles.addToListButton}><Ionicons name="list-outline" size={21} color={colors.text} /><Text style={styles.addToListText}>Add to list</Text><Ionicons name="chevron-up" size={18} color={colors.muted} /></Pressable></View> : null}
        </View>
        <RatingSheet visible={ratingSheetVisible} value={detail?.userRating ?? null} busy={busy} onClose={() => setRatingSheetVisible(false)} onSave={saveUserRating} />
        <WatchLogSheet visible={watchSheetVisible} title={item.title} releaseDate={detail?.releaseDate || item.releaseDate} runtime={detail?.runtime ?? null} busy={busy} watched={Boolean(detail?.watched)} onClose={() => setWatchSheetVisible(false)} onSave={saveWatchLog} />
        <DetailListSheet visible={listSheetVisible} lists={detail?.lists ?? []} busy={busy} onClose={() => setListSheetVisible(false)} onToggle={toggleDetailList} />
        <View style={styles.factGrid}><Fact label="Released" value={detail?.releaseDate || item.releaseDate || "TBA"} /><Fact label={director?.job ?? "Director"} value={director?.name ?? "TBA"} /><Fact label="Original language" value={(detail?.originalLanguage || item.originalLanguage || "Unknown").toUpperCase()} /><Fact label="Genres" value={detailGenres.map(genre => genre.name).join(", ") || "Unknown"} /></View>
        {item.kind === "show" && detail?.seasons.length ? <SeasonsSection seasons={detail.seasons} limited={isLimitedSeries({ status: detail.status ?? item.status }, detail.seasons)} onOpenSeason={onOpenSeason} onOpenAllSeasons={onOpenAllSeasons} /> : null}
        {detail?.images.length || trailer ? <TitleMediaPreview trailer={trailer} images={detail?.images ?? []} /> : null}
        {detail?.cast.length ? <CastSection cast={detail.cast} onOpen={onOpenEntity} /> : null}
        {detail?.companies.length ? <CompanySection companies={detail.companies} onOpen={onOpenEntity} /> : null}
        {session?.user.id && detail?.dbId ? <ReviewComposerPanel existingReview={detail.myReview} currentRating={detail.userRating} busy={busy} onSubmit={saveReviewDraft} /> : null}
        {detail ? <DetailReviewsSection reviews={detail.reviews} onOpen={onOpen} /> : null}
        {detail?.collection.length ? <DetailMediaSection kicker="Continue the collection" title={`More from ${(detail.collectionName ?? item.collectionName ?? "this franchise").replace(/ Collection$/i, "")}`} items={detail.collection} onOpen={onOpen} /> : null}
        {detail?.recommendations.length ? <DetailMediaSection kicker="If this stayed with you" title="More like this" items={detail.recommendations} onOpen={onOpen} /> : null}
      </View>
    </ScrollView>
  );
}

function DetailListSheet({ visible, lists, busy, onClose, onToggle }: { visible: boolean; lists: ListMembership[]; busy: boolean; onClose: () => void; onToggle: (list: ListMembership) => Promise<void> }) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!visible) setQuery("");
  }, [visible]);
  const filtered = lists.filter(list => list.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <View style={styles.listPickerSheet}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeaderRow}>
          <View>
            <Text style={styles.sheetTitleText}>Add to list</Text>
            <Text style={styles.sheetSubText}>{lists.length} custom lists</Text>
          </View>
          <Pressable onPress={onClose} style={styles.sheetCloseButton} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.listPickerSearch}>
          <Ionicons name="search" size={18} color={colors.muted} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Find a list" placeholderTextColor={colors.muted} style={styles.listPickerInput} />
        </View>
        <ScrollView style={styles.listPickerScroll} contentContainerStyle={styles.listPickerContent} keyboardShouldPersistTaps="handled">
          {filtered.map(list => (
            <Pressable
              disabled={busy}
              key={list.id}
              onPress={async () => {
                await onToggle(list);
              }}
              style={[styles.detailListSheetRow, list.contains && styles.detailListRowActive]}
            >
              <Text style={styles.detailListName}>{list.name}</Text>
              <Text style={[styles.detailListState, list.contains && styles.detailListStateActive]}>{list.contains ? "Remove" : "Add"}</Text>
            </Pressable>
          ))}
          {!filtered.length ? <Text style={styles.emptyMiniText}>No lists found.</Text> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function RatingSource({ label, value, loading = false }: { label: string; value: string; loading?: boolean }) {
  return <View style={[styles.ratingSource, loading && styles.ratingSourceLoading]}><Text style={styles.ratingSourceLabel}>{label}</Text><View style={styles.ratingSourceValueRow}>{loading ? <ActivityIndicator size="small" color={colors.accent} /> : null}<Text style={[styles.ratingSourceValue, loading && styles.ratingSourceValueLoading]}>{value}</Text></View></View>;
}

function mapDetailReview(review: any): ReviewItem[] {
  if (!review) return [];
  const mediaRow = firstRow(review.media);
  const rating = firstRow(review.ratings);
  if (!mediaRow) return [];
  const score = Number(rating?.score);
  return [{
    id: review.id,
    title: review.title || "Review",
    body: review.body ?? "",
    created_at: review.created_at,
    updated_at: review.updated_at,
    userId: review.user_id ?? null,
    ratingId: review.rating_id ?? null,
    containsSpoilers: Boolean(review.contains_spoilers),
    kind: mediaRow.kind,
    mediaTitle: mediaRow.title,
    artwork: mediaRow.backdrop_path ?? mediaRow.poster_path ?? null,
    score: Number.isFinite(score) ? score : null,
    item: fromDbMedia(mediaRow)
  }];
}

function mapTargetReview(review: any, item: MediaSummary, label: "season" | "episode"): ReviewItem[] {
  if (!review) return [];
  const rating = firstRow(review.ratings);
  const score = Number(rating?.score);
  return [{
    id: review.id,
    title: review.title || "Review",
    body: review.body ?? "",
    created_at: review.created_at,
    updated_at: review.updated_at,
    userId: review.user_id ?? null,
    ratingId: review.rating_id ?? null,
    containsSpoilers: Boolean(review.contains_spoilers),
    kind: item.kind,
    mediaTitle: `${item.title} ${label}`,
    artwork: item.backdropPath ?? item.posterPath ?? null,
    score: Number.isFinite(score) ? score : null,
    item
  }];
}

function SeasonsSection({ seasons, limited, onOpenSeason, onOpenAllSeasons }: { seasons: DetailSeason[]; limited: boolean; onOpenSeason: (season: DetailSeason) => void; onOpenAllSeasons: (seasons: DetailSeason[]) => void }) {
  return (
    <View style={styles.detailSection}>
      <SectionTitle kicker="The full story" title="Seasons & episodes" action="All episodes & ratings ->" onAction={() => onOpenAllSeasons(seasons)} />
      <View style={styles.seasonList}>
        {seasons.map(season => {
          const poster = tmdbImage(season.posterPath, "w342");
          return (
            <Pressable key={`${season.id ?? season.seasonNumber}`} style={styles.seasonCard} onPress={() => limited ? onOpenAllSeasons(seasons) : onOpenSeason(season)}>
              {poster ? <RemoteImage uri={poster} style={styles.seasonPoster} /> : <View style={styles.seasonPoster}><Ionicons name="albums-outline" size={20} color={colors.muted} /></View>}
              <View style={styles.seasonCopy}>
                <Text style={styles.seasonName} numberOfLines={1}>{limited ? "Limited Series" : season.name}</Text>
                <Text style={styles.seasonMeta}>{season.episodeCount ?? "?"} episodes · {season.airDate?.slice(0, 4) ?? "TBA"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function TitleMediaPreview({ trailer, images }: { trailer?: DetailVideo; images: DetailImage[] }) {
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const { width, height } = useWindowDimensions();
  const gallery = images.flatMap((image, index) => {
    const path = image.filePath ?? image.file_path ?? "";
    const uri = tmdbImage(path, "w780");
    return uri ? [{ key: `${path}-${index}`, uri }] : [];
  });
  const tileWidth = Math.max(130, (width - 72) * 0.48);
  const tileHeight = tileWidth / 1.35;
  const galleryRows = Math.ceil(gallery.length / 2);
  return (
    <View style={styles.detailSection}>
      <SectionTitle kicker="Watch & look closer" title="Trailer & gallery" />
      {trailer ? <Pressable onPress={() => WebBrowser.openBrowserAsync(`https://www.youtube.com/watch?v=${trailer.key}`)} style={styles.trailerPreview}><Ionicons name="play" size={36} color={colors.text} /><Text style={styles.trailerPreviewText}>Play trailer</Text><Text style={styles.trailerPreviewSub}>{trailer.name || "Watch on YouTube"}</Text></Pressable> : null}
      {gallery.length ? <View style={[styles.galleryGrid, { minHeight: galleryRows * tileHeight + Math.max(0, galleryRows - 1) * 14 + 36 }]}>{gallery.map((image, index) => <Pressable key={image.key} onPress={() => setGalleryIndex(index)} style={[styles.galleryTile, { height: tileHeight }]}><Image source={{ uri: image.uri }} style={styles.posterImage} blurRadius={8} /><View style={styles.galleryScrim} /><Ionicons name="eye-outline" size={20} color={colors.text} /><Text style={styles.galleryText}>Potential spoiler</Text><Text style={styles.gallerySub}>Tap to reveal</Text></Pressable>)}</View> : null}
      <Modal visible={galleryIndex !== null} transparent animationType="fade" onRequestClose={() => setGalleryIndex(null)}>
        <SafeAreaView style={styles.galleryModal}>
          <Pressable style={styles.galleryClose} onPress={() => setGalleryIndex(null)}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
          <FlatList
            data={gallery}
            keyExtractor={image => image.key}
            horizontal
            pagingEnabled
            initialScrollIndex={galleryIndex ?? 0}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onScrollToIndexFailed={() => undefined}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item: image }) => (
              <View style={[styles.gallerySlide, { width, height }]}>
                <Image source={{ uri: image.uri }} style={styles.gallerySlideImage} resizeMode="contain" />
              </View>
            )}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function CastSection({ cast, onOpen }: { cast: DetailPerson[]; onOpen: (entity: EntityTarget) => void }) {
  return <View style={styles.detailSection}><SectionTitle kicker="In front of the camera" title="Cast" /><View style={styles.castGrid}>{cast.map((person, index) => <Pressable disabled={!person.id} onPress={() => person.id && onOpen({ type: "person", id: person.id, name: person.name, subtitle: person.character, imagePath: person.profile_path ?? null })} key={`${person.id ?? person.name}-${index}`} style={styles.personCard}>{person.profile_path ? <RemoteImage uri={tmdbImage(person.profile_path, "w342")!} style={styles.personPhoto} /> : <View style={styles.personPhoto} />}<Text style={styles.personName} numberOfLines={1}>{person.name}</Text><Text style={styles.personRole} numberOfLines={1}>{person.character}</Text></Pressable>)}</View></View>;
}

function CompanySection({ companies, onOpen }: { companies: DetailCompany[]; onOpen: (entity: EntityTarget) => void }) {
  return <View style={styles.detailSection}><SectionTitle kicker="Behind the production" title="Studios & companies" /><View style={styles.companyGrid}>{companies.map((company, index) => <Pressable disabled={!company.id} onPress={() => company.id && onOpen({ type: "company", id: company.id, name: company.name, imagePath: company.logo_path ?? null })} key={`${company.id ?? company.name}-${index}`} style={styles.companyCard}><View style={styles.companyLogo}>{company.logo_path ? <RemoteImage uri={tmdbImage(company.logo_path, "w342")!} style={styles.companyLogoImage} resizeMode="contain" /> : <Text style={styles.companyInitial}>{company.name.slice(0, 1)}</Text>}</View><Text style={styles.companyName} numberOfLines={2}>{company.name}</Text></Pressable>)}</View></View>;
}

function DetailReviewsSection({ reviews, onOpen }: { reviews: ReviewItem[]; onOpen: (item: MediaSummary) => void }) {
  return <View style={styles.detailSection}><SectionTitle kicker="From the community" title="Reviews" />{reviews.length ? <View style={styles.reviewList}>{reviews.map(review => <ReviewRow key={review.id} review={review} onOpen={onOpen} />)}</View> : <EmptyPanel title="No reviews yet" body="The opening line could be yours." />}</View>;
}

function RatingSheet({ visible, value, busy, onClose, onSave }: { visible: boolean; value: number | null; busy: boolean; onClose: () => void; onSave: (value: number | null) => Promise<void> }) {
  const [draft, setDraft] = useState(value ?? 5.5);
  useEffect(() => {
    if (visible) setDraft(value ?? 5.5);
  }, [value, visible]);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalScrim} />
      <View style={styles.ratingSheet}>
        <View style={styles.grabber} />
        <View style={styles.actionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.actionTitle}>Your rating</Text>
            <Text style={styles.actionSub}>Choose the score shown in your title controls.</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={20} color={colors.text} /></Pressable>
        </View>
        <ScoreControl value={draft} onChange={setDraft} />
        <View style={styles.ratingSheetActions}>
          <Pressable disabled={busy} onPress={() => onSave(null)} style={styles.ratingGhostButton}><Text style={styles.ratingGhostText}>Clear rating</Text></Pressable>
          <Pressable disabled={busy} onPress={() => onSave(draft)} style={styles.ratingSaveButton}><Text style={styles.ratingSaveText}>{busy ? "Saving..." : "Save rating"}</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

function WatchLogSheet({ visible, title, releaseDate, runtime, busy, watched, onClose, onSave }: { visible: boolean; title: string; releaseDate?: string | null; runtime?: number | null; busy: boolean; watched?: boolean; onClose: () => void; onSave: (values: WatchLogValues) => Promise<void> }) {
  const now = new Date();
  const [mode, setMode] = useState<WatchDateMode>("now");
  const [date, setDate] = useState(localDateKey(now));
  const [time, setTime] = useState(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
  const [timePoint, setTimePoint] = useState<WatchTimePoint>("end");

  useEffect(() => {
    if (!visible) return;
    const fresh = new Date();
    setMode("now");
    setDate(localDateKey(fresh));
    setTime(`${String(fresh.getHours()).padStart(2, "0")}:${String(fresh.getMinutes()).padStart(2, "0")}`);
    setTimePoint("end");
  }, [visible]);

  async function submit(nextMode = mode) {
    try {
      await onSave({ mode: nextMode, date, time, timePoint });
      onClose();
    } catch (error) {
      Alert.alert("Could not add watch", error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={16} style={styles.modalKeyboardAvoider}>
      <View style={styles.watchLogSheet}>
        <View style={styles.grabber} />
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.watchLogScrollContent}>
          <View style={styles.actionHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>{watched ? "Add another watch" : "Mark watched"}</Text>
              <Text style={styles.actionSub} numberOfLines={1}>{title}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}><Ionicons name="close" size={20} color={colors.text} /></Pressable>
          </View>
          <View style={styles.watchQuickGrid}>
            <Pressable disabled={busy} onPress={() => submit("now")} style={styles.watchQuickButton}><Ionicons name="time-outline" size={21} color={colors.accent} /><Text style={styles.watchQuickTitle}>Right now</Text><Text style={styles.watchQuickSub}>Use current time</Text></Pressable>
            <Pressable disabled={busy || !releaseDate} onPress={() => releaseDate && submit("release")} style={[styles.watchQuickButton, !releaseDate && styles.disabledButton]}><Ionicons name="calendar-outline" size={21} color={colors.accent} /><Text style={styles.watchQuickTitle}>Release date</Text><Text style={styles.watchQuickSub}>{releaseDate ?? "Unknown"}</Text></Pressable>
            <Pressable disabled={busy} onPress={() => submit("unknown")} style={styles.watchQuickButton}><Ionicons name="help-circle-outline" size={21} color={colors.accent} /><Text style={styles.watchQuickTitle}>Date unknown</Text><Text style={styles.watchQuickSub}>No calendar entry</Text></Pressable>
          </View>
          <View style={styles.watchCustomBox}>
            <Text style={styles.actionSectionLabel}>Custom date and time</Text>
            <View style={styles.watchInputsRow}>
              <TextInput value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={[styles.settingsInput, styles.watchInput]} />
              <TextInput value={time} onChangeText={setTime} placeholder="HH:mm" placeholderTextColor={colors.muted} style={[styles.settingsInput, styles.watchTimeInput]} />
            </View>
            <View style={styles.timePointRow}>
              {(["end", "start"] as WatchTimePoint[]).map(value => <Pressable key={value} onPress={() => setTimePoint(value)} style={[styles.timePointButton, timePoint === value && styles.timePointButtonActive]}><Text style={[styles.timePointText, timePoint === value && styles.timePointTextActive]}>{value === "end" ? "End time" : "Start time"}</Text></Pressable>)}
            </View>
            {timePoint === "start" && runtime ? <Text style={styles.watchHint}>The app will add {minutesToLabel(runtime)} and store the finished-at time, just like the website.</Text> : null}
            <Pressable disabled={busy} onPress={() => submit("custom")} style={styles.settingsSave}>{busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.settingsSaveText}>Save watch</Text>}</Pressable>
          </View>
        </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ReviewComposerPanel({ existingReview, currentRating, busy, onSubmit }: { existingReview: ReviewItem | null; currentRating: number | null; busy: boolean; onSubmit: (values: { score: number | null; title: string; body: string; containsSpoilers: boolean }) => Promise<void> }) {
  const [score, setScore] = useState<number | null>(existingReview?.score ?? currentRating ?? null);
  const [title, setTitle] = useState(existingReview?.title === "Review" ? "" : existingReview?.title ?? "");
  const [body, setBody] = useState(existingReview?.body ?? "");
  const [containsSpoilers, setContainsSpoilers] = useState(Boolean(existingReview?.containsSpoilers));

  useEffect(() => {
    setScore(existingReview?.score ?? currentRating ?? null);
    setTitle(existingReview?.title === "Review" ? "" : existingReview?.title ?? "");
    setBody(existingReview?.body ?? "");
    setContainsSpoilers(Boolean(existingReview?.containsSpoilers));
  }, [currentRating, existingReview?.body, existingReview?.containsSpoilers, existingReview?.id, existingReview?.score, existingReview?.title]);

  async function submit() {
    try {
      await onSubmit({ score, title, body, containsSpoilers });
    } catch (error) {
      Alert.alert("Could not save review", error instanceof Error ? error.message : "Try again in a moment.");
    }
  }

  return (
    <View style={styles.reviewComposerSection}>
      <SectionTitle kicker="Your take" title={existingReview ? "Edit your review" : "Write a review"} />
      <View style={styles.reviewComposerPanel}>
        <View style={styles.reviewComposerTop}>
          <View>
            <Text style={styles.ratingActionLabel}>Your score</Text>
            <Text style={styles.reviewComposerScore}>{score != null ? `${score.toFixed(1)}/10` : "Review without a rating"}</Text>
          </View>
          <Pressable onPress={() => setScore(null)}><Text style={styles.clearRatingText}>Clear rating</Text></Pressable>
        </View>
        <ScoreControl value={score ?? 5.5} onChange={setScore} />
        <TextInput value={title} onChangeText={setTitle} maxLength={120} placeholder="Give your review a title (optional)" placeholderTextColor={colors.muted} style={styles.reviewTitleInput} />
        <TextInput value={body} onChangeText={setBody} maxLength={10000} multiline placeholder="What worked, what didn't, and what stayed with you?" placeholderTextColor={colors.muted} style={[styles.reviewTitleInput, styles.reviewBodyInput]} textAlignVertical="top" />
        <View style={styles.reviewComposerFooter}>
          <View style={styles.spoilerCopy}>
            <Ionicons name="eye-off-outline" size={18} color={colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={styles.spoilerTitle}>Contains spoilers</Text>
              <Text style={styles.spoilerBody}>Hide the text until readers choose to reveal it.</Text>
            </View>
            <Switch value={containsSpoilers} onValueChange={setContainsSpoilers} thumbColor={containsSpoilers ? colors.accent : colors.muted} trackColor={{ false: colors.panel2, true: colors.accentSoft }} />
          </View>
          <Pressable disabled={busy} onPress={submit} style={styles.publishReviewButton}><Ionicons name="paper-plane-outline" size={17} color={colors.text} /><Text style={styles.publishReviewText}>{busy ? "Saving..." : existingReview ? "Update review" : "Publish review"}</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

function ScoreControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const decrease = () => onChange(clampRating(value - 0.1));
  const increase = () => onChange(clampRating(value + 0.1));
  return (
    <View style={styles.scoreControl}>
      <Pressable onPress={decrease} style={styles.scoreStepButton}><Ionicons name="remove" size={18} color={colors.text} /></Pressable>
      <TextInput
        value={value.toFixed(1)}
        onChangeText={text => {
          const parsed = Number(text.replace(",", "."));
          if (Number.isFinite(parsed)) onChange(clampRating(parsed));
        }}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={styles.scoreInput}
      />
      <Pressable onPress={increase} style={styles.scoreStepButton}><Ionicons name="add" size={18} color={colors.text} /></Pressable>
    </View>
  );
}

function clampRating(value: number) {
  return Math.max(1, Math.min(10, Math.round(value * 10) / 10));
}

function resolveWatchLogDate(values: WatchLogValues, releaseDate?: string | null, runtimeMinutes = 0) {
  if (values.mode === "unknown") return null;
  if (values.mode === "now") return new Date().toISOString();
  const sourceDate = values.mode === "release" ? releaseDate : values.date;
  if (!sourceDate) throw new Error(values.mode === "release" ? "This title has no known release date." : "Choose a watch date.");
  const sourceTime = values.mode === "custom" ? values.time || "12:00" : "12:00";
  const value = new Date(`${sourceDate}T${sourceTime}:00`);
  if (Number.isNaN(value.getTime())) throw new Error("Choose a valid watch date.");
  const completedAt = values.timePoint === "start" && runtimeMinutes > 0 ? new Date(value.getTime() + runtimeMinutes * 60_000) : value;
  const dateToValidate = values.timePoint === "start" ? value : completedAt;
  const shouldRejectFuture = values.mode !== "custom";
  if (shouldRejectFuture && dateToValidate.getTime() > Date.now() + 60_000) throw new Error("Choose a watch date that is not in the future.");
  return completedAt.toISOString();
}

function DetailMediaSection({ kicker, title, items, onOpen }: { kicker: string; title: string; items: MediaSummary[]; onOpen: (item: MediaSummary) => void }) {
  return <View style={styles.detailSection}><SectionTitle kicker={kicker} title={title} /><CardGrid items={items} onOpen={onOpen} onMenu={() => undefined} /></View>;
}

function DetailScreen({ item, token, onBack, onHide }: { item: MediaSummary; token?: string; onBack: () => void; onHide: (item: MediaSummary) => void }) {
  const backdrop = tmdbImage(item.backdropPath || item.posterPath, "w780");
  const poster = tmdbImage(item.posterPath, "w500");
  const detailMeta = [titleYear(item), communityRatingLabel(item, " MovieTracker")].filter(Boolean).join(" - ");

  return (
    <ScrollView contentContainerStyle={styles.detailContent}>
      <View style={styles.detailHero}>
        {backdrop ? <RemoteImage uri={backdrop} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        <View style={styles.detailShade} />
        <Pressable onPress={onBack} style={styles.backButton} hitSlop={10}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <View style={styles.detailCopy}>
          {poster ? <RemoteImage uri={poster} style={styles.detailPoster} resizeMode="cover" /> : null}
          <View style={styles.detailText}>
            <Text style={styles.detailKicker}>{item.kind === "show" ? "Series" : "Film"}</Text>
            <Text style={styles.detailTitle} numberOfLines={3}>{item.title}</Text>
            <Text style={styles.detailMeta}>{detailMeta}</Text>
          </View>
        </View>
      </View>
      <View style={styles.detailBody}>
        <Text style={styles.detailOverview}>{item.overview || "No overview has been published yet."}</Text>
        <View style={styles.detailActionGrid}>
          <DetailAction icon="bookmark-outline" label="Watchlist" />
          <DetailAction icon="checkmark-circle-outline" label="Watched" />
          <DetailAction icon="heart-outline" label="Favorite" />
          <DetailAction icon="list-outline" label="List" />
        </View>
        <Pressable
          style={styles.detailDanger}
          onPress={() => {
            if (!token) return Alert.alert("Sign in needed", "Sign in before changing recommendations.");
            Alert.alert("Hide this title?", `${item.title} will stop appearing in your recommendations.`, [
              { text: "Cancel", style: "cancel" },
              { text: "Hide", style: "destructive", onPress: () => onHide(item) }
            ]);
          }}
        >
          <Ionicons name="ban-outline" size={20} color={colors.danger} />
          <Text style={styles.detailDangerText}>Not interested</Text>
        </Pressable>
        <View style={styles.factGrid}>
          <Fact label="Released" value={item.releaseDate || "TBA"} />
          <Fact label="Type" value={item.kind === "show" ? "Series" : "Film"} />
          <Fact label="Genres" value={item.genres?.map(genre => genre.name).join(", ") || "Unknown"} />
        </View>
      </View>
    </ScrollView>
  );
}

function DetailAction({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.detailAction}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={styles.detailActionText}>{label}</Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function SettingsScreen({ session, profile, tab, onTab, onBack, onSignOut, onSaved }: { session: Session; profile: Profile | null; tab: SettingsTab; onTab: (tab: SettingsTab) => void; onBack: () => void; onSignOut: () => void; onSaved: () => Promise<void> }) {
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
      scheduleEpisodeNotifications(session.user.id, session.access_token).catch(reason => reportError("notification-preference", reason));
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
      ].map(([key, label]) => <ToggleRow key={key} label={label} enabled={notificationPreferences[key] ?? false} onChange={enabled => void saveNotificationPreference(key, enabled)} />)}</View> : null}
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

function AuthPanel({ email, password, mode, busy, onEmail, onPassword, onMode, onSubmit, onGoogle }: { email: string; password: string; mode: "sign-in" | "sign-up"; busy: boolean; onEmail: (value: string) => void; onPassword: (value: string) => void; onMode: (value: "sign-in" | "sign-up") => void; onSubmit: () => void; onGoogle: () => void }) {
  return (
    <View style={styles.authPanel}>
      <Text style={styles.authTitle}>{mode === "sign-in" ? "Welcome back" : "Create your account"}</Text>
      <Text style={styles.authBody}>Use the same MovieTracker account as the website. Your library, favorites, ratings and recommendations will sync here.</Text>
      <Pressable disabled={busy} onPress={onGoogle} style={styles.googleButton}>
        <Text style={styles.googleButtonText}>Continue with Google</Text>
      </Pressable>
      <Text style={styles.authDivider}>or use email</Text>
      <TextInput value={email} onChangeText={onEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="Email" placeholderTextColor="#71777a" style={styles.authInput} />
      <TextInput value={password} onChangeText={onPassword} secureTextEntry placeholder="Password" placeholderTextColor="#71777a" style={styles.authInput} />
      <Pressable disabled={busy} onPress={onSubmit} style={[styles.authButton, busy && styles.disabledButton]}>
        {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.authButtonText}>{mode === "sign-in" ? "Sign in" : "Create account"}</Text>}
      </Pressable>
      <Pressable onPress={() => onMode(mode === "sign-in" ? "sign-up" : "sign-in")} style={styles.switchAuth}>
        <Text style={styles.switchAuthText}>{mode === "sign-in" ? "Need an account? Create one" : "Already have an account? Sign in"}</Text>
      </Pressable>
    </View>
  );
}

function ProgressSummary({ counts }: { counts: ProgressCounts }) {
  const stats = [
    { label: "Watchlist", value: counts.planned, icon: "bookmark-outline" as const },
    { label: "Watching", value: counts.watching + counts.paused, icon: "play-circle-outline" as const },
    { label: "Completed", value: counts.completed, icon: "checkmark-circle-outline" as const },
    { label: "Favorites", value: counts.favorites, icon: "heart-outline" as const }
  ];
  return (
    <View style={styles.statsGrid}>
      {stats.map(stat => (
        <View key={stat.label} style={styles.statCard}>
          <Ionicons name={stat.icon} size={22} color={colors.accent} />
          <Text style={styles.statValue}>{stat.value}</Text>
          <Text style={styles.statLabel}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

function EmptyPanel({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.emptyPanel}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {action ? (
        <Pressable onPress={onAction} style={styles.emptyAction}>
          <Text style={styles.emptyActionText}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function firstRow<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function viewingDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  if (date.getHours() < 3) date.setDate(date.getDate() - 1);
  return localDateKey(date);
}

function trustedCommunityRating(item: Pick<MediaSummary, "communityRating" | "communityRatingCount">) {
  return typeof item.communityRating === "number" && Boolean(item.communityRatingCount) ? item.communityRating : null;
}

function fromDbMedia(row: any, ratingByMedia?: Map<any, number>): MediaSummary {
  return {
    id: Number(row.tmdb_id),
    kind: row.kind,
    title: row.title,
    overview: row.overview ?? "",
    posterPath: row.poster_path ?? null,
    backdropPath: row.backdrop_path ?? null,
    releaseDate: row.release_date ?? null,
    endDate: row.end_date ?? null,
    status: row.status ?? null,
    voteAverage: Number(row.vote_average ?? 0),
    voteCount: Number(row.vote_count ?? 0),
    userRating: ratingByMedia?.get(row.id) ?? null,
    popularity: Number(row.popularity ?? 0),
    genres: row.genres ?? [],
    collectionTmdbId: row.collection_tmdb_id ?? row.raw?.belongs_to_collection?.id ?? null,
    collectionName: row.collection_name ?? row.raw?.belongs_to_collection?.name ?? null,
    originalLanguage: row.original_language ?? null,
    originCountries: row.origin_countries ?? [],
    companies: row.companies ?? row.raw?.production_companies ?? [],
    raw: row.raw ?? null
  };
}

function fromTmdbRaw(raw: any, forcedKind?: MediaKind): MediaSummary | null {
  if (!raw?.id) return null;
  const kind: MediaKind = forcedKind ?? (raw.media_type === "tv" || raw.name ? "show" : "movie");
  const genresFromIds = Array.isArray(raw.genre_ids) ? raw.genre_ids.map((id: number) => ({ id, name: String(id) })) : [];
  return {
    id: Number(raw.id),
    kind,
    title: raw.title ?? raw.name ?? "Untitled",
    overview: raw.overview ?? "",
    posterPath: raw.poster_path ?? null,
    backdropPath: raw.backdrop_path ?? null,
    releaseDate: raw.release_date ?? raw.first_air_date ?? null,
    endDate: raw.last_air_date ?? null,
    status: raw.status ?? null,
    voteAverage: Number(raw.vote_average ?? 0),
    voteCount: Number(raw.vote_count ?? 0),
    popularity: Number(raw.popularity ?? 0),
    genres: Array.isArray(raw.genres) ? raw.genres : genresFromIds,
    collectionTmdbId: raw.belongs_to_collection?.id ?? null,
    collectionName: raw.belongs_to_collection?.name ?? null,
    originalLanguage: raw.original_language ?? null,
    originCountries: raw.origin_country ?? (raw.production_countries ?? []).map((country: any) => country.iso_3166_1).filter(Boolean)
  };
}

function progressLabel(status: string | null | undefined) {
  if (status === "planned") return "Watchlist";
  if (status === "watching") return "Watching";
  if (status === "completed") return "Completed";
  if (status === "paused") return "Paused";
  if (status === "dropped") return "Dropped";
  return "Tracked";
}

function dedupeMedia(items: MediaSummary[]) {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.kind}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function enrichShowRuns(items: MediaSummary[], accessToken?: string, limit = 40) {
  const currentYear = new Date().getUTCFullYear();
  const needsRun = (item: MediaSummary) => {
    if (item.kind !== "show") return false;
    const status = item.status?.toLowerCase() ?? "";
    const ended = status.includes("ended") || status.includes("canceled") || status.includes("cancelled");
    const startYear = Number(item.releaseDate?.slice(0, 4));
    return !item.status || !item.releaseDate || (ended && !item.endDate) || Boolean(startYear && startYear < currentYear - 2 && !item.endDate);
  };
  const shows = [...new Map(items.filter(needsRun).map(item => [item.id, item])).values()].slice(0, Math.min(limit, 12));
  if (!shows.length) return items;
  const details = await Promise.allSettled(shows.map(item => fetchMobileTitle("show", item.id, accessToken).then(detail => ({ id: item.id, detail }))));
  const detailById = new Map(details.flatMap(result => result.status === "fulfilled" ? [[result.value.id, result.value.detail]] : []));
  return items.map(item => {
    const detail = detailById.get(item.id);
    return item.kind === "show" && detail ? { ...item, releaseDate: detail.releaseDate ?? item.releaseDate, endDate: detail.endDate ?? item.endDate, status: detail.status ?? item.status } : item;
  });
}

async function loadUserLists(userId: string): Promise<UserList[]> {
  const client = supabase;
  if (!client) return [];
  const { data: rawLists, error: listError } = await client.from("lists").select("id,name,description,visibility,cover_url,featured_media_id").eq("user_id", userId).order("name", { ascending: true });
  if (listError) throw listError;
  const lists = rawLists ?? [];
  if (!lists.length) return [];
  const featuredIds = lists.flatMap((list: any) => list.featured_media_id ? [list.featured_media_id] : []);
  const [featuredResult, itemResult] = await Promise.all([
    featuredIds.length ? client.from("media").select("id,poster_path,backdrop_path,title").in("id", featuredIds) : Promise.resolve({ data: [] }),
    client.from("list_items").select("list_id,position,media(id,poster_path,backdrop_path,title)").in("list_id", lists.map((list: any) => list.id)).order("position", { ascending: true })
  ]);
  if ((featuredResult as any).error) throw (featuredResult as any).error;
  if ((itemResult as any).error) throw (itemResult as any).error;
  const featuredRows = featuredResult.data ?? [];
  const featuredById = new Map((featuredRows ?? []).map((media: any) => [media.id, media]));
  const itemsByList = new Map<string, any[]>();
  for (const item of itemResult.data ?? []) itemsByList.set(item.list_id, [...(itemsByList.get(item.list_id) ?? []), item]);
  return lists.map((list: any) => {
    const listItems = itemsByList.get(list.id) ?? [];
    const featured = list.featured_media_id ? featuredById.get(list.featured_media_id) : null;
    const featuredPoster = tmdbImage(featured?.backdrop_path || featured?.poster_path, "w500");
    const posters = listItems.slice(0, 4).flatMap((item: any) => {
      const media = firstRow(item.media);
      const poster = tmdbImage(media?.poster_path || media?.backdrop_path, "w342");
      return poster ? [poster] : [];
    });
    return { id: list.id, name: list.name, description: list.description, visibility: list.visibility, cover_url: list.cover_url, count: listItems.length, posters: list.cover_url ? [list.cover_url] : featuredPoster ? [featuredPoster, ...posters].slice(0, 4) : posters };
  });
}

async function scheduleEpisodeNotifications(userId: string, accessToken?: string) {
  const client = supabase;
  if (!client || !Device.isDevice) return;
  const preferenceResult = await client.from("notification_preferences").select("release_email").eq("user_id", userId).maybeSingle();
  if (preferenceResult.error) throw preferenceResult.error;
  if (preferenceResult.data?.release_email === false) {
    const previousIds = JSON.parse(await AsyncStorage.getItem(episodeNotificationIdsKey).catch(() => null) || "[]") as string[];
    await Promise.allSettled(previousIds.map(id => Notifications.cancelScheduledNotificationAsync(id)));
    await AsyncStorage.setItem(episodeNotificationIdsKey, "[]");
    return;
  }
  const currentPermissions = await Notifications.getPermissionsAsync();
  const permissions = currentPermissions.status === "granted" ? currentPermissions : await Notifications.requestPermissionsAsync();
  if (permissions.status !== "granted") return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("episode-releases", {
      name: "New episode releases",
      description: "Alerts when a tracked show releases a new episode.",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 150, 250],
      lightColor: "#ff563d"
    });
  }

  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (projectId) {
    try {
      const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (token) await client.from("mobile_push_tokens").upsert({ user_id: userId, expo_push_token: token, platform: Platform.OS, updated_at: new Date().toISOString() }, { onConflict: "expo_push_token" });
    } catch (error) {
      console.warn("Remote notification registration unavailable; local release alerts remain enabled.", error);
    }
  }

  const [progressResult, favoriteResult, listResult, remoteSchedule] = await Promise.all([
    client.from("progress").select("media_id").eq("user_id", userId),
    client.from("favorites").select("media_id").eq("user_id", userId),
    client.from("list_items").select("media_id,lists!inner(user_id)").eq("lists.user_id", userId),
    accessToken ? fetchEpisodeNotificationSchedule(accessToken).catch(() => ({ events: [] })) : Promise.resolve({ events: [] })
  ]);
  if (progressResult.error) throw progressResult.error;
  if (favoriteResult.error) throw favoriteResult.error;
  if (listResult.error) throw listResult.error;
  const mediaIds = [...new Set([...(progressResult.data ?? []), ...(favoriteResult.data ?? []), ...(listResult.data ?? [])].map((row: any) => Number(row.media_id)).filter(Number.isFinite))];
  const previousIds = JSON.parse(await AsyncStorage.getItem(episodeNotificationIdsKey).catch(() => null) || "[]") as string[];
  await Promise.allSettled(previousIds.map(id => Notifications.cancelScheduledNotificationAsync(id)));
  if (!mediaIds.length && !remoteSchedule.events.length) {
    await AsyncStorage.setItem(episodeNotificationIdsKey, "[]");
    return;
  }
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 60);
  const episodeResult = mediaIds.length ? await client
    .from("episodes")
    .select("id,name,episode_number,air_date,still_path,seasons!inner(season_number,media_id,media(title,tmdb_id,poster_path,backdrop_path))")
    .in("seasons.media_id", mediaIds)
    .gte("air_date", localDateKey(start))
    .lte("air_date", localDateKey(end))
    .order("air_date", { ascending: true })
    .limit(50) : { data: [], error: null };
  const { data: episodes, error } = episodeResult;
  if (error) throw error;

  const scheduledIds: string[] = [];
  const scheduledKeys = new Set<string>();
  const today = localDateKey();
  async function scheduleRelease(release: { key: string; airDate: string; title: string; body: string; href: string; image: string | null; episodeId?: number | string }) {
    if (scheduledKeys.has(release.key)) return;
    let date = new Date(`${release.airDate}T09:00:00`);
    if (date.getTime() <= Date.now() && release.airDate === today) date = new Date(Date.now() + 10_000);
    if (date.getTime() <= Date.now()) return;
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {
        title: release.title,
        body: release.body,
        sound: "default",
        color: "#ff563d",
        data: { href: release.href, image: release.image, releaseKey: release.key, episodeId: release.episodeId },
        ...(Platform.OS === "ios" && release.image ? { attachments: [{ identifier: `episode-${release.episodeId ?? release.key}`, url: release.image, type: "public.image" }] } : {})
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: "episode-releases" }
    });
    scheduledKeys.add(release.key);
    scheduledIds.push(identifier);
  }
  for (const event of remoteSchedule.events) {
    await scheduleRelease({ key: event.releaseKey, airDate: event.airDate, title: event.title, body: event.body, href: event.href, image: event.image });
  }
  for (const episode of episodes ?? []) {
    const season = firstRow((episode as any).seasons);
    const media = firstRow(season?.media);
    if (!episode.air_date || !media?.tmdb_id) continue;
    const image = tmdbImage(episode.still_path ?? media.backdrop_path ?? media.poster_path, "w780");
    const href = `/title/show/${media.tmdb_id}/season/${season.season_number}/episode/${episode.episode_number}`;
    await scheduleRelease({
      key: `${media.tmdb_id}:${season.season_number}:${episode.episode_number}:${episode.air_date}`,
      airDate: episode.air_date,
      title: `New episode of ${media.title}`,
      body: `S${season.season_number} E${episode.episode_number}${episode.name ? ` - ${episode.name}` : ""} releases today.`,
      href,
      image,
      episodeId: episode.id
    });
  }
  await AsyncStorage.setItem(episodeNotificationIdsKey, JSON.stringify(scheduledIds));
}

async function loadListFeed(listId: string, userId?: string | null): Promise<FeedResult> {
  const client = supabase;
  if (!client) return emptyFeed;
  const listFeedMediaSelect = "id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,genres,original_language,origin_countries,collection_tmdb_id,collection_name,collection_poster_path";
  let result: any = await client
    .from("list_items")
    .select(`position,added_at,franchise_group,media(${listFeedMediaSelect})`)
    .eq("list_id", listId)
    .order("position", { ascending: true });
  if (result.error) {
    result = await client
      .from("list_items")
      .select(`position,added_at,media(${listFeedMediaSelect})`)
      .eq("list_id", listId)
      .order("position", { ascending: true });
  }
  const { data, error } = result;
  if (error) throw error;
  const mediaRows = (data ?? []).flatMap((row: any) => {
    const media = firstRow(row.media);
    return media?.id ? [media] : [];
  });
  const mediaIds = mediaRows.map((media: any) => media.id);
  const { data: ratingRows } = userId && mediaIds.length ? await client.from("ratings").select("media_id,score").eq("user_id", userId).in("media_id", mediaIds) : { data: [] as any[] };
  const ratingByMedia = new Map((ratingRows ?? []).map((row: any) => [row.media_id, Number(row.score)]));
  const items = (data ?? []).flatMap((row: any) => {
    const media = firstRow(row.media);
    if (!media) return [];
    const item = fromDbMedia(media, ratingByMedia);
    return [{ ...item, listMediaId: media.id, franchiseGroup: row.franchise_group ?? null, listAddedAt: row.added_at ?? null, listPosition: row.position ?? null }];
  });
  return { items: await enrichShowRuns(items) };
}

async function hiddenRecommendationKeys(client: NonNullable<typeof supabase>, userId: string, filters: RecommendationFilters) {
  const hidden = new Set<string>();
  const [progress, watched, listItems, planned, dismissals] = await Promise.all([
    filters.hideWatched ? client.from("progress").select("media(tmdb_id,kind)").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideWatched ? client.from("watch_events").select("media(tmdb_id,kind)").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("list_items").select("media(tmdb_id,kind),lists!inner(user_id)").eq("lists.user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("progress").select("media(tmdb_id,kind)").eq("user_id", userId).eq("status", "planned") : Promise.resolve({ data: [] }),
    client.from("recommendation_dismissals").select("media(tmdb_id,kind)").eq("user_id", userId)
  ]);
  [...(progress.data ?? []), ...(watched.data ?? []), ...(listItems.data ?? []), ...(planned.data ?? []), ...(dismissals.data ?? [])].forEach((row: any) => {
    const media = firstRow(row.media);
    if (media) hidden.add(`${media.kind}-${media.tmdb_id}`);
  });
  return hidden;
}

async function hiddenRecommendationMediaIds(client: NonNullable<typeof supabase>, userId: string, filters: RecommendationFilters) {
  const hidden = new Set<number>();
  const [progress, watched, listItems, planned, dismissals] = await Promise.all([
    filters.hideWatched ? client.from("progress").select("media_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideWatched ? client.from("watch_events").select("media_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("list_items").select("media_id,lists!inner(user_id)").eq("lists.user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("progress").select("media_id").eq("user_id", userId).eq("status", "planned") : Promise.resolve({ data: [] }),
    client.from("recommendation_dismissals").select("media_id").eq("user_id", userId)
  ]);
  [...(progress.data ?? []), ...(watched.data ?? []), ...(listItems.data ?? []), ...(planned.data ?? []), ...(dismissals.data ?? [])].forEach((row: any) => {
    if (typeof row.media_id === "number") hidden.add(row.media_id);
  });
  return hidden;
}

function passesRecommendationFilters(item: MediaSummary, filters: RecommendationFilters, hidden: Set<string>) {
  if (filters.kind !== "all" && item.kind !== filters.kind) return false;
  if (filters.genre) {
    const genreMatches = filters.genre === "christmas" ? isChristmasLike(item)
      : filters.genre === "superhero" ? isSuperheroLike(item)
      : filters.genre === "kdrama" ? isKDramaLike(item)
      : item.genres?.some(genre => String(genre.id) === filters.genre || genre.name.toLowerCase() === filters.genre.toLowerCase());
    if (!genreMatches) return false;
  }
  if (filters.country && !item.originCountries?.includes(filters.country)) return false;
  if (filters.year && item.releaseDate?.slice(0, 4) !== filters.year) return false;
  if (filters.excludeGenres.some(value => value === "christmas" ? isChristmasLike(item)
    : value === "superhero" ? isSuperheroLike(item)
    : value === "kdrama" ? isKDramaLike(item)
    : value === "anime" ? isAnimeLike(item)
    : item.genres?.some(genre => String(genre.id) === value || genre.name.toLowerCase().includes(value.toLowerCase())))) return false;
  if (hidden.has(`${item.kind}-${item.id}`)) return false;
  return true;
}

function tasteReason(item: MediaSummary, seed: MediaSummary | null) {
  if (seed?.title) return `Because you liked ${seed.title}`;
  const genre = item.genres?.[0]?.name;
  return genre ? `Personal ${genre.toLowerCase()} pick from your MovieTracker history` : "Personal pick from your MovieTracker history";
}

const genreSplitNames: Record<string, string[]> = {
  "Action & Adventure": ["Action", "Adventure"],
  "Sci-Fi & Fantasy": ["Science Fiction", "Fantasy"],
  "Science Fiction": ["Science Fiction"],
  "Sci-Fi": ["Science Fiction"]
};

function searchableMediaText(media: any) {
  return [
    media?.title,
    media?.name,
    media?.original_title,
    media?.overview,
    media?.collection_name
  ].filter(Boolean).join(" ").toLowerCase();
}

function isAnimeLike(media: any) {
  const genresValue = Array.isArray(media?.genres) ? media.genres : [];
  const countries = Array.isArray(media?.originCountries) ? media.originCountries : Array.isArray(media?.origin_countries) ? media.origin_countries : [];
  return genresValue.some((genre: any) => Number(genre?.id) === 16) && ((media?.originalLanguage ?? media?.original_language) === "ja" || countries.includes("JP"));
}

function isKDramaLike(media: any) {
  const countries = Array.isArray(media?.originCountries) ? media.originCountries : Array.isArray(media?.origin_countries) ? media.origin_countries : [];
  return media?.kind === "show" && ((media?.originalLanguage ?? media?.original_language) === "ko" || countries.includes("KR"));
}

function isSuperheroLike(media: any) {
  return /\b(superhero|super hero|marvel|mcu|dc comics|dc universe|batman|superman|man of steel|spider[\s-]?man|ant[\s-]?man|avengers|x[\s-]?men|iron man|captain america|captain marvel|doctor strange|dr\. strange|wonder woman|aquaman|the flash|green lantern|green arrow|thor|hulk|justice league|guardians of the galaxy|venom|deadpool|wolverine|black panther|black adam|fantastic four|daredevil|punisher|shazam|suicide squad|harley quinn|catwoman|batgirl|blade|moon knight|ms\. marvel|scarlet witch|wanda|vision|loki|hawkeye|falcon|winter soldier|agents of s\.?h\.?i\.?e\.?l\.?d)\b/i.test(searchableMediaText(media));
}

function isHorrorLike(media: any) {
  const genresValue = Array.isArray(media?.genres) ? media.genres : [];
  if (genresValue.some((genre: any) => Number(genre?.id) === 27 || String(genre?.name ?? "").toLowerCase() === "horror")) return true;
  return /\b(horror|nightmare|nightmarish|haunted|ghost|demon|curse|cursed|slasher|zombie|vampire|possession|supernatural|terrifying|creature|monster|traps all those who enter|town they cannot escape|evil entity)\b/i.test(searchableMediaText(media));
}

function isThrillerLike(media: any) {
  const genresValue = Array.isArray(media?.genres) ? media.genres : [];
  if (genresValue.some((genre: any) => Number(genre?.id) === 53 || String(genre?.name ?? "").toLowerCase() === "thriller")) return true;
  return /\b(thriller|suspense|suspenseful|serial killer|kidnap|kidnapped|abduct|abducted|conspiracy|stalker|psychological|murder mystery|tense|paranoia|manhunt|hostage)\b/i.test(searchableMediaText(media));
}

function isChristmasLike(media: any) {
  const genresValue = Array.isArray(media?.genres) ? media.genres : [];
  if (genresValue.some((genre: any) => String(genre?.name ?? "").toLowerCase() === "christmas")) return true;
  return /\b(christmas|xmas|santa|holiday|holidays|yuletide|north pole|reindeer|mistletoe|noel)\b/i.test(searchableMediaText(media));
}

function normalizedGenreNames(media: any) {
  const names = new Set<string>();
  const anime = isAnimeLike(media);
  for (const genre of Array.isArray(media?.genres) ? media.genres : []) {
    const name = typeof genre === "string" ? genre : genre?.name;
    const id = typeof genre === "object" ? Number(genre?.id) : null;
    if (!name) continue;
    if (id === 16 && anime) {
      names.add("Anime");
      continue;
    }
    for (const split of genreSplitNames[name] ?? [name]) names.add(split);
  }
  if (isSuperheroLike(media)) names.add("Superhero");
  if (isHorrorLike(media)) names.add("Horror");
  if (isThrillerLike(media)) names.add("Thriller");
  if (isChristmasLike(media)) names.add("Christmas");
  return [...names];
}

async function loadRecommendationFallback(userId: string, filters: RecommendationFilters): Promise<FeedResult> {
  const client = supabase;
  if (!client) return emptyFeed;
  const [hidden, hiddenMediaIds] = await Promise.all([
    hiddenRecommendationKeys(client, userId, filters),
    hiddenRecommendationMediaIds(client, userId, filters)
  ]);
  const saved = await client
    .from("recommendations")
    .select("score,reasons,media_id,media(*)")
    .eq("user_id", userId)
    .is("dismissed_at", null)
    .order("score", { ascending: false })
    .limit(80);
  if (saved.error) throw saved.error;
  const items = (saved.data ?? []).flatMap((row: any) => {
    const media = firstRow(row.media);
    if (!media) return [];
    if (typeof row.media_id === "number" && hiddenMediaIds.has(row.media_id)) return [];
    const item = fromDbMedia(media);
    if (!passesRecommendationFilters(item, filters, hidden)) return [];
    const reasons = Array.isArray(row.reasons) ? row.reasons : [];
    return [{ ...item, reason: reasons[0] || "Personal pick from your MovieTracker history" }];
  });
  const personalized = dedupeMedia(items);
  if (personalized.length) return { items: personalized };
  return emptyFeed;
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string) {
  const [year, number] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, number - 1, 1));
  const end = new Date(Date.UTC(year, number, 1));
  return { start, end };
}

function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year, number - 1 + delta, 1)));
}

function calendarCells(month: string) {
  const { start } = monthBounds(month);
  const leading = (start.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = Array.from({ length: leading + days }, (_, index) => index < leading ? null : `${month}-${String(index - leading + 1).padStart(2, "0")}`);
  return { cells, label: start.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) };
}

function streaksFromDays(days: string[]) {
  let currentStreak = 0;
  let longestStreak = 0;
  let running = 0;
  let previousDay: number | null = null;
  for (const day of [...days].reverse()) {
    const value = new Date(`${day}T12:00:00Z`).getTime();
    running = previousDay !== null && value - previousDay === 86400000 ? running + 1 : 1;
    longestStreak = Math.max(longestStreak, running);
    previousDay = value;
  }
  if (days.length) {
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    for (const day of days) {
      const expected = cursor.toISOString().slice(0, 10);
      const yesterday = new Date(cursor.getTime() - 86400000).toISOString().slice(0, 10);
      if (day === expected || (currentStreak === 0 && day === yesterday)) {
        currentStreak++;
        cursor.setUTCDate(cursor.getUTCDate() - (day === expected ? 1 : 2));
      } else break;
    }
  }
  return { currentStreak, longestStreak };
}

function minutesToLabel(minutes?: number | null) {
  if (!minutes) return "Runtime TBA";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatShortDate(value: string) {
  if (!value) return "No date";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isEditedReview(review: Pick<ReviewItem, "created_at" | "updated_at">) {
  if (!review.updated_at) return false;
  return new Date(review.updated_at).getTime() - new Date(review.created_at).getTime() > 60_000;
}

function formatHistoryDay(value: string) {
  if (value === "unknown") return "Unknown";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

function formatHistoryMonth(value: string) {
  if (value === "unknown") return "Watched date not specified";
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function formatHistoryTime(value: string) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatLastWatched(value: string) {
  return new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function normalizeHistoryItemTime(item: HistoryItem): HistoryItem {
  if (!item.date) return { ...item, dateKey: "unknown", dateTitle: "Unknown date", dateSubtitle: "Watched date not specified", timeLabel: "No date" };
  const value = new Date(item.date);
  if (Number.isNaN(value.getTime())) return item;
  const dateKey = viewingDateKey(item.date);
  return { ...item, dateKey, dateTitle: formatHistoryDay(dateKey), dateSubtitle: formatHistoryMonth(dateKey), timeLabel: formatHistoryTime(item.date) };
}

function normalizeProfileDataTimes(data: ProfileData): ProfileData {
  return { ...data, history: (data.history ?? []).map(normalizeHistoryItemTime) };
}

function formatCalendarDate(value: string) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
}

function emptyText(tab: AppTab, signedIn: boolean) {
  if (!signedIn && (tab === "library" || tab === "profile")) return "Sign in to sync your MovieTracker library.";
  if (tab === "calendar") return signedIn ? "Watch something or track shows to fill your calendar." : "Sign in to see your watched diary.";
  if (tab === "discover") return "Pull to refresh or loosen the filters.";
  return "Pull to refresh.";
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingBottom: 116 },
  columns: { paddingHorizontal: 8 },
  feedFooter: { minHeight: 86, alignItems: "center", justifyContent: "center", gap: 8 },
  feedFooterText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  loading: { alignItems: "center", backgroundColor: "rgba(6,8,8,0.72)", bottom: 0, justifyContent: "center", left: 0, position: "absolute", right: 0, top: 0 },
  errorText: { color: colors.danger, fontSize: 14, fontWeight: "800", lineHeight: 20, marginHorizontal: 18, marginTop: 14 },
  afterFilters: { height: 18 },
  homeSection: { marginTop: 2 },
  discoverHeading: { marginTop: 34, marginBottom: 14, paddingHorizontal: 18, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 14 },
  discoverHeadingActions: { alignItems: "flex-end", gap: 7 },
  discoverTitleCopy: { flex: 1, minWidth: 0 },
  kickerText: { color: colors.accent, letterSpacing: 3.5, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  discoverTitle: { color: colors.text, fontSize: 44, lineHeight: 48, fontFamily: "serif", marginTop: 8 },
  forYouButton: { minHeight: 46, borderRadius: 18, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.panel },
  forYouText: { color: colors.text, fontSize: 15, fontWeight: "900" },
  inlineGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8 },
  filterPills: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 18, paddingVertical: 14 },
  filterPill: { minHeight: 42, borderRadius: 22, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.panel },
  filterPillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterPillText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  filterPillTextActive: { color: colors.text },
  calendarWrap: { marginTop: 4 },
  segmented: { flexDirection: "row", marginHorizontal: 18, marginTop: 10, borderRadius: 22, borderWidth: 1, borderColor: colors.line, overflow: "hidden", backgroundColor: colors.panel },
  segment: { flex: 1, height: 48, alignItems: "center", justifyContent: "center" },
  segmentActive: { backgroundColor: colors.accent },
  segmentText: { color: colors.text, fontWeight: "900" },
  monthToolbar: { marginHorizontal: 18, marginTop: 20, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthButton: { width: 46, height: 46, borderRadius: 23, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel },
  monthTitle: { color: colors.text, fontFamily: "serif", fontSize: 30, fontWeight: "700" },
  calendarDisplayToggle: { alignSelf: "center", marginTop: 12, minHeight: 34, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  calendarDisplayToggleText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  recommendationIntro: { color: colors.muted, fontSize: 16, lineHeight: 24, marginHorizontal: 18, marginBottom: 8 },
  calendarGrid: { marginHorizontal: 18, marginTop: 12, padding: 12, borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.285%", color: colors.muted, textAlign: "center", fontSize: 12, fontWeight: "900", paddingBottom: 10 },
  dayCell: { width: "14.285%", minHeight: 50, borderRadius: 12, backgroundColor: colors.panel2, alignItems: "flex-start", justifyContent: "flex-start", padding: 7, borderWidth: 2, borderColor: colors.panel },
  dayCellPosterMode: { minHeight: 70 },
  blankDay: { backgroundColor: "transparent" },
  todayCell: { backgroundColor: colors.accent },
  dayText: { color: colors.text, fontSize: 13, lineHeight: 16, fontWeight: "900" },
  todayText: { color: colors.text },
  selectedDayCell: { borderColor: colors.accent },
  dayCount: { position: "absolute", right: 4, top: 4, minWidth: 16, height: 16, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.72)", color: colors.text, textAlign: "center", lineHeight: 16, fontSize: 9, fontWeight: "900" },
  dayPosterStrip: { position: "absolute", left: 5, right: 5, bottom: 5, height: 27, flexDirection: "row", gap: 3, alignItems: "center" },
  dayPosterThumb: { flex: 1, height: 27, borderRadius: 5, overflow: "hidden", backgroundColor: colors.panel },
  dayPosterMore: { minWidth: 22, height: 22, borderRadius: 11, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.72)", color: colors.text, textAlign: "center", lineHeight: 22, fontSize: 9, fontWeight: "900" },
  agenda: { marginHorizontal: 18, marginTop: 22, gap: 18 },
  agendaDay: { gap: 7 },
  agendaHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  agendaDate: { color: colors.text, fontFamily: "serif", fontSize: 20, fontWeight: "700" },
  agendaCount: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: colors.panel2, color: colors.muted, textAlign: "center", lineHeight: 24, fontWeight: "900" },
  agendaRow: { minHeight: 72, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 8, flexDirection: "row", alignItems: "center", gap: 10 },
  agendaImage: { width: 76, height: 54, borderRadius: 8, overflow: "hidden", backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  agendaCopy: { flex: 1, minWidth: 0 },
  agendaTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  agendaSub: { color: colors.muted, fontSize: 13, marginTop: 4 },
  profileStats: { marginTop: 18, marginHorizontal: 18, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row", flexWrap: "wrap" },
  profileStat: { width: "50%", minHeight: 76, paddingVertical: 13, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9, borderColor: colors.line },
  profileStatRight: { borderRightWidth: 1 },
  profileStatBottom: { borderBottomWidth: 1 },
  profileStatValue: { color: colors.text, fontFamily: "serif", fontSize: 25, fontWeight: "700" },
  profileStatLabel: { color: colors.muted, flex: 1, fontSize: 11, fontWeight: "800" },
  profileNavOuter: { marginHorizontal: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line },
  profileNav: { gap: 24, paddingVertical: 10, paddingHorizontal: 0 },
  profileNavPill: { minHeight: 26, alignItems: "center", justifyContent: "center" },
  profileNavPillActive: {},
  profileNavText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  profileNavTextActive: { color: colors.text },
  profileSection: { marginTop: 26 },
  notificationList: { gap: 10, paddingHorizontal: 18, paddingBottom: 120 },
  notificationCard: { minHeight: 92, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.panel, padding: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  notificationCardUnread: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  notificationImage: { width: 86, height: 62, borderRadius: 10, backgroundColor: colors.panel2 },
  notificationIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  notificationCopy: { flex: 1, minWidth: 0, gap: 3 },
  notificationTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  notificationBody: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  notificationDate: { color: colors.muted, fontSize: 10, marginTop: 3 },
  historyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 18, paddingHorizontal: 18 },
  historyCard: { width: "47%" },
  historyArt: { aspectRatio: 1.72, borderRadius: 12, overflow: "hidden", backgroundColor: colors.panel2 },
  historyRating: { position: "absolute", right: 8, top: 8, borderRadius: 16, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.68)", color: colors.text, paddingHorizontal: 9, paddingVertical: 5, fontWeight: "900" },
  historyCardRewatch: { position: "absolute", right: 8, bottom: 8, minHeight: 25, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.76)", paddingHorizontal: 7, flexDirection: "row", alignItems: "center", gap: 4 },
  historyCardRewatchText: { color: colors.accent, fontSize: 10, fontWeight: "900" },
  historyDate: { position: "absolute", left: 8, bottom: 8, borderRadius: 8, overflow: "hidden", backgroundColor: "rgba(0,0,0,0.7)", color: colors.text, paddingHorizontal: 8, paddingVertical: 4, fontWeight: "900" },
  historyTitle: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 8 },
  historySub: { color: colors.muted, fontSize: 13, marginTop: 3 },
  historyTools: { marginHorizontal: 18, marginBottom: 18, gap: 12 },
  historySearchRow: { minHeight: 52, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  historySearchInput: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15 },
  historySearchButton: { minWidth: 72, minHeight: 36, borderRadius: 12, backgroundColor: colors.accent, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  historySearchButtonBusy: { opacity: 0.82 },
  historySearchButtonText: { color: colors.text, fontSize: 12, fontWeight: "900" },
  historyFilterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  historyFilterPill: { flexGrow: 1, flexBasis: "30%", minWidth: 92, minHeight: 42, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  historyFilterPillActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  historyFilterText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  historyFilterTextActive: { color: colors.text },
  historySummary: { marginHorizontal: 18, marginBottom: 22, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, flexDirection: "row" },
  historySummaryCell: { flex: 1, minHeight: 72, paddingVertical: 12, paddingHorizontal: 10, borderRightWidth: 1, borderColor: colors.line, justifyContent: "center", gap: 4 },
  historySummaryCellLast: { borderRightWidth: 0 },
  historySummaryValue: { color: colors.text, fontFamily: "serif", fontSize: 28, fontWeight: "700" },
  historySummaryLabel: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  historyTimeline: { gap: 26, paddingHorizontal: 18 },
  historyPager: { marginHorizontal: 18, marginTop: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  historyPageButton: { minWidth: 108, minHeight: 44, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  historyPageButtonDisabled: { opacity: 0.35 },
  historyPageButtonText: { color: colors.text, fontSize: 14, fontWeight: "900" },
  historyPageLabel: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  historyInlineLoading: { minHeight: 120, alignItems: "center", justifyContent: "center", gap: 10 },
  historyInlineLoadingText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  historyLoadMore: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, alignItems: "center", justifyContent: "center" },
  historyLoadMoreText: { color: colors.text, fontSize: 14, fontWeight: "900" },
  historyDay: { gap: 10 },
  historyDayDate: { gap: 2 },
  historyDayTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  historyDaySub: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  historyEventList: { gap: 9 },
  historyEvent: { minHeight: 96, borderWidth: 1, borderColor: colors.line, borderRadius: 15, backgroundColor: colors.panel, padding: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  historyEventArt: { width: 96, height: 62, borderRadius: 9, overflow: "hidden", backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  historyEventCopy: { flex: 1, minWidth: 0, gap: 3 },
  historyEventKicker: { color: colors.accent, letterSpacing: 1.8, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  historyEventTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  historyEventSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  historyEventMeta: { minWidth: 54, alignItems: "flex-end", gap: 5 },
  historyMetaInline: { flexDirection: "row", alignItems: "center", gap: 4 },
  historyRewatch: { color: colors.accent, fontSize: 10, fontWeight: "900" },
  historyEventTime: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  historyRemoveButton: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,77,77,0.28)", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,77,77,0.08)" },
  historyRatingSmall: { fontSize: 10 },
  progressGroups: { marginHorizontal: 18, borderTopWidth: 2, borderColor: colors.accent, flexDirection: "row", gap: 12, paddingTop: 18 },
  progressGroup: { flex: 1, minHeight: 116 },
  progressCount: { color: colors.text, fontFamily: "serif", fontSize: 34, fontWeight: "700" },
  progressLabel: { color: colors.muted, fontSize: 13, marginTop: 4 },
  miniPosters: { flexDirection: "row", marginTop: 10 },
  miniPoster: { width: 34, height: 50, borderRadius: 5, marginRight: -9, borderWidth: 1, borderColor: colors.bg },
  streakRow: { marginHorizontal: 18, marginTop: 18, paddingTop: 20, borderTopWidth: 1, borderTopColor: colors.line, flexDirection: "row", alignItems: "center", gap: 16 },
  streakLabel: { color: colors.muted, fontSize: 14 },
  streakValue: { color: colors.text, fontFamily: "serif", fontSize: 32, fontWeight: "700" },
  streakMeta: { color: colors.muted, fontSize: 13 },
  profileSubhead: { marginHorizontal: 18, marginTop: 24, marginBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  profileSubheadTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  profileSubheadAction: { color: colors.muted, fontWeight: "900" },
  statisticsGrid: { marginHorizontal: 18, borderTopWidth: 1, borderLeftWidth: 1, borderColor: colors.line, flexDirection: "row", flexWrap: "wrap" },
  statisticsCard: { width: "50%", minHeight: 122, borderRightWidth: 1, borderBottomWidth: 1, borderColor: colors.line, padding: 18, justifyContent: "center" },
  statisticsValue: { color: colors.text, fontFamily: "serif", fontSize: 36, lineHeight: 42 },
  statisticsLabel: { color: colors.muted, fontSize: 15, fontWeight: "800", marginTop: 4 },
  statsSectionHead: { marginTop: 34, marginHorizontal: 18 },
  statsSectionTitle: { color: colors.text, fontFamily: "serif", fontSize: 38, lineHeight: 44, marginTop: 6 },
  genreStatsPanel: { marginTop: 18, marginHorizontal: 18, borderWidth: 1, borderColor: colors.line, borderRadius: 16, backgroundColor: colors.panel, padding: 16, gap: 13 },
  genreLegend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 4 },
  genreLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  genreLegendDot: { width: 8, height: 8, borderRadius: 4 },
  genreLegendText: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "capitalize" },
  genreStatRow: { minHeight: 42, borderRadius: 10, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 8 },
  genreStatRowActive: { backgroundColor: colors.panel2 },
  genreStatName: { width: 92, color: colors.text, fontSize: 13, fontWeight: "900" },
  genreStatBar: { flex: 1, height: 12, borderRadius: 8, backgroundColor: colors.panel2, overflow: "hidden" },
  genreStatFill: { height: "100%", flexDirection: "row", borderRadius: 8, overflow: "hidden" },
  genreStatTotal: { width: 26, color: colors.muted, textAlign: "right", fontSize: 16, fontWeight: "800" },
  genreShelf: { marginTop: 16 },
  reviewList: { marginHorizontal: 18, borderTopWidth: 1, borderTopColor: colors.line },
  reviewRow: { flexDirection: "row", gap: 12, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line },
  reviewImage: { width: 92, height: 68, borderRadius: 10, backgroundColor: colors.panel2 },
  reviewCopy: { flex: 1, minWidth: 0 },
  reviewKindRow: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  reviewKind: { color: colors.accent, fontSize: 12, fontWeight: "900", letterSpacing: 1.3, textTransform: "uppercase" },
  reviewScore: { flexDirection: "row", alignItems: "center", gap: 4 },
  reviewScoreText: { color: "#ffc24b", fontSize: 12, fontWeight: "900" },
  reviewMedia: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 4 },
  reviewMeta: { color: colors.muted, fontSize: 13, marginTop: 4 },
  reviewTitle: { color: colors.text, fontFamily: "serif", fontSize: 19, fontWeight: "700", marginTop: 6 },
  reviewBody: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 5 },
  groupControls: { marginHorizontal: 18, marginTop: 6, marginBottom: 18, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  groupLabel: { color: colors.muted, fontSize: 13, fontWeight: "900", marginRight: 2 },
  groupChip: { minHeight: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.panel },
  groupChipActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  groupChipText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  groupChipTextActive: { color: colors.text },
  listGroupBlock: { marginBottom: 14 },
  listGroupTitle: { color: colors.accent, fontSize: 12, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase", marginHorizontal: 18, marginBottom: 12 },
  listGrid: { flexDirection: "row", flexWrap: "wrap", gap: 18, paddingHorizontal: 18 },
  listCard: { width: "47%", minHeight: 250 },
  posterStack: { height: 130, borderRadius: 14, backgroundColor: colors.panel, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  stackPoster: { position: "absolute", top: 18, width: 76, height: 108, borderRadius: 8 },
  listVisibility: { color: colors.accent, fontSize: 12, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase", marginTop: 14 },
  listName: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 8 },
  listDescription: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 8 },
  listCount: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 22 },
  shortcuts: { marginHorizontal: 18, marginTop: 34, borderTopWidth: 1, borderTopColor: colors.line },
  shortcut: { minHeight: 80, flexDirection: "row", alignItems: "center", gap: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  shortcutTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  shortcutBody: { color: colors.muted, fontSize: 14, marginTop: 3 },
  railBlock: { marginBottom: 2 },
  railContent: { gap: 14, paddingHorizontal: 18, paddingBottom: 6 },
  railCard: { width: 138 },
  railPoster: { aspectRatio: 0.68, borderRadius: 16, overflow: "hidden", backgroundColor: colors.panel2 },
  posterImage: { width: "100%", height: "100%" },
  posterFallback: { color: colors.muted, textAlign: "center", padding: 14, fontSize: 15, fontWeight: "800" },
  railRating: { position: "absolute", top: 8, right: 8, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.66)", paddingHorizontal: 8, paddingVertical: 5 },
  railRatingText: { color: colors.text, fontSize: 11, fontWeight: "900" },
  railTitle: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 8 },
  railMeta: { color: colors.muted, fontSize: 12, marginTop: 3 },
  profileHero: { minHeight: 488, marginTop: 0, backgroundColor: colors.bg, overflow: "hidden" },
  profileBanner: { position: "absolute", left: 0, right: 0, top: 0, height: 230 },
  profileBannerFallback: { position: "absolute", left: 0, right: 0, top: 0, height: 230, backgroundColor: colors.panel2 },
  profileShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.52)" },
  profileContent: { flex: 1, justifyContent: "flex-end", padding: 22, paddingTop: 178 },
  profileAvatarLarge: { width: 94, height: 94, borderRadius: 47, borderWidth: 3, borderColor: colors.bg, backgroundColor: "#008f82", alignItems: "center", justifyContent: "center", overflow: "hidden", marginBottom: 14 },
  profileAvatarImage: { width: "100%", height: "100%" },
  profileAvatarInitial: { color: colors.text, fontSize: 42, fontWeight: "900" },
  profileNameRow: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  profileNameCopy: { flex: 1, minWidth: 0 },
  profileKicker: { color: colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 2.4, textTransform: "uppercase" },
  profileName: { color: colors.text, fontFamily: "serif", fontSize: 34, lineHeight: 38, marginTop: 5 },
  profileHandle: { color: colors.muted, fontSize: 15, fontWeight: "800", marginTop: 4 },
  signOutButton: { borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(0,0,0,0.34)", paddingHorizontal: 14, paddingVertical: 10 },
  signOutText: { color: colors.text, fontWeight: "900" },
  profileBio: { color: colors.text, fontSize: 15, lineHeight: 22, marginTop: 14 },
  profileRegion: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 11 },
  profileRegionText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  editProfileButton: { minHeight: 54, borderRadius: 28, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18, backgroundColor: "rgba(10,13,14,0.76)" },
  editProfileText: { color: colors.text, fontSize: 17, fontWeight: "900" },
  mfaPanel: { marginHorizontal: 18, marginTop: 16, padding: 22, borderColor: colors.line, borderRadius: 24, borderWidth: 1, backgroundColor: colors.panel },
  mfaIcon: { width: 70, height: 70, borderRadius: 35, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  mfaTitle: { color: colors.text, fontSize: 28, fontWeight: "900" },
  mfaBody: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  mfaInput: { height: 64, borderRadius: 18, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, color: colors.text, fontSize: 27, fontWeight: "900", letterSpacing: 8, textAlign: "center", backgroundColor: colors.panel2, marginTop: 16 },
  mfaError: { color: colors.danger, fontSize: 14, fontWeight: "800", lineHeight: 20, marginTop: 12 },
  authPanel: { marginHorizontal: 18, marginTop: 16, padding: 20, borderColor: colors.line, borderRadius: 24, borderWidth: 1, backgroundColor: colors.panel },
  authTitle: { color: colors.text, fontSize: 28, fontWeight: "900" },
  authBody: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8, marginBottom: 16 },
  googleButton: { height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#f6f2eb", marginBottom: 12 },
  googleButtonText: { color: "#101415", fontSize: 17, fontWeight: "900" },
  authDivider: { color: colors.muted, textAlign: "center", fontSize: 13, fontWeight: "800", marginBottom: 2 },
  authInput: { height: 58, borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, color: colors.text, fontSize: 17, backgroundColor: colors.panel2, marginTop: 10 },
  authButton: { height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, marginTop: 14 },
  disabledButton: { opacity: 0.7 },
  authButtonText: { color: colors.text, fontSize: 17, fontWeight: "900" },
  switchAuth: { alignItems: "center", paddingTop: 16 },
  switchAuthText: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginHorizontal: 18, marginTop: 16 },
  statCard: { flexBasis: "47%", flexGrow: 1, minHeight: 96, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 15 },
  statValue: { color: colors.text, fontSize: 27, fontWeight: "900", marginTop: 8 },
  statLabel: { color: colors.muted, fontSize: 13, fontWeight: "800", marginTop: 3 },
  emptyPanel: { marginHorizontal: 18, marginTop: 20, padding: 22, borderColor: colors.line, borderRadius: 24, borderWidth: 1, backgroundColor: colors.panel },
  emptyTitle: { color: colors.text, fontSize: 26, fontWeight: "900" },
  emptyBody: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  emptyAction: { alignSelf: "flex-start", marginTop: 16, borderRadius: 18, backgroundColor: colors.accent, paddingHorizontal: 16, paddingVertical: 11 },
  emptyActionText: { color: colors.text, fontWeight: "900" },
  detailContent: { paddingBottom: 126 },
  detailHero: { minHeight: 500, overflow: "hidden", justifyContent: "flex-end", backgroundColor: colors.panel },
  detailShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.56)" },
  backButton: { position: "absolute", top: 18, left: 18, zIndex: 2, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.48)", flexDirection: "row", alignItems: "center", gap: 4 },
  backText: { color: colors.text, fontSize: 15, fontWeight: "900" },
  detailCopy: { flexDirection: "row", alignItems: "flex-end", padding: 20, gap: 16 },
  detailPoster: { width: 116, height: 172, borderRadius: 16, backgroundColor: colors.panel2 },
  detailText: { flex: 1, minWidth: 0 },
  detailKicker: { color: colors.accent, letterSpacing: 3, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  detailTitle: { color: colors.text, fontFamily: "serif", fontSize: 36, lineHeight: 40, marginTop: 8 },
  detailMeta: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 8 },
  detailBody: { padding: 18 },
  detailOverview: { color: colors.text, fontSize: 18, lineHeight: 28 },
  detailActionGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 22 },
  detailAction: { flexBasis: "47%", flexGrow: 1, minHeight: 56, borderRadius: 17, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  detailActionText: { color: colors.text, fontSize: 15, fontWeight: "900" },
  detailDanger: { minHeight: 56, borderRadius: 17, borderWidth: 1, borderColor: "rgba(255,77,77,0.35)", backgroundColor: "rgba(255,77,77,0.1)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 10 },
  detailDangerText: { color: colors.danger, fontSize: 15, fontWeight: "900" },
  factGrid: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 22 },
  fact: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.line },
  factLabel: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  factValue: { color: colors.text, fontSize: 17, fontWeight: "900", marginTop: 5 },
  searchPanel: { marginHorizontal: 18, marginTop: 4, marginBottom: 18, gap: 12 },
  searchResultsLoading: { minHeight: 140, marginHorizontal: 18, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, alignItems: "center", justifyContent: "center", gap: 10 },
  searchResultsLoadingText: { color: colors.muted, fontSize: 14, fontWeight: "800" },
  lastWatchedText: { color: colors.muted, fontSize: 13, fontWeight: "800", lineHeight: 19, marginTop: 10, marginBottom: 14 },
  searchBox: { minHeight: 60, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: colors.text, fontSize: 18 },
  searchClearButton: { minHeight: 38, borderRadius: 19, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  searchClearText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  searchButton: { height: 58, borderRadius: 20, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  searchButtonText: { color: colors.text, fontSize: 18, fontWeight: "900" },
  listDetailHeader: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 20 },
  backChip: { alignSelf: "flex-start", minHeight: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12 },
  backChipText: { color: colors.text, fontWeight: "900" },
  listDetailTitle: { color: colors.text, fontFamily: "serif", fontSize: 46, lineHeight: 50, marginTop: 12 },
  listDetailBody: { color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 8 },
  listDetailTools: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.56)" },
  modalKeyboardAvoider: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-end" },
  actionSheet: { position: "absolute", left: 14, right: 14, bottom: 18, maxHeight: "92%", borderRadius: 28, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 18 },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: "#4a5052", alignSelf: "center", marginBottom: 10 },
  actionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  actionThumb: { width: 48, height: 66, borderRadius: 8, backgroundColor: colors.panel2 },
  actionTitle: { color: colors.text, fontSize: 22, fontWeight: "900" },
  actionSub: { color: colors.muted, marginTop: 4, marginBottom: 10, fontSize: 14 },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  actionRow: { minHeight: 52, flexDirection: "row", alignItems: "center", borderRadius: 14, paddingHorizontal: 8 },
  actionIcon: { width: 38 },
  actionText: { color: colors.text, fontSize: 17, fontWeight: "800" },
  dangerText: { color: colors.danger },
  actionDivider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  actionSectionLabel: { color: colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 2.2, textTransform: "uppercase", marginBottom: 8 },
  contextPrimaryActions: { flexDirection: "row", gap: 10, marginTop: 10, marginBottom: 8 },
  contextPrimaryButton: { flex: 1, minHeight: 76, borderRadius: 14, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 4 },
  contextPrimaryText: { color: colors.text, fontSize: 12, fontWeight: "900", textAlign: "center" },
  contextListSearch: { height: 54, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, marginBottom: 10 },
  contextListInput: { flex: 1, color: colors.text, fontSize: 15 },
  actionListScroll: { maxHeight: 330 },
  actionListScrollCompact: { maxHeight: 220 },
  actionListContent: { paddingBottom: 10, gap: 4 },
  listRetryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.line, borderRadius: 12 },
  statusSheetRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginVertical: 10 },
  statusSheetButton: { flexBasis: "31%", minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center", gap: 4 },
  statusSheetButtonActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  statusSheetText: { color: colors.muted, fontSize: 11, fontWeight: "900" },
  statusSheetTextActive: { color: colors.text },
  listActionRow: { minHeight: 56, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  listActionRowActive: { backgroundColor: colors.panel2 },
  listActionName: { color: colors.text, fontSize: 15, fontWeight: "800", flex: 1 },
  listActionNameActive: { color: "#6ee7a8" },
  listActionState: { flexDirection: "row", alignItems: "center", gap: 5 },
  listActionText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  listActionTextActive: { color: "#6ee7a8" },
  currentListSection: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, marginTop: 12, marginBottom: 12, paddingTop: 14, paddingBottom: 14 },
  franchiseGroupChips: { gap: 8, paddingBottom: 8 },
  franchiseGroupCreateRow: { flexDirection: "row", gap: 8 },
  franchiseGroupInput: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, color: colors.text, paddingHorizontal: 12, fontSize: 15, fontWeight: "700" },
  franchiseGroupSave: { minHeight: 46, borderRadius: 14, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  franchiseGroupSaveText: { color: colors.text, fontSize: 14, fontWeight: "900" },
  currentListRemove: { minHeight: 54, borderRadius: 16, backgroundColor: "rgba(255,77,77,0.12)", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  currentListRemoveText: { color: "#ff8585", fontSize: 15, fontWeight: "900" },
  watchLogScrollContent: { paddingBottom: 8 },
  episodeHero: { minHeight: 640, backgroundColor: colors.panel, justifyContent: "flex-end", overflow: "hidden" },
  entityHeader: { padding: 18, paddingBottom: 4 },
  entityHeroRow: { flexDirection: "row", gap: 16, alignItems: "center", marginTop: 18 },
  entityPortrait: { width: 118, height: 164, borderRadius: 18, overflow: "hidden", backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  entityLogoBox: { width: 132, height: 88, borderRadius: 16, overflow: "hidden", backgroundColor: "#eeeae2", alignItems: "center", justifyContent: "center" },
  entityCopy: { flex: 1, minWidth: 0 },
  entityTitle: { color: colors.text, fontFamily: "serif", fontSize: 38, lineHeight: 42, marginTop: 6 },
  entitySubtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 8 },
  entityLoadMore: { minHeight: 70, alignItems: "center", justifyContent: "center", paddingBottom: 18 },
  entityLoadMoreText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  detailLoadingScreen: { flex: 1, minHeight: 760, backgroundColor: colors.bg, justifyContent: "center", overflow: "hidden", paddingHorizontal: 22 },
  detailLoadingCard: { borderRadius: 26, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(13,17,17,0.86)", alignItems: "center", gap: 10, paddingHorizontal: 24, paddingVertical: 30 },
  detailLoadingTitle: { color: colors.text, fontFamily: "serif", fontSize: 30, fontWeight: "700", marginTop: 6, textAlign: "center" },
  detailLoadingText: { color: colors.muted, fontSize: 14, fontWeight: "800", lineHeight: 20, textAlign: "center" },
  detailHeroV2: { minHeight: 760, backgroundColor: colors.panel, justifyContent: "flex-end", overflow: "hidden" },
  detailShadeV2: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.48)" },
  detailHeroCopyV2: { padding: 22, paddingTop: 150 },
  detailPosterV2: { width: 106, height: 158, borderRadius: 14, backgroundColor: colors.panel2, marginBottom: 18 },
  detailTitleV2: { color: colors.text, fontFamily: "serif", fontSize: 46, lineHeight: 48, marginTop: 8 },
  ratingSourceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  ratingSource: { minWidth: 112, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(0,0,0,0.34)", padding: 12 },
  ratingSourceLoading: { borderColor: "rgba(255,84,57,0.32)", backgroundColor: "rgba(0,0,0,0.24)" },
  ratingSourceLabel: { color: colors.muted, fontSize: 11, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  ratingSourceValue: { color: colors.text, fontSize: 20, fontWeight: "900", marginTop: 0 },
  ratingSourceValueRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  ratingSourceValueLoading: { color: colors.muted, fontSize: 16, marginTop: 0 },
  detailTagline: { color: colors.text, fontFamily: "serif", fontSize: 24, fontStyle: "italic", lineHeight: 32, marginTop: 24 },
  trailerButton: { alignSelf: "flex-start", marginTop: 22, height: 58, borderRadius: 26, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20 },
  trailerButtonText: { color: colors.text, fontSize: 17, fontWeight: "900" },
  titleActionDock: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingTop: 15, paddingBottom: 14, marginBottom: 22 },
  actionLabelBig: { color: colors.text, fontSize: 14, fontWeight: "900", letterSpacing: 1.8, textTransform: "uppercase", marginBottom: 12 },
  statusActions: { flexDirection: "row", gap: 3 },
  detailStatusButton: { flex: 1, minHeight: 46, borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 3, backgroundColor: "transparent", position: "relative" },
  detailStatusButtonActive: { backgroundColor: colors.accentSoft, borderBottomWidth: 2, borderBottomColor: colors.accent },
  detailStatusText: { color: colors.muted, fontSize: 10, fontWeight: "900", textAlign: "center" },
  detailStatusTextActive: { color: colors.text },
  ratingAction: { minHeight: 66, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, marginTop: 15, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  ratingActionCopy: { flex: 1, minWidth: 0 },
  ratingActionLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 1.4, textTransform: "uppercase" },
  ratingActionValue: { color: colors.text, fontFamily: "serif", fontSize: 27, fontWeight: "700", marginTop: 3 },
  detailQuickActions: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: 14 },
  quickAction: { minHeight: 40, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "transparent" },
  quickActionText: { color: colors.text, fontSize: 14, fontWeight: "900", flexShrink: 1 },
  detailLists: { marginTop: 12 },
  addToListButton: { minHeight: 50, borderRadius: 12, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 14, marginBottom: 8 },
  addToListText: { color: colors.text, fontSize: 15, fontWeight: "900", flex: 1 },
  listPickerSheet: { position: "absolute", left: 14, right: 14, bottom: 18, maxHeight: "88%", borderRadius: 28, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 16 },
  sheetHeaderRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  sheetTitleText: { color: colors.text, fontFamily: "serif", fontSize: 30, lineHeight: 34 },
  sheetSubText: { color: colors.muted, fontSize: 13, fontWeight: "800", marginTop: 3 },
  sheetCloseButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  listPickerSearch: { height: 50, borderRadius: 15, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, marginTop: 14 },
  listPickerInput: { flex: 1, color: colors.text, fontSize: 16 },
  listPickerScroll: { marginTop: 10, maxHeight: 430 },
  listPickerContent: { paddingBottom: 10, gap: 8 },
  detailListSheetRow: { minHeight: 58, borderRadius: 16, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14 },
  emptyMiniText: { color: colors.muted, fontSize: 14, fontWeight: "800", textAlign: "center", paddingVertical: 22 },
  detailListRow: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 12, marginBottom: 8 },
  detailListRowActive: { backgroundColor: colors.panel2, borderColor: colors.accent },
  detailListName: { color: colors.text, fontSize: 15, fontWeight: "900", flex: 1 },
  detailListState: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  detailListStateActive: { color: colors.accent },
  ratingSheet: { position: "absolute", left: 14, right: 14, bottom: 92, borderRadius: 26, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 16 },
  watchLogSheet: { position: "absolute", left: 14, right: 14, bottom: 18, maxHeight: "86%", borderRadius: 28, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 16 },
  watchQuickGrid: { flexDirection: "row", gap: 8, marginTop: 10 },
  watchQuickButton: { flex: 1, minHeight: 92, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, padding: 10, justifyContent: "center", gap: 4 },
  watchQuickTitle: { color: colors.text, fontSize: 13, fontWeight: "900" },
  watchQuickSub: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  watchCustomBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 },
  watchInputsRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  watchInput: { flex: 1, marginTop: 0 },
  watchTimeInput: { width: 98, marginTop: 0 },
  timePointRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  timePointButton: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel2 },
  timePointButtonActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  timePointText: { color: colors.muted, fontSize: 13, fontWeight: "900" },
  timePointTextActive: { color: colors.text },
  watchHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 9 },
  ratingSheetActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  ratingGhostButton: { flex: 1, height: 52, borderRadius: 18, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  ratingGhostText: { color: colors.text, fontWeight: "900" },
  ratingSaveButton: { flex: 1, height: 52, borderRadius: 18, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  ratingSaveText: { color: colors.text, fontWeight: "900" },
  scoreControl: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  scoreStepButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  scoreInput: { flex: 1, height: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, color: colors.text, fontSize: 22, fontWeight: "900", textAlign: "center" },
  reviewComposerSection: { marginTop: 46 },
  reviewComposerPanel: { marginHorizontal: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: 18 },
  reviewComposerTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  reviewComposerScore: { color: "#ffc24b", fontFamily: "serif", fontSize: 25, fontWeight: "700", marginTop: 3 },
  clearRatingText: { color: colors.muted, fontSize: 12, fontWeight: "900", marginTop: 4 },
  reviewTitleInput: { minHeight: 54, borderBottomWidth: 1, borderBottomColor: colors.line, color: colors.text, fontSize: 18, marginTop: 18 },
  reviewBodyInput: { minHeight: 130, paddingTop: 12, lineHeight: 24 },
  reviewComposerFooter: { marginTop: 18, gap: 14 },
  spoilerCopy: { flexDirection: "row", alignItems: "center", gap: 10 },
  spoilerTitle: { color: colors.text, fontWeight: "900" },
  spoilerBody: { color: colors.muted, fontSize: 12, marginTop: 2 },
  publishReviewButton: { minHeight: 54, borderRadius: 22, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  publishReviewText: { color: colors.text, fontSize: 16, fontWeight: "900" },
  detailSection: { marginTop: 46 },
  seasonList: { paddingHorizontal: 18, marginTop: 14, gap: 10 },
  seasonCard: { minHeight: 92, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", padding: 10, gap: 12 },
  seasonPoster: { width: 48, height: 72, borderRadius: 8, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  seasonCopy: { flex: 1, minWidth: 0 },
  seasonName: { color: colors.text, fontSize: 16, fontWeight: "900" },
  seasonMeta: { color: colors.muted, fontSize: 13, fontWeight: "700", marginTop: 4 },
  sourceTabs: { flexDirection: "row", gap: 9, paddingHorizontal: 18, marginTop: 10, flexWrap: "wrap" },
  sourceTab: { minHeight: 42, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, alignItems: "center", justifyContent: "center" },
  sourceTabActive: { borderColor: colors.accent, backgroundColor: "rgba(255,84,57,0.18)" },
  sourceTabDisabled: { opacity: 0.42 },
  sourceTabText: { color: colors.text, fontWeight: "900" },
  ratingGraphControls: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 18, marginTop: 12 },
  ratingGraphToggle: { minHeight: 42, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  ratingGraphToggleActive: { borderColor: colors.accent, backgroundColor: "rgba(255,84,57,0.16)" },
  ratingGraphToggleText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  watchProgressCard: { marginHorizontal: 18, marginTop: 14, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 14 },
  watchProgressHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  watchProgressLabel: { color: colors.accent, fontSize: 11, fontWeight: "900", letterSpacing: 2, textTransform: "uppercase" },
  watchProgressValue: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 4 },
  watchProgressToggle: { minHeight: 38, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  watchProgressToggleActive: { borderColor: colors.accent, backgroundColor: "rgba(255,84,57,0.18)" },
  watchProgressToggleText: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  watchProgressToggleTextActive: { color: colors.text },
  watchProgressTrack: { height: 8, borderRadius: 999, backgroundColor: colors.panel2, overflow: "hidden", marginTop: 12 },
  watchProgressFill: { height: "100%", borderRadius: 999, backgroundColor: colors.accent },
  ratingLegend: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 18, marginTop: 10 },
  ratingLegendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  ratingLegendDot: { width: 9, height: 9, borderRadius: 5 },
  ratingLegendText: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  fullMatrixScroll: { paddingHorizontal: 18, paddingVertical: 12 },
  fullEpisodeMatrix: { gap: 6 },
  matrixRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  matrixAxisCell: { width: 64, color: colors.muted, fontSize: 12, fontWeight: "900" },
  matrixHeaderCell: { width: 48, textAlign: "center", color: colors.muted, fontSize: 12, fontWeight: "900" },
  matrixEmptyCell: { width: 48, height: 42, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.05)" },
  matrixCell: { width: 48, height: 42, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  matrixCellText: { fontSize: 14, fontWeight: "900" },
  dimmedEpisode: { opacity: 0.38 },
  dimmedEpisodeCard: { opacity: 0.42 },
  mutedBody: { color: colors.muted, fontSize: 13, lineHeight: 20, paddingHorizontal: 18 },
  seasonEpisodeGrid: { paddingHorizontal: 18, paddingVertical: 14, gap: 8 },
  seasonEpisodeCell: { width: 62, height: 54, borderRadius: 9, backgroundColor: "#f5c20b", alignItems: "center", justifyContent: "center" },
  seasonEpisodeCode: { color: "#1d1705", fontSize: 11, fontWeight: "900" },
  seasonEpisodeScore: { color: "#1d1705", fontSize: 18, fontWeight: "900", marginTop: 2 },
  trailerPreview: { marginHorizontal: 18, minHeight: 190, borderRadius: 22, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center", gap: 8, overflow: "hidden" },
  trailerPreviewText: { color: colors.text, fontSize: 22, fontWeight: "900" },
  trailerPreviewSub: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  galleryGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 14, paddingHorizontal: 18, marginBottom: 28, rowGap: 14 },
  galleryTile: { width: "48%", aspectRatio: 1.35, borderRadius: 16, overflow: "hidden", backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  galleryScrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.44)" },
  galleryText: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 8 },
  gallerySub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  galleryModal: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
  galleryClose: { position: "absolute", top: 18, right: 18, zIndex: 3, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  gallerySlide: { alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  gallerySlideImage: { width: "100%", height: "86%" },
  castGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 18, marginTop: 8, rowGap: 28 },
  personCard: { width: "33.33%", minHeight: 142, alignItems: "center", paddingHorizontal: 5 },
  personPhoto: { width: 94, height: 94, borderRadius: 47, backgroundColor: colors.panel2 },
  personName: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 10, textAlign: "center" },
  personRole: { color: colors.muted, fontSize: 12, marginTop: 2, textAlign: "center" },
  companyGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 12, columnGap: 12, paddingHorizontal: 18, marginTop: 8 },
  companyCard: { width: "47.5%", borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 10, backgroundColor: colors.panel, alignItems: "center" },
  companyLogo: { width: "100%", height: 82, borderRadius: 12, backgroundColor: "#eeeae2", alignItems: "center", justifyContent: "center" },
  companyLogoImage: { width: "90%", height: "80%" },
  companyInitial: { color: "#161a1b", fontFamily: "serif", fontSize: 30, fontWeight: "700" },
  companyName: { color: colors.text, fontSize: 14, fontWeight: "900", marginTop: 10, textAlign: "center" },
  featureIntro: { color: colors.muted, fontSize: 15, lineHeight: 22, marginHorizontal: 18, marginBottom: 18 },
  featureForm: { marginHorizontal: 18, padding: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, gap: 18 },
  featureField: { gap: 8 },
  featureLabel: { color: colors.text, fontSize: 14, fontWeight: "900" },
  featureChoices: { flexDirection: "row", gap: 8, paddingRight: 10 },
  featureChoice: { minHeight: 38, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 },
  featureChoiceActive: { borderColor: colors.accent, backgroundColor: "rgba(255,91,62,.17)" },
  featureChoiceText: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  featureChoiceTextActive: { color: colors.text },
  featurePrimary: { minHeight: 52, marginTop: 3, borderRadius: 18, backgroundColor: colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 18 },
  featurePrimaryText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  featureLink: { marginHorizontal: 18, marginBottom: 18, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 20, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", gap: 12 },
  featureLinkTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  featureLinkBody: { color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  tonightMobileCard: { marginHorizontal: 18, marginTop: 18, padding: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 22, backgroundColor: colors.panel, overflow: "hidden", gap: 8 },
  tonightMobileArt: { width: "100%", aspectRatio: 1.78, borderRadius: 14, backgroundColor: colors.panel2 },
  tonightMobileTitle: { color: colors.text, fontFamily: "serif", fontSize: 30, fontWeight: "700" },
  featureShelf: { marginTop: 28, gap: 10 },
  upNextMobileRow: { marginHorizontal: 18, minHeight: 106, padding: 9, borderWidth: 1, borderColor: colors.line, borderRadius: 18, backgroundColor: colors.panel, flexDirection: "row", alignItems: "center", gap: 12 },
  upNextMobileArt: { width: 104, height: 78, borderRadius: 12, backgroundColor: colors.panel2 },
  upNextMobileTitle: { color: colors.text, fontSize: 15, fontWeight: "900" },
  upNextMobileMeta: { color: colors.muted, fontSize: 11, marginTop: 5 },
  eveningMobile: { marginHorizontal: 18, marginVertical: 15, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: 22, backgroundColor: colors.panel, gap: 12 },
  eveningTotal: { color: colors.text, fontSize: 15, fontWeight: "900", marginTop: 4 },
  eveningQueueRow: { borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 10 },
  wrappedMobileLine: { color: colors.text, fontFamily: "serif", fontSize: 24, lineHeight: 34, marginHorizontal: 18, marginBottom: 14 },
  wrappedMobileBar: { marginHorizontal: 18, minHeight: 42, flexDirection: "row", alignItems: "center", gap: 8 },
  wrappedMobileCallout: { paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: colors.line },
  settingsWrap: { paddingBottom: 20 },
  settingsTabs: { gap: 10, paddingHorizontal: 18, paddingBottom: 12 },
  settingsTab: { minHeight: 42, borderRadius: 22, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel },
  settingsTabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  settingsTabText: { color: colors.muted, fontWeight: "900" },
  settingsTabTextActive: { color: colors.text },
  settingsPanel: { marginHorizontal: 18, marginTop: 10, borderRadius: 24, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, padding: 18 },
  settingsTitle: { color: colors.text, fontFamily: "serif", fontSize: 32, marginBottom: 12 },
  settingsBody: { color: colors.muted, fontSize: 15, lineHeight: 23 },
  settingsField: { marginTop: 12 },
  settingsLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 },
  settingsInput: { minHeight: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, color: colors.text, fontSize: 16, paddingHorizontal: 12 },
  profileMediaRow: { minHeight: 82, borderRadius: 18, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, padding: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  profileMediaPreview: { flexShrink: 0, overflow: "hidden", backgroundColor: colors.panel, alignItems: "center", justifyContent: "center" },
  profileMediaAvatar: { width: 62, height: 62, borderRadius: 31 },
  profileMediaBanner: { width: 110, height: 62, borderRadius: 14 },
  profileMediaImage: { width: "100%", height: "100%" },
  profileMediaButton: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 16, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 12 },
  profileMediaButtonText: { color: colors.text, flexShrink: 1, fontSize: 14, fontWeight: "900", textAlign: "center" },
  settingsTextArea: { minHeight: 112, paddingTop: 12, textAlignVertical: "top" },
  settingsSave: { height: 56, borderRadius: 20, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginTop: 18 },
  settingsSaveText: { color: colors.text, fontSize: 17, fontWeight: "900" },
  settingsGhost: { minHeight: 52, borderRadius: 18, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginTop: 16 },
  settingsGhostText: { color: colors.text, fontWeight: "900" },
  settingsDanger: { minHeight: 52, borderRadius: 18, borderWidth: 1, borderColor: "rgba(255,77,77,0.36)", backgroundColor: "rgba(255,77,77,0.10)", alignItems: "center", justifyContent: "center", marginTop: 12 },
  settingsDangerText: { color: colors.danger, fontWeight: "900" },
  settingsError: { color: colors.danger, fontSize: 14, fontWeight: "800", lineHeight: 20, marginTop: 12 },
  integrationBox: { marginTop: 16, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  integrationLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  integrationValue: { color: colors.text, fontSize: 22, fontWeight: "900", marginTop: 4, marginBottom: 8 },
  securityButtonRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  securitySmallButton: { flex: 1, minHeight: 48, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  securitySmallButtonGhost: { flex: 1, minHeight: 48, borderRadius: 16, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  securitySmallButtonText: { color: colors.text, fontSize: 14, fontWeight: "900", textAlign: "center" },
  securityFactorRow: { minHeight: 72, borderRadius: 16, borderWidth: 1, borderColor: "rgba(110,231,168,0.36)", backgroundColor: "rgba(110,231,168,0.08)", flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, padding: 12, marginTop: 10 },
  securityFactorCopy: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  securityFactorTitle: { color: colors.text, fontSize: 14, fontWeight: "900" },
  securityFactorSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  securityRemoveButton: { minHeight: 38, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  securityRemoveText: { color: colors.text, fontSize: 13, fontWeight: "900" },
  securityEnrollBox: { marginTop: 12, gap: 10 },
  securitySecretText: { color: colors.text, backgroundColor: colors.panel2, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 12, fontSize: 14, fontWeight: "900", lineHeight: 20 },
  privacyRow: { minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  privacyLabel: { color: colors.text, fontSize: 16, fontWeight: "800", textTransform: "capitalize", flex: 1 },
  privacyValue: { color: colors.accent, fontSize: 14, fontWeight: "900", textTransform: "capitalize" },
  toggleRow: { minHeight: 58, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }
});


