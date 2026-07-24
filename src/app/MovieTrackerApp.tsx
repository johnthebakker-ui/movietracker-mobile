import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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

import { AppHeader, BottomNav, DiscoverFiltersCard, Hero, PickerSheet, RecommendationFiltersCard, RemoteImage, resolveRemoteImageUri, SectionTitle, TitleCard, type PickerAnchor } from "../components";
import { deleteMobileHistoryEvent, dismissMobileNotifications, disconnectTrakt, fetchDiscover, fetchListFranchiseCollections, fetchMobileCompany, fetchMobileEpisode, fetchMobileHistory, fetchMobilePerson, fetchMobileProfile, fetchMobileReviews, fetchMobileSeason, fetchMobileTitle, fetchRecommendations, fetchSearch, fetchTonight, fetchTraktStatus, fetchUpNext, fetchWebsiteEntityMetadata, fetchWebsiteHome, fetchWebsiteTitleMetadata, fetchWrapped, fetchWrappedShare, sendTestNotification, refreshRecommendations, setNotInterested, startTraktConnect, syncTrakt, type MobileTraktStatus } from "../api";
import { API_URL, communityRatingLabel, countries, excludeGenreOptions, genres, HAS_SUPABASE, titleYear, tmdbImage, userRatingLabel } from "../config";
import { groupFranchises, listFranchiseName, NO_FRANCHISE_GROUP } from "../franchise-groups";
import { filterByMediaKind, type MediaKindFilter } from "../media-kind-filter";
import { compactProfileStatValue } from "../profile-stats";
import { supabase } from "../supabase";
import { reportError } from "../telemetry";
import { scheduleEpisodeNotifications } from "../services/releasePushNotifications";
import { styles } from "../app/styles";
import { dedupeMedia, firstRow, fromDbMedia, fromTmdbRaw, mapProfileReview, progressLabel, trustedCommunityRating } from "../app/media-model";
import { EmptyPanel } from "../components/EmptyPanel";
import type { ActionRefreshReason, CalendarEvent, CalendarMode, CalendarView, DetailCompany, DetailData, DetailImage, DetailPerson, DetailSeason, DetailVideo, EntityTarget, EpisodeTarget, FeatureView, GenreStat, HistoryFilter, HistoryItem, HomeSection, LibraryFilter, ListGroup, ListMembership, ListSort, MediaKindCounts, MfaState, PickerState, Profile, ProfileData, ProfileImageSelection, ProfilePanel, ProfileView, ProgressCounts, ReviewItem, SeasonTarget, SeriesEpisodesTarget, SettingsTab, TrackedStatus, UserList, WatchDateMode, WatchLogValues, WatchTimePoint } from "../app/types";
import { calendarCells, calendarWeekDays, calendarWeekLabel, emptyText, formatCalendarDate, formatDate, formatHistoryDay, formatHistoryMonth, formatHistoryTime, formatLastWatched, formatShortDate, isEditedReview, localDateKey, minutesToLabel, monthBounds, monthKey, normalizeHistoryItemTime, normalizeProfileDataTimes, shiftMonth, shiftWeek, streaksFromDays, viewingDateKey, weekBounds, weekStartKey } from "../app/date-utils";
import { availableListFranchiseGroups, groupedListItems, sortListItems } from "../features/library/model";
import { CardGrid, DiscoverHeading, PosterRail, SearchPanel } from "../features/library/LibraryComponents";
import { LibraryFilters, MediaKindFilterControl } from "../features/library/LibraryFilters";
import { CalendarPanel } from "../features/calendar/CalendarPanel";
import { RatingSheet, ReviewComposerPanel, WatchLogSheet, clampRating, resolveWatchLogDate } from "../features/reviews/ReviewSheets";
import { SettingsScreen } from "../features/settings/SettingsScreen";
import { NotificationScreen } from "../features/notifications/NotificationScreen";
import { DetailScreenV2, EntityScreen, EpisodeDetailScreen, MovieActionSheet, SeasonDetailScreen, SeriesEpisodesScreen } from "../features/details/DetailScreens";
import { isLimitedSeries, loadMobileActiveRewatchIds, loadMobileSeriesViewingSummary, reconcileMobileEpisodeProgress, titleDetailCacheKey } from "../features/details/service";
import { loadUserLists } from "../features/library/service";
import { RatingLegend, ratingCellStyle } from "../features/ratings/RatingTable";
import { StatisticsPage, TonightScreen, UpNextScreen, WrappedScreen } from "../features/discovery/DiscoveryScreens";
import { GroupedListContent, ListGrid, MfaPanel, PosterStack, ProfileHero, ProfileListsSection, ProfileMediaSection, ProfileShortcuts, ReviewRow } from "../features/profile/ProfileComponents";
import { ChoiceChips, FullHistoryPage, FullJournalPage, FullReviewsPage, ProfileDestinationTotal, ProfileHistorySection, ProfileNav, ProfileProgressSection, ProfileStatBand, ReviewSection } from "../features/profile/ProfileSections";
import { colors } from "../theme";
import type { AppTab, DiscoverFilters, FeedResult, MediaKind, MediaSummary, RecommendationFilters } from "../types";
import { episodeTargetForUpNext, type UpNextEntry } from "../up-next-navigation";
import { completedRewatchProgress, seriesViewingSummary, viewingPassProgress, type SeriesViewingSummary } from "../viewing-passes";

const initialDiscoverFilters: DiscoverFilters = { kind: "all", genre: "", country: "", yearMode: "exact", year: "", fromYear: "", toYear: "", sort: "popularity", excludeGenres: [], hideWatched: false, hideListed: false };
const initialRecommendationFilters: RecommendationFilters = { kind: "all", genre: "", country: "", yearMode: "exact", year: "", fromYear: "", toYear: "", hideWatched: true, hideListed: true, excludeGenres: [] };
const emptyFeed: FeedResult = { items: [] };

const blankProgress: ProgressCounts = { planned: 0, watching: 0, completed: 0, paused: 0, dropped: 0, favorites: 0 };
const blankProfileData: ProfileData = { followers: 0, following: 0, tracked: 0, trackedLibraryTitles: 0, watchEvents: 0, screenTimeHours: 0, historyUniqueTitles: 0, averageRating: "-", reviewCount: 0, listCount: 0, history: [], reviews: [], favorites: [], lists: [], progressGroups: [], currentStreak: 0, longestStreak: 0, currentlyWatching: [], genreStats: [] };
const trackedStatusOrder: TrackedStatus[] = ["completed", "watching", "planned", "paused", "dropped"];
const profileReviewMediaSelect = "id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,runtime,genres,original_language,origin_countries,collection_tmdb_id,collection_name,collection_poster_path";
const profileReviewSelect = `id,title,body,contains_spoilers,is_private,created_at,updated_at,media(${profileReviewMediaSelect}),seasons(id,season_number,name,overview,poster_path,air_date,episode_count,media(${profileReviewMediaSelect})),episodes(id,name,overview,episode_number,air_date,still_path,runtime,vote_average,seasons(season_number,name,media(${profileReviewMediaSelect}))),ratings(score)`;
const profileCachePrefix = "movietracker-profile-v1";
const profileDataCachePrefix = "movietracker-profile-data-v5";
const libraryCachePrefix = "movietracker-library-v4";
const searchCache = new Map<string, { savedAt: number; feed: FeedResult }>();

const listSortOptions: Array<{ value: ListSort; label: string }> = [
  { value: "title_asc", label: "Name A-Z" },
  { value: "title_desc", label: "Name Z-A" },
  { value: "release_desc", label: "Release date: newest" },
  { value: "release_asc", label: "Release date: oldest" },
  { value: "added_desc", label: "Date added: newest" },
  { value: "added_asc", label: "Date added: oldest" },
  { value: "list_order", label: "Manual list order" }
];

export function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
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
  const [libraryKindFilter, setLibraryKindFilter] = useState<MediaKindFilter>("both");
  const [listGroup, setListGroup] = useState<ListGroup>("none");
  const [libraryLists, setLibraryLists] = useState<UserList[]>([]);
  const [librarySavedTitleCount, setLibrarySavedTitleCount] = useState<number | null>(null);
  const [librarySavedKindCounts, setLibrarySavedKindCounts] = useState<MediaKindCounts | null>(null);
  const [librarySectionKindCounts, setLibrarySectionKindCounts] = useState<{ filter: LibraryFilter; counts: MediaKindCounts } | null>(null);
  const [libraryListCount, setLibraryListCount] = useState<number | null>(null);
  const [calendarMode, setCalendarMode] = useState<CalendarMode>("upcoming");
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const [calendarMonth, setCalendarMonth] = useState(() => monthKey(new Date()));
  const [calendarWeek, setCalendarWeek] = useState(() => weekStartKey(new Date()));
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [profileView, setProfileView] = useState<ProfileView>("profile");
  const [historyFocusDate, setHistoryFocusDate] = useState("");
  const [featureView, setFeatureView] = useState<FeatureView>(null);
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
  const [notificationOpening, setNotificationOpening] = useState(false);
  const [error, setError] = useState("");
  const [heroIndex, setHeroIndex] = useState(0);
  const [headerUnread, setHeaderUnread] = useState(false);

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
  const selectedListIdRef = useRef<string | null>(null);
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
  const floatingHeaderY = useRef(new Animated.Value(0)).current;
  const floatingHeaderVisible = useRef(false);
  const lastRootScrollY = useRef(0);
  const rootScrollDirection = useRef<"up" | "down" | null>(null);
  const rootScrollTravel = useRef(0);
  const usableSession = mfa.required || authVerifying ? null : session;
  const rootHeaderActive = !featureView && !searchMode && !selectedList && !selectedEntity && !selectedEpisode && !selectedSeriesEpisodes && !selectedSeason && !selected;

  const openNotificationHref = useCallback(async (rawHref: string) => {
    let href = rawHref;
    try {
      if (!href.startsWith("/")) href = new URL(href).pathname;
    } catch {
      throw new Error("This notification has an invalid destination.");
    }
    const episodeMatch = href.match(/^\/title\/show\/(\d+)\/season\/(\d+)\/episode\/(\d+)(?:\/|$)/);
    const seasonMatch = href.match(/^\/title\/show\/(\d+)\/season\/(\d+)(?:\/|$)/);
    const titleMatch = href.match(/^\/title\/(movie|show)\/(\d+)(?:\/|$)/);
    if (!episodeMatch && !seasonMatch && !titleMatch) throw new Error("This notification destination is not supported in the app yet.");

    setNotificationOpening(true);
    setActionItem(null);
    setSelected(null);
    setSelectedStack([]);
    setSelectedEntity(null);
    setSelectedEpisode(null);
    setSelectedSeason(null);
    setSelectedSeriesEpisodes(null);
    selectedListIdRef.current = null;
    setSelectedList(null);
    setSearchMode(false);
    setFeatureView(null);
    try {
      if (episodeMatch) {
        const showId = Number(episodeMatch[1]);
        const seasonNumber = Number(episodeMatch[2]);
        const episodeNumber = Number(episodeMatch[3]);
        const payload = await fetchMobileEpisode(showId, seasonNumber, episodeNumber, usableSession?.access_token);
        const episode = payload.episode ?? {};
        setSelectedEpisode({
          episodeId: payload.episodeId ?? undefined,
          show: payload.show,
          seasonNumber,
          episodeNumber,
          title: episode.name,
          overview: episode.overview,
          airDate: episode.air_date ?? episode.airDate,
          artwork: episode.still_path ?? episode.stillPath,
          runtime: episode.runtime,
          voteAverage: episode.vote_average ?? episode.voteAverage
        });
        return;
      }
      if (seasonMatch) {
        const showId = Number(seasonMatch[1]);
        const seasonNumber = Number(seasonMatch[2]);
        const payload = await fetchMobileSeason(showId, seasonNumber, usableSession?.access_token);
        const season = payload.season ?? {};
        setSelectedSeason({
          show: payload.show,
          season: {
            id: season.id,
            seasonNumber: Number(season.seasonNumber ?? season.season_number ?? seasonNumber),
            name: season.name || `Season ${seasonNumber}`,
            overview: season.overview ?? null,
            posterPath: season.posterPath ?? season.poster_path ?? null,
            airDate: season.airDate ?? season.air_date ?? null,
            episodeCount: season.episodeCount ?? season.episode_count ?? payload.episodes?.length ?? null
          }
        });
        return;
      }
      const kind = titleMatch![1] as MediaSummary["kind"];
      const id = Number(titleMatch![2]);
      const payload = await fetchMobileTitle(kind, id, usableSession?.access_token, "core");
      setSelected(payload.item);
    } finally {
      setNotificationOpening(false);
    }
  }, [usableSession?.access_token]);

  const setFloatingHeader = useCallback((visible: boolean) => {
    if (floatingHeaderVisible.current === visible) return;
    floatingHeaderVisible.current = visible;
    Animated.timing(floatingHeaderY, {
      toValue: visible ? 0 : -96,
      duration: visible ? 180 : 140,
      useNativeDriver: true
    }).start();
  }, [floatingHeaderY]);

  const handleRootScroll = useCallback((event: any) => {
    const y = Math.max(0, Number(event.nativeEvent?.contentOffset?.y ?? 0));
    const delta = y - lastRootScrollY.current;
    const direction = delta > 0 ? "down" : delta < 0 ? "up" : rootScrollDirection.current;
    if (direction !== rootScrollDirection.current) {
      rootScrollDirection.current = direction;
      rootScrollTravel.current = 0;
    }
    rootScrollTravel.current += Math.abs(delta);
    if (y < 96) {
      rootScrollTravel.current = 0;
      setFloatingHeader(true);
    } else if (direction === "up" && rootScrollTravel.current >= 12) {
      rootScrollTravel.current = 0;
      setFloatingHeader(true);
    } else if (direction === "down" && rootScrollTravel.current >= 18) {
      rootScrollTravel.current = 0;
      setFloatingHeader(false);
    }
    lastRootScrollY.current = y;
  }, [setFloatingHeader]);

  useEffect(() => {
    lastRootScrollY.current = 0;
    rootScrollDirection.current = null;
    rootScrollTravel.current = 0;
    setFloatingHeader(rootHeaderActive);
  }, [profileView, rootHeaderActive, setFloatingHeader, tab]);


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
    selectedListIdRef.current = null;
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
    selectedListIdRef.current = null;
    setSelectedList(null);
    setSearchMode(false);
    setFeatureView(null);
    setProfileView(next);
    setTab("profile");
    scrollToTop();
  }, [scrollToTop]);

  const openHistoryView = useCallback((date = "") => {
    setHistoryFocusDate(date);
    openProfileView("history");
  }, [openProfileView]);

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
    const storageKey = `last-notification-response:${usableSession?.user.id ?? "guest"}`;
    const handleResponse = async (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      const href = data?.href;
      if (typeof href !== "string") return;
      const responseKey = String(response.notification.request.identifier || data?.releaseKey || href);
      const previous = await AsyncStorage.getItem(storageKey).catch(() => null);
      if (previous === responseKey) return;
      await AsyncStorage.setItem(storageKey, responseKey).catch(() => undefined);
      const releaseKey = data?.releaseKey;
      if (usableSession?.access_token && typeof releaseKey === "string") {
        void dismissMobileNotifications(usableSession.access_token, { releaseKey }).catch(() => undefined);
      }
      try {
        await openNotificationHref(href);
      } catch (reason) {
        setNotificationOpening(false);
        Alert.alert("Could not open notification", reason instanceof Error ? reason.message : "Try again.");
      }
    };
    const receivedSubscription = Notifications.addNotificationReceivedListener(() => {
      setHeaderUnread(true);
    });
    const subscription = Notifications.addNotificationResponseReceivedListener(response => { void handleResponse(response); });
    void Notifications.getLastNotificationResponseAsync().then(response => { if (response) void handleResponse(response); });
    return () => {
      receivedSubscription.remove();
      subscription.remove();
    };
  }, [openNotificationHref, usableSession?.access_token, usableSession?.user.id]);

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
        await Promise.all(Array.from({ length: Math.min(1, queue.length) }, worker));
      })();
    }, 1600);

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
    selectedListIdRef.current = list.id;
    setSelectedList(list);
    setListGroup("none");
    setListSort("title_asc");
    setLoading(true);
    try {
      const feed = await loadListFeed(list.id, usableSession?.user.id);
      setSelectedListFeed(feed);
      if (usableSession?.access_token) {
        void hydrateListFranchiseCollections(list.id, feed, usableSession.access_token).then(hydrated => {
          if (selectedListIdRef.current === list.id) setSelectedListFeed(hydrated);
        }).catch(() => undefined);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open this list.");
    } finally {
      setLoading(false);
    }
  }, [usableSession?.access_token, usableSession?.user.id]);

  const loadLibrary = useCallback(async (force = false) => {
    if (!usableSession?.user.id || !supabase) {
      setLibraryFeed(emptyFeed);
      setLibraryLists([]);
      setLibrarySavedTitleCount(null);
      setLibrarySavedKindCounts(null);
      setLibrarySectionKindCounts(null);
      setLibraryListCount(null);
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
          const value = JSON.parse(cached) as { feed: FeedResult; lists: UserList[]; savedTitleCount?: number; savedKindCounts?: MediaKindCounts; sectionKindCounts?: MediaKindCounts; listCount?: number; savedAt: number };
          setLibraryFeed(value.feed ?? emptyFeed);
          setLibraryLists(value.lists ?? []);
          setLibrarySavedTitleCount(typeof value.savedTitleCount === "number" ? value.savedTitleCount : null);
          setLibrarySavedKindCounts(value.savedKindCounts ?? null);
          setLibrarySectionKindCounts(value.sectionKindCounts ? { filter: libraryFilter, counts: value.sectionKindCounts } : null);
          setLibraryListCount(typeof value.listCount === "number" ? value.listCount : null);
          libraryLoadedKey.current = cacheKey;
          libraryLoadedAt.current = value.savedAt || Date.now();
          void loadLibrary(true).catch(() => undefined);
          return;
        } catch { /* Ignore an old cache shape. */ }
      }
    }
    const savedTitleCountsPromise = loadTrackedLibraryTitleCounts(usableSession.user.id);
    if (libraryFilter === "lists") {
      const [lists, savedTitleCounts] = await Promise.all([loadUserLists(usableSession.user.id), savedTitleCountsPromise]);
      const savedTitleCount = savedTitleCounts.total;
      setLibraryLists(lists);
      setLibrarySavedTitleCount(savedTitleCount);
      setLibrarySavedKindCounts(savedTitleCounts);
      setLibrarySectionKindCounts(null);
      setLibraryListCount(lists.length);
      setProfileData(current => ({ ...current, trackedLibraryTitles: savedTitleCount, listCount: lists.length, lists }));
      setLibraryFeed(emptyFeed);
      libraryLoadedKey.current = cacheKey;
      libraryLoadedAt.current = Date.now();
      await AsyncStorage.setItem(storageKey, JSON.stringify({ feed: emptyFeed, lists, savedTitleCount, savedKindCounts: savedTitleCounts, sectionKindCounts: null, listCount: lists.length, savedAt: libraryLoadedAt.current })).catch(() => undefined);
      return;
    }
    const mediaSelect = "id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,genres,original_language,origin_countries";
    const sectionSummaryPromise = loadLibrarySectionSummary(usableSession.user.id, libraryFilter);
    const sourceResult = libraryFilter === "favorites"
      ? await supabase.from("favorites").select(`media(${mediaSelect})`).eq("user_id", usableSession.user.id).order("position").limit(120)
      : await (() => {
        let query = supabase.from("progress").select(`status,completed_at,started_at,updated_at,media(${mediaSelect})`).eq("user_id", usableSession.user.id);
        if (libraryFilter === "watching") query = query.in("status", ["watching", "completed"]);
        else if (libraryFilter !== "all") query = query.eq("status", libraryFilter);
        return query.order("updated_at", { ascending: false }).limit(120);
      })();
    if (sourceResult.error) throw sourceResult.error;
    const [savedTitleCounts, sectionSummary] = await Promise.all([savedTitleCountsPromise, sectionSummaryPromise]);
    const savedTitleCount = savedTitleCounts.total;
    const activeRewatchIds = sectionSummary.activeRewatchIds;
    const sourceRows = libraryFilter === "watching"
      ? (sourceResult.data ?? []).filter((row: any) => row.status === "watching" || activeRewatchIds.has(Number(firstRow(row.media)?.id)))
      : (sourceResult.data ?? []);
    const mediaRows = sourceRows.flatMap((row: any) => {
      const media = firstRow(row.media);
      return media?.id ? [media] : [];
    });
    const mediaIds = mediaRows.map((media: any) => Number(media.id));
    const ratingResult = mediaIds.length ? await supabase.from("ratings").select("score,media_id").eq("user_id", usableSession.user.id).in("media_id", mediaIds) : { data: [] as any[] };
    const ratingByMedia = new Map((ratingResult.data ?? []).map((row: any) => [row.media_id, Number(row.score)]));
    const items = dedupeMedia(sourceRows.flatMap((row: any) => {
      const media = firstRow(row.media);
      if (!media) return [];
      const activeRewatch = activeRewatchIds.has(Number(media.id));
      return [{ ...fromDbMedia(media, ratingByMedia), listMediaId: Number(media.id), activeRewatch, reason: libraryFilter === "favorites" ? "Favorite" : activeRewatch ? "Rewatching" : progressLabel(row.status) }];
    }));
    const sectionKindCounts = sectionSummary.counts;
    setLibraryLists([]);
    setLibrarySavedTitleCount(savedTitleCount);
    setLibrarySavedKindCounts(savedTitleCounts);
    setLibrarySectionKindCounts({ filter: libraryFilter, counts: sectionKindCounts });
    setProfileData(current => ({ ...current, trackedLibraryTitles: savedTitleCount }));
    const feed = { items };
    setLibraryFeed(feed);
    libraryLoadedKey.current = cacheKey;
    libraryLoadedAt.current = Date.now();
    await AsyncStorage.setItem(storageKey, JSON.stringify({ feed, lists: [], savedTitleCount, savedKindCounts: savedTitleCounts, sectionKindCounts, savedAt: libraryLoadedAt.current })).catch(() => undefined);
  }, [libraryFilter, usableSession?.access_token, usableSession?.user.id]);

  const loadCalendar = useCallback(async () => {
    if (!usableSession?.user.id || !supabase) {
      setCalendarEvents([]);
      setCalendarFeed(emptyFeed);
      return;
    }
    const { start, end } = calendarView === "week" ? weekBounds(calendarWeek) : monthBounds(calendarMonth);
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
  }, [calendarMode, calendarMonth, calendarView, calendarWeek, usableSession?.user.id]);

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
    const trackedLibraryTitlesPromise = loadTrackedLibraryTitleCount(userId).catch(() => 0);
    try {
      const [serverProfile, trackedLibraryTitles] = await Promise.all([fetchMobileProfile(accessToken), trackedLibraryTitlesPromise]);
      const normalized = normalizeProfileDataTimes({ ...(serverProfile as ProfileData), trackedLibraryTitles });
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
      supabase.from("ratings").select("score,media_id,episode_id").eq("user_id", userId),
      supabase.from("reviews").select(profileReviewSelect).eq("user_id", userId).order("updated_at", { ascending: false }).limit(500),
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
    const ratingByMedia = new Map((ratingsRows as any[]).filter(row => row.episode_id == null).map(row => [row.media_id, Number(row.score)]));
    const ratingByEpisode = new Map((ratingsRows as any[]).filter(row => row.episode_id != null).map(row => [Number(row.episode_id), Number(row.score)]));
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
        rating: episode ? ratingByEpisode.get(Number(event.episode_id ?? episode.id)) ?? null : ratingByMedia.get(media.id) ?? null,
        rewatchNumber: Math.max(0, watchNumber - 1),
        item: fromDbMedia(media, ratingByMedia),
        episodeTarget: episode ? { show: fromDbMedia(media, ratingByMedia), episodeId: Number(event.episode_id ?? episode.id), seasonNumber: Number(season?.season_number ?? 1), episodeNumber: Number(episode.episode_number), title: episode.name, artwork: episode.still_path ?? media.backdrop_path ?? media.poster_path ?? null } : null
      }];
    });
    const reviewItems = (reviews.data ?? []).flatMap((review: any) => mapProfileReview(review, ratingByMedia));
    const nextProfileData: ProfileData = {
      followers: followers.count ?? 0,
      following: following.count ?? 0,
      tracked: completedStatusCount,
      trackedLibraryTitles: await trackedLibraryTitlesPromise,
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
    const alreadyVisible = tab === "home"
      ? Boolean(homeHero.length || homeSections.length)
      : tab === "library"
        ? Boolean(libraryFeed.items.length || libraryLists.length)
        : tab === "profile"
          ? Boolean(profileData.watchEvents || profileData.currentlyWatching.length)
          : false;
    setLoading(!alreadyVisible);
    loadActive()
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "Could not load MovieTracker."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [homeHero.length, homeSections.length, libraryFeed.items.length, libraryLists.length, loadActive, profileData.currentlyWatching.length, profileData.watchEvents, tab]);

  useEffect(() => {
    scrollToTop();
  }, [libraryFilter, profileView, searchMode, selectedList?.id, tab, scrollToTop]);

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
      if (selectedList) { selectedListIdRef.current = null; setSelectedList(null); setSelectedListFeed(emptyFeed); return true; }
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
        const [nextLists, trackedLibraryTitles] = await Promise.all([loadUserLists(usableSession.user.id), loadTrackedLibraryTitleCount(usableSession.user.id).catch(() => null)]);
        setProfileData(current => ({ ...current, lists: nextLists, listCount: nextLists.length, trackedLibraryTitles: trackedLibraryTitles ?? current.trackedLibraryTitles }));
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
    if (tab === "library") void loadLibrary(false).catch(() => undefined);
    if (tab === "calendar") void loadCalendar().catch(() => undefined);
  }, [libraryFilter, loadCalendar, loadLibrary, loadProfileData, selectedList?.id, tab, usableSession?.access_token, usableSession?.user.id]);

  const activeFeed = featureView ? emptyFeed : searchMode ? searchFeed : selectedList ? selectedListFeed : tab === "discover" ? discoverFeed : tab === "calendar" ? calendarFeed : tab === "library" ? libraryFeed : tab === "profile" && profileView === "recommendations" ? recommendationFeed : emptyFeed;
  useEffect(() => {
    const items = activeFeed.items.slice(0, 5);
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
        await Promise.all(Array.from({ length: Math.min(1, queue.length) }, worker));
      })();
    }, 1200);
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

  async function removeHistoryEvent(eventId: string, title: string, onResult?: (success: boolean) => void) {
    if (!usableSession?.user.id || !supabase) {
      onResult?.(false);
      return;
    }
    Alert.alert("Remove watch?", `Remove this ${title} watch from your history?`, [
      { text: "Cancel", style: "cancel", onPress: () => onResult?.(false) },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteMobileHistoryEvent(usableSession.access_token, eventId);
            libraryLoadedKey.current = null;
            libraryLoadedAt.current = 0;
            onResult?.(true);
            await Promise.all([loadProfileData(true), tab === "library" ? loadLibrary(true) : Promise.resolve()]);
          } catch (reason) {
            onResult?.(false);
            Alert.alert("Could not remove watch", reason instanceof Error ? reason.message : "Try again.");
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

  function openReviewItem(review: ReviewItem) {
    setSelected(null);
    setSelectedStack([]);
    setSelectedEntity(null);
    setSelectedSeriesEpisodes(null);
    if (review.episodeTarget) {
      setSelectedSeason(null);
      setSelectedEpisode(review.episodeTarget);
      return;
    }
    if (review.seasonTarget) {
      setSelectedEpisode(null);
      setSelectedSeason(review.seasonTarget);
      return;
    }
    if (review.item) openItem(review.item);
  }

  function openUpNextEntry(entry: UpNextEntry) {
    const episodeTarget = episodeTargetForUpNext(entry);
    if (episodeTarget) {
      setSelected(null);
      setSelectedStack([]);
      setSelectedEntity(null);
      setSelectedSeason(null);
      setSelectedSeriesEpisodes(null);
      setSelectedEpisode(episodeTarget);
      return;
    }
    openItem(entry.item);
  }

  const selectedListFranchiseGroups = useMemo(() => availableListFranchiseGroups(selectedListFeed.items), [selectedListFeed.items]);
  const visibleSelectedListItems = useMemo(() => filterByMediaKind(selectedListFeed.items, libraryKindFilter, item => item.kind), [libraryKindFilter, selectedListFeed.items]);
  const sortedSelectedListItems = useMemo(() => sortListItems(visibleSelectedListItems, listSort), [listSort, visibleSelectedListItems]);
  const visibleActiveFeedItems = useMemo(() => tab === "library" && libraryFilter !== "lists" ? filterByMediaKind(activeFeed.items, libraryKindFilter, item => item.kind) : activeFeed.items, [activeFeed.items, libraryFilter, libraryKindFilter, tab]);
  const librarySummary = useMemo(() => {
    if (libraryFilter === "lists") return null;
    const counts = libraryFilter === "all"
      ? librarySavedKindCounts
      : librarySectionKindCounts?.filter === libraryFilter ? librarySectionKindCounts.counts : null;
    const value = counts
      ? libraryKindFilter === "movie" ? counts.movie : libraryKindFilter === "show" ? counts.show : counts.total
      : libraryFilter === "all"
        ? libraryKindFilter === "both" ? librarySavedTitleCount ?? profileData.trackedLibraryTitles : "…"
        : "…";
    return librarySummaryContent(libraryFilter, libraryKindFilter, value);
  }, [libraryFilter, libraryKindFilter, librarySavedKindCounts, librarySavedTitleCount, librarySectionKindCounts, profileData.trackedLibraryTitles]);

  function renderHeader() {
    if (featureView === "tonight") {
      return <><AppHeader session={headerSession} hasUnreadNotifications={headerUnread} onUnreadChange={setHeaderUnread} onHome={() => goTab("home")} onSearch={() => setSearchMode(true)} onNotifications={() => openProfileView("notifications")} onProfile={() => openProfileView("profile")} /><TonightScreen token={usableSession?.access_token} onBack={() => setFeatureView(null)} onOpen={openItem} /></>;
    }
    if (featureView === "up-next") {
      return <><AppHeader session={headerSession} hasUnreadNotifications={headerUnread} onUnreadChange={setHeaderUnread} onHome={() => goTab("home")} onSearch={() => setSearchMode(true)} onNotifications={() => openProfileView("notifications")} onProfile={() => openProfileView("profile")} />{usableSession ? <UpNextScreen token={usableSession.access_token} onBack={() => setFeatureView(null)} onOpen={openUpNextEntry} /> : <><SectionTitle kicker="Your unfinished viewing" title="Up Next" action="Back" onAction={() => setFeatureView(null)} /><EmptyPanel title="Sign in for Up Next" body="Your unfinished episodes and evening queue are private to your account." /></>}</>;
    }
    if (searchMode) {
      return (
        <>
          <AppHeader session={headerSession} hasUnreadNotifications={headerUnread} onUnreadChange={setHeaderUnread} onHome={() => goTab("home")} onSearch={() => undefined} onNotifications={() => openProfileView("notifications")} onProfile={() => { setSearchMode(false); openProfileView("profile"); }} />
          <SectionTitle kicker="Across films and television" title="Search" action="Close" onAction={() => { setSearchMode(false); setSearchFeed(emptyFeed); }} />
          <SearchPanel query={searchQuery} onQuery={setSearchQuery} onSearch={() => loadSearch()} onClear={() => { setSearchQuery(""); setSearchFeed(emptyFeed); }} />
          {searchLoading ? <View style={styles.searchResultsLoading}><ActivityIndicator color={colors.accent} /><Text style={styles.searchResultsLoadingText}>Searching titles and people...</Text></View> : null}
        </>
      );
    }
    if (selectedList) {
      return (
        <>
          <AppHeader session={headerSession} hasUnreadNotifications={headerUnread} onUnreadChange={setHeaderUnread} onHome={() => goTab("home")} onSearch={() => setSearchMode(true)} onNotifications={() => openProfileView("notifications")} onProfile={() => { selectedListIdRef.current = null; setSelectedList(null); openProfileView("profile"); }} />
          <ListDetailHeader
            list={selectedList}
            loadedCount={selectedListFeed.items.length}
            sort={listSort}
            groupBy={listGroup}
            kindFilter={libraryKindFilter}
            onSort={() => setPicker({ title: "Sort titles", value: listSort, options: listSortOptions, onPick: value => { setListSort(value as ListSort); setListGroup("none"); } })}
            onGroupBy={value => { setListGroup(value); setListSort(value === "collections" ? "none" : "list_order"); }}
            onKindFilter={setLibraryKindFilter}
            onBack={() => {
              selectedListIdRef.current = null;
              setSelectedList(null);
              setSelectedListFeed(emptyFeed);
              setListGroup("none");
              setListSort("title_asc");
              setLibraryFilter("lists");
              setProfileView("profile");
              goTab("library");
            }} />
          {listGroup === "collections" ? visibleSelectedListItems.length ? <GroupedListContent groups={groupedListItems(visibleSelectedListItems, listGroup)} onOpen={openItem} onMenu={setActionItem} /> : <EmptyPanel title={`No ${libraryKindFilter === "movie" ? "movies" : "shows"} in this list`} body="Choose Both to see every title without changing the list." /> : null}
        </>
      );
    }
    return (
      <>
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
              <CalendarPanel mode={calendarMode} view={calendarView} month={calendarMonth} week={calendarWeek} events={calendarEvents} onMode={setCalendarMode} onView={nextView => {
                if (nextView === "week") {
                  const anchor = calendarMonth === monthKey(new Date()) ? new Date() : new Date(`${calendarMonth}-01T12:00:00Z`);
                  setCalendarWeek(weekStartKey(anchor));
                } else {
                  setCalendarMonth(calendarWeekDays(calendarWeek)[3].slice(0, 7));
                }
                setCalendarView(nextView);
              }} onMonth={setCalendarMonth} onWeek={setCalendarWeek} onOpen={openCalendarEvent} onMenu={setActionItem} />
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
                {librarySummary ? <ProfileDestinationTotal icon={librarySummary.icon} value={librarySummary.value} label={librarySummary.label} detail={librarySummary.detail} /> : null}
                {libraryFilter === "lists" ? <ProfileDestinationTotal icon="list-outline" value={libraryListCount ?? (profileData.listCount || "…")} label="custom lists" detail="Every list you created" /> : null}
                <LibraryFilters value={libraryFilter} onChange={setLibraryFilter} />
                {libraryFilter !== "lists" ? <MediaKindFilterControl value={libraryKindFilter} onChange={setLibraryKindFilter} /> : null}
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
              <SettingsScreen session={usableSession} profile={profile} tab={settingsTab} onScheduleNotifications={scheduleEpisodeNotifications} onTab={setSettingsTab} onBack={() => openProfileView("profile")} onSignOut={signOut} onSaved={async () => { await Promise.all([loadProfileInfo(), loadProfileData()]); }} />
            ) : usableSession && profileView === "recommendations" ? (
              <>
                <SectionTitle kicker="Calculated from your actual taste" title="For you" action="Back to profile ->" onAction={() => openProfileView("profile")} />
                <Text style={styles.recommendationIntro}>Personal picks shaped by your ratings, favorites, watch history and Trakt activity.</Text>
                <RecommendationFiltersCard filters={recommendationFilters} onChange={setRecommendationFilters} onSelect={pickerHelpers.recommendations} onRefresh={refreshPicks} />
                <View style={styles.afterFilters} />
              </>
            ) : usableSession && profileView === "notifications" ? (
              <NotificationScreen session={usableSession} onBack={() => openProfileView("profile")} onOpenHref={openNotificationHref} />
            ) : usableSession && profileView === "journal" ? (
              <FullJournalPage userId={usableSession.user.id} onBack={() => openProfileView("profile")} onOpenTitle={openItem} onOpenSeason={(show, season) => setSelectedSeason({ show, season })} onOpenEpisode={setSelectedEpisode} onOpenHistoryDate={openHistoryView} />
            ) : usableSession && profileView === "history" ? (
              <FullHistoryPage data={profileData} token={usableSession.access_token} focusDate={historyFocusDate} onClearFocus={() => setHistoryFocusDate("")} onOpen={openHistoryItem} onMenu={setActionItem} onBack={() => openProfileView("profile")} onRemove={removeHistoryEvent} onScrollTop={scrollToTop} />
            ) : usableSession && profileView === "reviews" ? (
              <FullReviewsPage reviews={profileData.reviews} count={profileData.reviewCount} token={usableSession.access_token} onBack={() => openProfileView("profile")} onOpen={openReviewItem} onScrollTop={scrollToTop} />
            ) : usableSession && profileView === "statistics" ? (
              <StatisticsPage data={profileData} onBack={() => openProfileView("profile")} onWrapped={() => openProfileView("wrapped")} onOpen={openItem} onGenreShelf={offset => setTimeout(() => listRef.current?.scrollToOffset({ offset, animated: true }), 80)} />
            ) : usableSession && profileView === "wrapped" ? (
              <WrappedScreen token={usableSession.access_token} onBack={() => openProfileView("statistics")} />
            ) : usableSession ? (
              <>
                <ProfileHero profile={profile} session={usableSession} data={profileData} fallbackName={profileTitle} onSettings={() => { setSettingsTab("profile"); openProfileView("settings"); }} />
                <ProfileNav onChange={next => {
                  if (next === "journal") openProfileView("journal");
                  else if (next === "history") openHistoryView();
                  else if (next === "reviews") openProfileView("reviews");
                  else if (next === "statistics") openProfileView("statistics");
                }} />
                <ProfileStatBand data={profileData} onNavigate={target => {
                  if (target === "library") { setLibraryFilter("all"); goTab("library"); }
                  if (target === "history") openHistoryView();
                  if (target === "reviews") openProfileView("reviews");
                  if (target === "statistics") openProfileView("statistics");
                  if (target === "lists") { setLibraryFilter("lists"); goTab("library"); }
                }} />
                <ProfileHistorySection items={profileData.history} onOpen={openHistoryItem} onMenu={setActionItem} onHistory={() => openHistoryView()} />
                <ProfileProgressSection data={profileData} onLibrary={() => { setLibraryFilter("all"); goTab("library"); }} onStatus={status => { setLibraryFilter(status === "active" ? "watching" : status); goTab("library"); }} onWatching={() => { setLibraryFilter("watching"); goTab("library"); }} onOpen={openItem} onMenu={setActionItem} />
                <ReviewSection reviews={profileData.reviews} onAll={() => openProfileView("reviews")} onOpen={openReviewItem} />
                <ProfileMediaSection kicker="Personal canon" title="Favorites" action="See all favorites ->" items={profileData.favorites.slice(0, 6)} onAction={() => { setLibraryFilter("favorites"); goTab("library"); }} onOpen={openItem} onMenu={setActionItem} /><ProfileListsSection owner={profile?.display_name || profile?.username || "you"} lists={profileData.lists} onOpenLists={() => { setLibraryFilter("lists"); goTab("library"); }} onOpenList={openList} />
                <ProfileShortcuts onCalendar={() => goTab("calendar")} onHistory={() => openHistoryView()} onReviews={() => openProfileView("reviews")} onSettings={() => openProfileView("settings")} />
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
          <EpisodeDetailScreen target={selectedEpisode} session={usableSession} onBack={() => setSelectedEpisode(null)} onOpen={openItem} onOpenEntity={openEntity} onChanged={refreshAfterAction} onOpenHistoryDate={openHistoryView} onOpenSeason={(season, show, seasons) => {
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
          <SeasonDetailScreen target={selectedSeason} session={usableSession} onBack={() => setSelectedSeason(null)} onOpenHistoryDate={openHistoryView} onOpenEpisode={episode => setSelectedEpisode({
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
          <DetailScreenV2 key={`${selected.kind}-${selected.id}`} item={selected} session={usableSession} onBack={closeSelected} onOpen={openItem} onOpenEntity={openEntity} onOpenSeason={season => setSelectedSeason({ show: selected, season })} onOpenAllSeasons={seasons => setSelectedSeriesEpisodes({ show: selected, seasons })} onHide={hideRecommendation} onChanged={refreshAfterAction} onOpenHistoryDate={openHistoryView} />
        ) : selectedList && listGroup === "collections" ? (
          <ScrollView contentContainerStyle={styles.listContent} onScroll={handleRootScroll} scrollEventThrottle={16} refreshControl={<RefreshControl tintColor={colors.accent} refreshing={refreshing} onRefresh={refresh} />}>{listHeader}</ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={selectedList && listGroup === "none" ? sortedSelectedListItems : selectedList ? [] : visibleActiveFeedItems}
            keyExtractor={(item, index) => `${item.kind}-${item.id}-${item.reason ?? index}`}
            numColumns={2}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={!loading && !featureView ? (selectedList && listGroup === "none" ? <EmptyPanel title={libraryKindFilter === "both" ? "No titles in this list yet" : `No ${libraryKindFilter === "movie" ? "movies" : "shows"} in this list`} body={libraryKindFilter === "both" ? "Add titles from search, discovery, or a title page." : "Choose Both to see every title without changing the list."} /> : !selectedList && tab !== "home" && tab !== "calendar" && !(tab === "library" && libraryFilter === "lists" && !selectedList) && !(tab === "profile" && (profileView !== "recommendations" || !usableSession || mfa.required)) ? <EmptyPanel title={tab === "library" && libraryKindFilter !== "both" ? `No ${libraryKindFilter === "movie" ? "movies" : "shows"} here` : "Nothing loaded yet"} body={tab === "library" && libraryKindFilter !== "both" ? "Choose Both to see every title in this section." : searchMode ? "Search for a title, person, or keyword." : emptyText(tab, Boolean(usableSession))} /> : null) : null}
            contentContainerStyle={[styles.listContent, rootHeaderActive && styles.listContentWithHeader]}
            columnWrapperStyle={styles.columns}
            refreshControl={<RefreshControl tintColor={colors.accent} refreshing={refreshing} onRefresh={refresh} />}
            renderItem={({ item }) => <TitleCard item={item} onOpen={openItem} onMenu={setActionItem} />}
            onEndReached={loadMoreActive}
            onEndReachedThreshold={0.75}
            onScroll={handleRootScroll}
            scrollEventThrottle={16}
            ListFooterComponent={!featureView && loadingMore ? <View style={styles.feedFooter}><ActivityIndicator color={colors.accent} /><Text style={styles.feedFooterText}>Loading more titles...</Text></View> : null}
          />
        )}
      </KeyboardAvoidingView>
      {rootHeaderActive ? <Animated.View style={[styles.floatingHeader, { transform: [{ translateY: floatingHeaderY }] }]}><AppHeader session={headerSession} hasUnreadNotifications={headerUnread} onUnreadChange={setHeaderUnread} onHome={() => goTab("home")} onSearch={() => setSearchMode(true)} onNotifications={() => openProfileView("notifications")} onProfile={() => openProfileView("profile")} /></Animated.View> : null}
      {loading ? <View pointerEvents="none" style={styles.loading}><ActivityIndicator color={colors.accent} size="large" /></View> : null}
      <BottomNav tab={tab} onTab={goTab} />
      {notificationOpening ? <View style={styles.notificationRouteLoading}><ActivityIndicator color={colors.accent} size="large" /><Text style={styles.notificationRouteLoadingText}>Opening notification…</Text></View> : null}
      <PickerSheet title={picker?.title ?? ""} visible={Boolean(picker)} options={picker?.options ?? []} value={picker?.value ?? ""} multiValues={picker?.multiValues} anchor={picker?.anchor} onPick={value => picker?.onPick(value)} onApply={values => picker?.onApply?.(values)} onClose={() => setPicker(null)} />
      <MovieActionSheet item={actionItem} visible={Boolean(actionItem)} session={usableSession} currentList={selectedList} franchiseGroups={selectedListFranchiseGroups} allowNotInterested={tab === "profile" && profileView === "recommendations" && !selectedList && !selected} onClose={() => setActionItem(null)} onOpen={openItem} onNotInterested={hideRecommendation} onChanged={refreshAfterAction} />
    </SafeAreaView>
  );
}

function ListDetailHeader({ list, loadedCount, sort, groupBy, kindFilter, onSort, onGroupBy, onKindFilter, onBack }: { list: UserList; loadedCount?: number; sort: ListSort; groupBy: ListGroup; kindFilter: MediaKindFilter; onSort: () => void; onGroupBy: (value: ListGroup) => void; onKindFilter: (value: MediaKindFilter) => void; onBack: () => void }) {
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
      <MediaKindFilterControl value={kindFilter} onChange={onKindFilter} inline />
    </View>
  );
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

async function loadPagedRows<T>(loadPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const pageSize = 500;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

async function loadLibrarySectionSummary(userId: string, filter: Exclude<LibraryFilter, "lists">): Promise<{ counts: MediaKindCounts; activeRewatchIds: Set<number> }> {
  const client = supabase;
  if (!client) return { counts: { total: 0, movie: 0, show: 0 }, activeRewatchIds: new Set<number>() };
  if (filter === "all") return { counts: { total: 0, movie: 0, show: 0 }, activeRewatchIds: new Set<number>() };
  if (filter === "favorites") {
    const rows = await loadPagedRows<any>(async (from, to) => client.from("favorites").select("media(id,kind)").eq("user_id", userId).order("position").range(from, to));
    const items = rows.flatMap(row => {
      const media = firstRow(row.media);
      return media?.kind ? [{ kind: media.kind as MediaKind }] : [];
    });
    return { counts: countMediaKinds(items), activeRewatchIds: new Set<number>() };
  }
  const rows = await loadPagedRows<any>(async (from, to) => {
    let query = client.from("progress").select("status,completed_at,started_at,media(id,kind)").eq("user_id", userId);
    if (filter === "watching") query = query.in("status", ["watching", "completed"]);
    else query = query.eq("status", filter);
    return query.order("updated_at", { ascending: false }).range(from, to);
  });
  const activeRewatchIds = filter === "watching" ? await loadMobileActiveRewatchIds(userId, rows) : new Set<number>();
  const visibleRows = filter === "watching"
    ? rows.filter(row => row.status === "watching" || activeRewatchIds.has(Number(firstRow(row.media)?.id)))
    : rows;
  const items = visibleRows.flatMap(row => {
    const media = firstRow(row.media);
    return media?.kind ? [{ kind: media.kind as MediaKind }] : [];
  });
  return { counts: countMediaKinds(items), activeRewatchIds };
}

function countMediaKinds(items: Array<Pick<MediaSummary, "kind">>): MediaKindCounts {
  return {
    total: items.length,
    movie: items.filter(item => item.kind === "movie").length,
    show: items.filter(item => item.kind === "show").length
  };
}

function librarySummaryContent(filter: Exclude<LibraryFilter, "lists">, kind: MediaKindFilter, value: number | string) {
  const format = kind === "movie" ? "movies" : kind === "show" ? "shows" : "titles";
  if (filter === "all") return { icon: "bookmark-outline" as const, value, label: `unique saved ${format}`, detail: "Across your watchlist, favorites, and custom lists" };
  if (filter === "planned") return { icon: "bookmark-outline" as const, value, label: `${format} in watchlist`, detail: "Saved to watch later" };
  if (filter === "watching") return { icon: "eye-outline" as const, value, label: `${format} currently watching`, detail: "Currently watching or rewatching" };
  if (filter === "completed") return { icon: "checkmark-circle-outline" as const, value, label: `completed ${format}`, detail: "Finished titles" };
  if (filter === "paused") return { icon: "pause-circle-outline" as const, value, label: `paused ${format}`, detail: "Titles waiting for you to return" };
  if (filter === "dropped") return { icon: "close-circle-outline" as const, value, label: `dropped ${format}`, detail: "Titles you stopped watching" };
  return { icon: "heart-outline" as const, value, label: `favorite ${format}`, detail: "Titles in your personal canon" };
}

async function loadTrackedLibraryTitleCounts(userId: string): Promise<MediaKindCounts> {
  const client = supabase;
  if (!client) return { total: 0, movie: 0, show: 0 };
  const [watchlistRows, favoriteRows, listRows] = await Promise.all([
    loadPagedRows<{ media_id: number | null }>(async (from, to) => client.from("progress").select("media_id").eq("user_id", userId).eq("status", "planned").range(from, to)),
    loadPagedRows<{ media_id: number | null }>(async (from, to) => client.from("favorites").select("media_id").eq("user_id", userId).range(from, to)),
    loadPagedRows<{ id: string }>(async (from, to) => client.from("lists").select("id").eq("user_id", userId).range(from, to))
  ]);
  const listIds = listRows.map(row => row.id);
  const listIdGroups = Array.from({ length: Math.ceil(listIds.length / 50) }, (_, index) => listIds.slice(index * 50, index * 50 + 50));
  const listItemRows = (await Promise.all(listIdGroups.map(ids => loadPagedRows<{ media_id: number | null }>(async (from, to) => client.from("list_items").select("media_id").in("list_id", ids).range(from, to))))).flat();
  const mediaIds = new Set<number>();
  [...watchlistRows, ...favoriteRows, ...listItemRows].forEach(row => {
    const mediaId = Number(row.media_id);
    if (Number.isInteger(mediaId) && mediaId > 0) mediaIds.add(mediaId);
  });
  const idGroups = Array.from({ length: Math.ceil(mediaIds.size / 200) }, (_, index) => [...mediaIds].slice(index * 200, index * 200 + 200));
  const mediaRows = (await Promise.all(idGroups.map(async ids => {
    const { data, error } = await client.from("media").select("id,kind").in("id", ids);
    if (error) throw error;
    return data ?? [];
  }))).flat();
  return {
    total: mediaIds.size,
    movie: mediaRows.filter(row => row.kind === "movie").length,
    show: mediaRows.filter(row => row.kind === "show").length
  };
}

async function loadTrackedLibraryTitleCount(userId: string): Promise<number> {
  return (await loadTrackedLibraryTitleCounts(userId)).total;
}

async function hydrateListFranchiseCollections(listId: string, feed: FeedResult, accessToken: string): Promise<FeedResult> {
  if (!feed.items.some(item => item.kind === "movie" && !item.collectionName)) return feed;
  const payload = await fetchListFranchiseCollections(listId, accessToken);
  const discovered = new Map(payload.collections.map(collection => [collection.tmdbId, collection]));
  if (!discovered.size) return feed;
  return {
    ...feed,
    items: feed.items.map(item => {
      const collection = discovered.get(item.id);
      return collection ? { ...item, collectionTmdbId: collection.collectionTmdbId, collectionName: collection.collectionName } : item;
    })
  };
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
  const [progress, watched, listItems, libraryProgress, favorites, libraryWatches, dismissals] = await Promise.all([
    filters.hideWatched ? client.from("progress").select("media(tmdb_id,kind)").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideWatched ? client.from("watch_events").select("media(tmdb_id,kind)").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("list_items").select("media(tmdb_id,kind),lists!inner(user_id)").eq("lists.user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("progress").select("media(tmdb_id,kind)").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("favorites").select("media(tmdb_id,kind)").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("watch_events").select("media(tmdb_id,kind)").eq("user_id", userId) : Promise.resolve({ data: [] }),
    client.from("recommendation_dismissals").select("media(tmdb_id,kind)").eq("user_id", userId)
  ]);
  [...(progress.data ?? []), ...(watched.data ?? []), ...(listItems.data ?? []), ...(libraryProgress.data ?? []), ...(favorites.data ?? []), ...(libraryWatches.data ?? []), ...(dismissals.data ?? [])].forEach((row: any) => {
    const media = firstRow(row.media);
    if (media) hidden.add(`${media.kind}-${media.tmdb_id}`);
  });
  return hidden;
}

async function hiddenRecommendationMediaIds(client: NonNullable<typeof supabase>, userId: string, filters: RecommendationFilters) {
  const hidden = new Set<number>();
  const [progress, watched, listItems, libraryProgress, favorites, libraryWatches, dismissals] = await Promise.all([
    filters.hideWatched ? client.from("progress").select("media_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideWatched ? client.from("watch_events").select("media_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("list_items").select("media_id,lists!inner(user_id)").eq("lists.user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("progress").select("media_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("favorites").select("media_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
    filters.hideListed ? client.from("watch_events").select("media_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
    client.from("recommendation_dismissals").select("media_id").eq("user_id", userId)
  ]);
  [...(progress.data ?? []), ...(watched.data ?? []), ...(listItems.data ?? []), ...(libraryProgress.data ?? []), ...(favorites.data ?? []), ...(libraryWatches.data ?? []), ...(dismissals.data ?? [])].forEach((row: any) => {
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
      : filters.genre === "sitcom" ? isSitcomLike(item)
      : filters.genre === "talk-show" ? isTalkShowLike(item)
      : item.genres?.some(genre => String(genre.id) === filters.genre || genre.name.toLowerCase() === filters.genre.toLowerCase());
    if (!genreMatches) return false;
  }
  if (filters.country && !item.originCountries?.includes(filters.country)) return false;
  if (filters.year && item.releaseDate?.slice(0, 4) !== filters.year) return false;
  if (filters.excludeGenres.some(value => value === "christmas" ? isChristmasLike(item)
    : value === "superhero" ? isSuperheroLike(item)
    : value === "kdrama" ? isKDramaLike(item)
    : value === "anime" ? isAnimeLike(item)
    : value === "sitcom" ? isSitcomLike(item)
    : value === "talk-show" ? isTalkShowLike(item)
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

function mediaKeywordMatches(media: any, keywordId: number, keywordName: string) {
  const sources = [media?.keywords, media?.raw?.keywords];
  const keywords = sources.flatMap(source => Array.isArray(source) ? source : Array.isArray(source?.results) ? source.results : Array.isArray(source?.keywords) ? source.keywords : []);
  return keywords.some((keyword: any) => Number(keyword?.id) === keywordId || String(keyword?.name ?? "").toLowerCase() === keywordName);
}

function isSitcomLike(media: any) {
  return media?.kind === "show" && (mediaKeywordMatches(media, 193171, "sitcom") || /\bsitcom\b/i.test(searchableMediaText(media)));
}

function isTalkShowLike(media: any) {
  const genresValue = Array.isArray(media?.genres) ? media.genres : [];
  return media?.kind === "show" && (genresValue.some((genre: any) => Number(genre?.id) === 10767 || String(genre?.name ?? "").toLowerCase() === "talk") || mediaKeywordMatches(media, 3741, "talk show") || /\btalk[\s-]?show\b/i.test(searchableMediaText(media)));
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
