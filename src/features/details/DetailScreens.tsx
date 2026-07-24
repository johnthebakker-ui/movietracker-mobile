import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import * as ImagePicker from "expo-image-picker";
import type { Session } from "@supabase/supabase-js";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, BackHandler, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, Share, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View } from "react-native";

import { deleteMobileHistoryEvent, fetchListFranchiseCollections, fetchMobileCompany, fetchMobileEpisode, fetchMobileHistory, fetchMobilePerson, fetchMobileReviews, fetchMobileSeason, fetchMobileTitle, fetchWebsiteEntityMetadata, fetchWebsiteTitleMetadata, setNotInterested } from "../../api";
import { API_URL, communityRatingLabel, HAS_SUPABASE, titleYear, tmdbImage, userRatingLabel } from "../../config";
import { AppHeader, RemoteImage, SectionTitle, TitleCard } from "../../components";
import { styles } from "../../app/styles";
import { dedupeMedia, firstRow, fromDbMedia, fromTmdbRaw, mapProfileReview, trustedCommunityRating } from "../../app/media-model";
import { formatDate, formatLastWatched, isEditedReview, localDateKey, minutesToLabel } from "../../app/date-utils";
import type { ActionRefreshReason, DetailCompany, DetailData, DetailImage, DetailPerson, DetailSeason, DetailVideo, EntityTarget, EpisodeTarget, HistoryItem, ListMembership, ReviewItem, SeasonTarget, SeriesEpisodesTarget, UserList, WatchLogValues } from "../../app/types";
import { RatingSheet, ReviewComposerPanel, WatchLogSheet, clampRating, resolveWatchLogDate } from "../reviews/ReviewSheets";
import { CardGrid } from "../library/LibraryComponents";
import { loadUserLists } from "../library/service";
import { ReviewRow } from "../profile/ProfileComponents";
import { RatingLegend, ratingCellStyle } from "../ratings/RatingTable";
import { groupFranchises, listFranchiseName, NO_FRANCHISE_GROUP } from "../../franchise-groups";
import { supabase } from "../../supabase";
import { reportError } from "../../telemetry";
import { colors } from "../../theme";
import type { MediaKind, MediaSummary } from "../../types";
import { EmptyPanel } from "../../components/EmptyPanel";
import type { SeriesViewingSummary } from "../../viewing-passes";
import { isLimitedSeries, loadMobileSeriesViewingSummary, reconcileMobileEpisodeProgress, titleDetailCacheKey } from "./service";

export async function sharePublicTitle(path: string, title: string, text?: string | null) {
  const url = `${API_URL}${path}`;
  const message = text ? `${title}\n${text}\n${url}` : `${title}\n${url}`;
  try {
    await Share.share({ title, message, url });
  } catch {
    // Native share sheets reject when the user cancels.
  }
}

export function SeasonDetailScreen({ target, session, onBack, onOpenEpisode }: { target: SeasonTarget; session: Session | null; onBack: () => void; onOpenEpisode: (episode: any) => void }) {
  const [payload, setPayload] = useState<any | null>(null);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [source, setSource] = useState<"movietracker" | "tmdb" | "imdb">("tmdb");
  const [colorized, setColorized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ratingSheetVisible, setRatingSheetVisible] = useState(false);
  const [journalVisible, setJournalVisible] = useState(false);
  const [quickWatchEpisode, setQuickWatchEpisode] = useState<any | null>(null);
  const heldEpisode = useRef<number | null>(null);
  const season = payload?.season ?? target.season;
  const episodes = [...(payload?.episodes ?? [])].sort((a, b) => Number(a.episode_number ?? a.episodeNumber ?? 0) - Number(b.episode_number ?? b.episodeNumber ?? 0));
  const imdbRatings = new Map<number, number | null>((payload?.imdbRatings ?? []).map((rating: any) => [Number(rating.episode), typeof rating.imdbRating === "number" ? rating.imdbRating : null]));
  const movieTrackerRatings = new Map<number, number | null>((payload?.episodeRatings ?? []).map((rating: any) => [Number(rating.episode), typeof rating.score === "number" ? rating.score : null]));
  const imdbAvailable = [...imdbRatings.values()].some(value => typeof value === "number" && value > 0);
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
    if (source === "imdb") {
      const score = imdbRatings.get(episodeNumber);
      return typeof score === "number" && score > 0 ? score : null;
    }
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

  async function saveSeasonReview(values: { score: number | null; title: string; body: string; containsSpoilers: boolean; isPrivate: boolean }) {
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
      const reviewPayload = { user_id: session.user.id, season_id: payload.seasonId, rating_id: ratingId, title: title || null, body: body || null, contains_spoilers: values.containsSpoilers, is_private: values.isPrivate };
      const { data: existingReview } = await supabase.from("reviews").select("id").eq("user_id", session.user.id).eq("season_id", payload.seasonId).maybeSingle();
      const now = new Date().toISOString();
      const { data: saved, error } = existingReview
        ? await supabase.from("reviews").update({ ...reviewPayload, updated_at: now }).eq("id", existingReview.id).select("id,created_at,updated_at").single()
        : await supabase.from("reviews").insert(reviewPayload).select("id,created_at,updated_at").single();
      if (error) throw error;
      const savedReview: ReviewItem = { id: saved.id, title: title || "Review", body, created_at: saved.created_at ?? now, updated_at: saved.updated_at ?? now, userId: session.user.id, ratingId, containsSpoilers: values.containsSpoilers, isPrivate: values.isPrivate, kind: target.show.kind, targetLabel: "season", mediaTitle: `${target.show.title} season`, artwork: season.poster_path ?? season.posterPath ?? target.show.backdropPath ?? target.show.posterPath ?? null, score: values.score, item: target.show };
      setPayload((current: any) => current ? { ...current, userRating: values.score ?? current.userRating, myReview: savedReview, reviews: [savedReview, ...(current.reviews ?? []).filter((review: ReviewItem) => review.id !== savedReview.id && review.userId !== session.user.id)] } : current);
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
      await reconcileMobileEpisodeProgress(session.user.id, payload.mediaId);
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
            <Pressable disabled={!session?.user.id || !payload?.mediaId || !payload?.seasonId} onPress={() => setJournalVisible(true)} style={styles.quickAction}><Ionicons name="book-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>My journal</Text></Pressable>
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
        {session?.user.id && payload?.mediaId && payload?.seasonId ? <JournalSheet visible={journalVisible} userId={session.user.id} mediaId={payload.mediaId} seasonId={payload.seasonId} title={`${target.show.title} · ${season.name ?? target.season.name}`} onClose={() => setJournalVisible(false)} /> : null}
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
            const userScore = (payload?.userEpisodeRatings ?? []).find((rating: any) => Number(rating.episode) === episodeNumber)?.score;
            return (
              <Pressable key={`row-${episode.id ?? episodeNumber}`} onPress={() => openEpisodePress(episode)} onLongPress={() => openQuickEpisodeWatch(episode)} delayLongPress={300} style={styles.seasonCard}>
                {still ? <RemoteImage uri={still} style={styles.seasonPoster} resizeMode="cover" /> : <View style={styles.seasonPoster}><Ionicons name="film-outline" size={20} color={colors.muted} /></View>}
                <View style={styles.seasonCopy}>
                  <Text style={styles.seasonName} numberOfLines={1}>E{episodeNumber} - {episode.name ?? "Episode"}</Text>
                  <Text style={styles.seasonMeta}>{episode.air_date ?? "Air date TBA"}{episode.runtime ? ` - ${episode.runtime} min` : ""}</Text>
                </View>
                <View style={styles.episodeCardTrailing}>
                  {typeof userScore === "number" ? <View style={styles.episodeOwnRating}><Ionicons name="star" size={12} color="#ffc24b" /><Text style={styles.episodeOwnRatingText}>{Number(userScore).toFixed(1)}</Text></View> : null}
                  <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

export function SeriesEpisodesScreen({ target, session, onBack, onOpenSeason, onOpenEpisode }: { target: SeriesEpisodesTarget; session: Session | null; onBack: () => void; onOpenSeason: (season: DetailSeason) => void; onOpenEpisode: (season: DetailSeason, episode: any) => void }) {
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
  const hasImdb = payloads.some(payload => (payload?.imdbRatings ?? []).some((rating: any) => typeof rating.imdbRating === "number" && rating.imdbRating > 0));
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
      return typeof rating?.imdbRating === "number" && rating.imdbRating > 0 ? rating.imdbRating : null;
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
    await reconcileMobileEpisodeProgress(session.user.id, quickWatch.payload.mediaId);
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
                const userScore = (payload?.userEpisodeRatings ?? []).find((rating: any) => Number(rating.episode) === episodeNumber)?.score;
                return (
                  <Pressable key={`row-${season.seasonNumber}-${episode.id ?? episodeNumber}`} onPress={() => openEpisodePress(season, episode)} onLongPress={() => openQuickEpisodeWatch(season, payload, episode)} delayLongPress={300} style={[styles.seasonCard, dimmed && styles.dimmedEpisodeCard]}>
                    {still ? <RemoteImage uri={still} style={styles.seasonPoster} resizeMode="cover" /> : <View style={styles.seasonPoster}><Ionicons name="film-outline" size={20} color={colors.muted} /></View>}
                    <View style={styles.seasonCopy}>
                      <Text style={styles.seasonName} numberOfLines={1}>E{episodeNumber} - {episode.name ?? "Episode"}</Text>
                      <Text style={styles.seasonMeta}>{episode.air_date ?? "Air date TBA"}{episode.runtime ? ` - ${episode.runtime} min` : ""}</Text>
                    </View>
                    <View style={styles.episodeCardTrailing}>
                      {typeof userScore === "number" ? <View style={styles.episodeOwnRating}><Ionicons name="star" size={12} color="#ffc24b" /><Text style={styles.episodeOwnRatingText}>{Number(userScore).toFixed(1)}</Text></View> : null}
                      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
                    </View>
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

export function MovieActionSheet({ item, visible, session, currentList, franchiseGroups = [], allowNotInterested, onClose, onOpen, onNotInterested, onChanged }: { item: MediaSummary | null; visible: boolean; session: Session | null; currentList?: UserList | null; franchiseGroups?: string[]; allowNotInterested?: boolean; onClose: () => void; onOpen: (item: MediaSummary) => void; onNotInterested: (item: MediaSummary) => void; onChanged: (reason?: ActionRefreshReason) => Promise<void> }) {
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
  const effectiveFranchiseGroup = item ? listFranchiseName({ ...item, franchiseGroup: manualGroup })?.name ?? null : null;

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

  function confirmClearCompleted() {
    Alert.alert("Remove from Completed?", `${item?.title ?? "This title"} will leave Completed. Your watch history and ratings stay intact.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void clearStatus() }
    ]);
  }

  async function dismissRewatch() {
    const mediaId = item?.listMediaId ?? await ensureActionMediaId();
    if (!session?.user.id || !supabase || !mediaId) return Alert.alert("Unavailable", "Could not prepare this title yet. Try again in a second.");
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const operation = item?.activeRewatch
        ? supabase.from("progress").update({ started_at: now, updated_at: now }).eq("user_id", session.user.id).eq("media_id", mediaId).eq("status", "completed")
        : supabase.from("progress").delete().eq("user_id", session.user.id).eq("media_id", mediaId).in("status", ["watching", "paused"]);
      const { error } = await operation;
      if (error) throw error;
      onClose();
      await onChanged("profile");
    } finally {
      setBusy(false);
    }
  }

  function confirmDismissRewatch() {
    Alert.alert(
      "Remove from Watching?",
      item?.activeRewatch
        ? `${item.title} stays Completed and every watch event remains.`
        : `${item?.title ?? "This title"} keeps all of its watch history.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void dismissRewatch() }
      ]
    );
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

  async function applyFranchiseGroup(nextGroup: string) {
    const mediaId = item?.listMediaId ?? await ensureActionMediaId();
    if (!supabase || !currentList?.id || !mediaId) return Alert.alert("Unavailable", "Could not prepare this title yet. Try again in a second.");
    const group = nextGroup.trim();
    const previousGroup = manualGroup;
    setManualGroup(group);
    setNewManualGroup("");
    setBusy(true);
    try {
      const { data: updated, error } = await supabase.from("list_items").update({ franchise_group: group || null }).eq("list_id", currentList.id).eq("media_id", mediaId).select("franchise_group").maybeSingle();
      if (error) throw error;
      if (!updated) throw new Error("This title is no longer in the list.");
      await onChanged("list");
    } catch (reason) {
      setManualGroup(previousGroup);
      Alert.alert("Could not update franchise group", reason instanceof Error ? reason.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveFranchiseGroup() {
    const group = newManualGroup.trim();
    if (!group) return Alert.alert("Name the group", "Enter a franchise group name first.");
    await applyFranchiseGroup(group);
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
              <Pressable disabled={busy} style={styles.contextPrimaryButton} onPress={() => setWatchSheetVisible(true)}><Ionicons name="calendar-outline" size={22} color={colors.text} /><Text style={styles.contextPrimaryText}>Add watch</Text></Pressable>
              <Pressable disabled={busy} style={styles.contextPrimaryButton} onPress={toggleFavorite}><Ionicons name={favorite ? "heart" : "heart-outline"} size={22} color={colors.text} /><Text style={styles.contextPrimaryText}>{favorite ? "Unfavorite" : "Favorite"}</Text></Pressable>
            </View>
            <View style={styles.actionDivider} />
            {status === "completed" ? <><View style={styles.watchingRemovePanel}><Pressable disabled={busy} onPress={confirmClearCompleted} style={({ pressed }) => [styles.watchingRemoveAction, pressed && { opacity: .7 }]}><View style={styles.watchingRemoveIcon}><Ionicons name="eye-off-outline" size={19} color={colors.accent} /></View><View style={styles.watchingRemoveCopy}><Text style={styles.watchingRemoveText}>Remove from Completed</Text><Text style={styles.watchingRemoveSub}>Keeps every watch event and rating.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.accent} /></Pressable></View><View style={styles.actionDivider} /></> : null}
            {item?.activeRewatch || item?.reason === "Watching" ? <><View style={styles.watchingRemovePanel}><Pressable disabled={busy} onPress={confirmDismissRewatch} style={({ pressed }) => [styles.watchingRemoveAction, pressed && { opacity: .7 }]}><View style={styles.watchingRemoveIcon}><Ionicons name="eye-off-outline" size={19} color={colors.accent} /></View><View style={styles.watchingRemoveCopy}><Text style={styles.watchingRemoveText}>Remove from Watching</Text><Text style={styles.watchingRemoveSub}>{item?.activeRewatch ? "Keeps Completed status and every watch event." : "Keeps every watch event."}</Text></View><Ionicons name="chevron-forward" size={17} color={colors.accent} /></Pressable></View><View style={styles.actionDivider} /></> : null}
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
                  <Pressable disabled={busy} onPress={() => void applyFranchiseGroup("")} style={[styles.groupChip, !manualGroup && !effectiveFranchiseGroup && styles.groupChipActive]}><Text style={[styles.groupChipText, !manualGroup && !effectiveFranchiseGroup && styles.groupChipTextActive]}>Use automatic</Text></Pressable>
                  <Pressable disabled={busy} onPress={() => void applyFranchiseGroup(NO_FRANCHISE_GROUP)} style={[styles.groupChip, manualGroup === NO_FRANCHISE_GROUP && styles.groupChipActive]}><Text style={[styles.groupChipText, manualGroup === NO_FRANCHISE_GROUP && styles.groupChipTextActive]}>No franchise</Text></Pressable>
                  {franchiseGroups.map(group => (
                    <Pressable disabled={busy} key={group} onPress={() => void applyFranchiseGroup(effectiveFranchiseGroup === group ? NO_FRANCHISE_GROUP : group)} style={[styles.groupChip, effectiveFranchiseGroup === group && styles.groupChipActive]}><Text style={[styles.groupChipText, effectiveFranchiseGroup === group && styles.groupChipTextActive]} numberOfLines={1}>{group}</Text></Pressable>
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

export function ActionRow({ icon, label, danger, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; danger?: boolean; onPress?: () => void }) {
  return (
    <Pressable style={styles.actionRow} onPress={onPress}>
      <Ionicons name={icon} size={23} color={danger ? colors.danger : colors.text} style={styles.actionIcon} />
      <Text style={[styles.actionText, danger && styles.dangerText]}>{label}</Text>
    </Pressable>
  );
}

export function EpisodeDetailScreen({ target, session, onBack, onOpen, onOpenEntity, onOpenSeason, onChanged }: { target: EpisodeTarget; session: Session | null; onBack: () => void; onOpen: (item: MediaSummary) => void; onOpenEntity: (entity: EntityTarget) => void; onOpenSeason: (season: DetailSeason, show: MediaSummary, seasons: DetailSeason[]) => void; onChanged?: (reason?: ActionRefreshReason) => Promise<void> }) {
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
  const [seriesProgress, setSeriesProgress] = useState<SeriesViewingSummary | null>(null);
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
  const [journalVisible, setJournalVisible] = useState(false);
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
      setSeriesProgress(mobileEpisode.seriesProgress ?? null);
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
      const reviewSelect = "id,title,body,created_at,updated_at,user_id,rating_id,contains_spoilers,is_private,ratings(score)";
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
        if (season?.media_id) setSeriesProgress(await loadMobileSeriesViewingSummary(session.user.id, Number(season.media_id), show.status));
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
      void onChanged?.(reason);
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
      const { error } = await supabase!.from("watch_events").insert({ user_id: session.user.id, media_id: mediaId, episode_id: episodeId, watched_at: new Date().toISOString() });
      if (error) throw error;
      await reconcileMobileEpisodeProgress(session.user.id, mediaId);
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
      const watchResult = await supabase!.from("watch_events").insert({ user_id: session.user.id, media_id: mediaId, episode_id: episodeId, duration_minutes: episode?.runtime ?? null, watched_at: watchedAt });
      if (watchResult.error) throw watchResult.error;
      await reconcileMobileEpisodeProgress(session.user.id, mediaId);
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

  async function saveEpisodeReview(values: { score: number | null; title: string; body: string; containsSpoilers: boolean; isPrivate: boolean }) {
    if (!session?.user.id || !supabase || !episodeId) return Alert.alert("Unavailable", "This episode is not ready for review yet.");
    if (!values.body.trim()) return Alert.alert("Review needed", "Write a few words before publishing your review.");
    const nextScore = values.score == null ? null : clampRating(values.score);
    setBusy(true);
    try {
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
      const payload = { title: values.title.trim() || null, body: values.body.trim(), contains_spoilers: values.containsSpoilers, is_private: values.isPrivate, rating_id: ratingId };
      const { data: existingReview } = await supabase!.from("reviews").select("id").eq("user_id", session.user.id).eq("episode_id", episodeId).maybeSingle();
      const now = new Date().toISOString();
      const result = existingReview?.id
        ? await supabase!.from("reviews").update({ ...payload, updated_at: now }).eq("id", existingReview.id).select("id,created_at,updated_at").single()
        : await supabase!.from("reviews").insert({ user_id: session.user.id, episode_id: episodeId, ...payload }).select("id,created_at,updated_at").single();
      if (result.error) throw result.error;
      const show = firstRow(firstRow(episode?.seasons)?.media) ? fromDbMedia(firstRow(firstRow(episode?.seasons)?.media)) : target.show;
      const savedReview: ReviewItem = { id: result.data.id, title: values.title.trim() || "Review", body: values.body.trim(), created_at: result.data.created_at ?? now, updated_at: result.data.updated_at ?? now, userId: session.user.id, ratingId, containsSpoilers: values.containsSpoilers, isPrivate: values.isPrivate, kind: show.kind, targetLabel: "episode", mediaTitle: `${show.title} episode`, artwork: target.artwork ?? show.backdropPath ?? show.posterPath ?? null, score: nextScore, item: show };
      setUserRating(nextScore);
      setMyReview(savedReview);
      setReviews(current => [savedReview, ...current.filter(review => review.id !== savedReview.id && review.userId !== session.user.id)]);
      void onChanged?.("rating");
    } finally { setBusy(false); }
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
          {seriesProgress ? <SeriesProgressCard summary={seriesProgress} /> : null}
          <View style={styles.detailQuickActions}>
            <Pressable onPress={() => onOpen(show)} style={styles.quickAction}><Ionicons name="albums-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Open show</Text></Pressable>
            <Pressable onPress={() => onOpenSeason(seasonTarget, show, showSeasons.length ? showSeasons : [seasonTarget])} style={styles.quickAction}><Ionicons name="layers-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>{isLimitedSeries(show, showSeasons.length ? showSeasons : [seasonTarget]) ? "All episodes" : "Open season"}</Text></Pressable>
            <Pressable disabled={!session?.user.id || !episodeId} onPress={() => setJournalVisible(true)} style={styles.quickAction}><Ionicons name="book-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>My journal</Text></Pressable>
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
        {session?.user.id && episodeId && season?.media_id ? <JournalSheet visible={journalVisible} userId={session.user.id} mediaId={Number(season.media_id)} episodeId={Number(episodeId)} title={`${show.title} · S${target.seasonNumber} E${target.episodeNumber}`} onClose={() => setJournalVisible(false)} /> : null}
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

export function EntityScreen({ target, session, onBack, onOpen, onMenu }: { target: EntityTarget; session: Session | null; onBack: () => void; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
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

export function DetailScreenV2({ item, session, onBack, onOpen, onOpenEntity, onOpenSeason, onOpenAllSeasons, onHide, onChanged }: { item: MediaSummary; session: Session | null; onBack: () => void; onOpen: (item: MediaSummary) => void; onOpenEntity: (entity: EntityTarget) => void; onOpenSeason: (season: DetailSeason) => void; onOpenAllSeasons: (seasons: DetailSeason[]) => void; onHide: (item: MediaSummary) => void; onChanged: (reason?: ActionRefreshReason) => Promise<void> }) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailLoadError, setDetailLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listSheetVisible, setListSheetVisible] = useState(false);
  const [ratingSheetVisible, setRatingSheetVisible] = useState(false);
  const [watchSheetVisible, setWatchSheetVisible] = useState(false);
  const [journalVisible, setJournalVisible] = useState(false);
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
        seriesProgress: mobileDetail.seriesProgress ?? null,
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
    const fullDetailPromise = fetchMobileTitle(item.kind, item.id, session?.access_token, "full").catch(() => null);
    if (!hasCachedDetail) {
      const coreDetail = await fetchMobileTitle(item.kind, item.id, session?.access_token, "core").catch(() => null);
      if (coreDetail) {
        applyMobileDetail(coreDetail);
        setDetailLoading(false);
      }
    }
    const mobileDetail = await fullDetailPromise;
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
    const reviewSelect = "id,title,body,created_at,updated_at,user_id,rating_id,contains_spoilers,is_private,media(id,tmdb_id,kind,title,overview,poster_path,backdrop_path,release_date,end_date,status,vote_average,vote_count,popularity,runtime,genres,original_language,origin_countries,collection_tmdb_id,collection_name,collection_poster_path),ratings(score)";
    const [ratings, reviews, myReviewResult, progress, userRating, favorite, lists, contains, seasonRows, collectionRows, seriesProgress] = await Promise.all([
      client.from("ratings").select("score").eq("media_id", mediaId),
      client.from("reviews").select(reviewSelect).eq("media_id", mediaId).order("created_at", { ascending: false }).limit(8),
      session?.user.id ? client.from("reviews").select(reviewSelect).eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle() : Promise.resolve({ data: null }),
      session?.user.id ? client.from("progress").select("status").eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle() : Promise.resolve({ data: null }),
      session?.user.id ? client.from("ratings").select("score").eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle() : Promise.resolve({ data: null }),
      session?.user.id ? client.from("favorites").select("media_id").eq("user_id", session.user.id).eq("media_id", mediaId).maybeSingle() : Promise.resolve({ data: null }),
      session?.user.id ? loadUserLists(session.user.id) : Promise.resolve([]),
      session?.user.id ? client.from("list_items").select("list_id").eq("media_id", mediaId) : Promise.resolve({ data: [] }),
      item.kind === "show" ? client.from("seasons").select("id,season_number,name,overview,poster_path,air_date,episode_count").eq("media_id", mediaId).gt("season_number", 0).order("season_number") : Promise.resolve({ data: [] }),
      collectionId ? client.from("media").select("*").eq("kind", "movie").eq("collection_tmdb_id", collectionId).order("release_date", { ascending: true }) : Promise.resolve({ data: [] }),
      item.kind === "show" && session?.user.id ? loadMobileSeriesViewingSummary(session.user.id, mediaId, media.status ?? item.status) : Promise.resolve(null)
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
      seriesProgress,
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
      void onChanged(reason);
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

  async function saveReviewDraft(values: { score: number | null; title: string; body: string; containsSpoilers: boolean; isPrivate: boolean }) {
    if (!session?.user.id || !supabase || !detail?.dbId) return Alert.alert("Unavailable", "Open this title on the website once before editing it in the app.");
    if (!values.body.trim()) return Alert.alert("Review needed", "Write a few words before publishing your review.");
    const nextScore = values.score == null ? null : clampRating(values.score);
    setBusy(true);
    try {
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
      const payload = { title: values.title.trim() || null, body: values.body.trim(), contains_spoilers: values.containsSpoilers, is_private: values.isPrivate, rating_id: ratingId };
      const { data: existingReview } = await supabase!.from("reviews").select("id").eq("user_id", session.user.id).eq("media_id", detail.dbId).maybeSingle();
      const now = new Date().toISOString();
      const result = existingReview?.id
        ? await supabase!.from("reviews").update({ ...payload, updated_at: now }).eq("id", existingReview.id).select("id,created_at,updated_at").single()
        : await supabase!.from("reviews").insert({ user_id: session.user.id, media_id: detail.dbId, ...payload }).select("id,created_at,updated_at").single();
      if (result.error) throw result.error;
      const savedReview: ReviewItem = { id: result.data.id, title: values.title.trim() || "Review", body: values.body.trim(), created_at: result.data.created_at ?? now, updated_at: result.data.updated_at ?? now, userId: session.user.id, ratingId, containsSpoilers: values.containsSpoilers, isPrivate: values.isPrivate, kind: item.kind, mediaTitle: item.title, artwork: item.backdropPath ?? item.posterPath ?? null, score: nextScore, item };
      setDetail(current => current ? { ...current, userRating: nextScore ?? current.userRating, myReview: savedReview, reviews: [savedReview, ...current.reviews.filter(review => review.id !== savedReview.id && review.userId !== session.user.id)] } : current);
      await AsyncStorage.removeItem(detailCacheKey).catch(() => undefined);
      void onChanged("rating");
    } finally { setBusy(false); }
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
          {item.kind === "show" && detail?.lastWatchedAt ? <Text style={styles.lastWatchedText}>Last watched {formatLastWatched(detail.lastWatchedAt)}</Text> : null}
          {item.kind === "movie" && detail?.watched ? <View accessible accessibilityRole="text" accessibilityLabel={`Watched. Last watched ${detail.lastWatchedAt ? formatLastWatched(detail.lastWatchedAt) : "date unavailable"}`} style={styles.movieWatchedSummary}><Ionicons name="checkmark-circle" size={22} color={colors.accent} /><View style={styles.movieWatchedSummaryCopy}><Text style={styles.movieWatchedSummaryTitle}>Watched</Text><Text style={styles.movieWatchedSummaryMeta}>{detail.lastWatchedAt ? `Last watched ${formatLastWatched(detail.lastWatchedAt)}` : "Watch date unavailable"}</Text></View></View> : null}
          {item.kind === "show" && detail?.seriesProgress ? <SeriesProgressCard summary={detail.seriesProgress} /> : null}
          <View style={styles.statusActions}>{item.kind === "movie" && detail?.progressStatus === "watching" ? <View style={[styles.detailStatusButton, styles.detailStatusButtonActive]}><Ionicons name="eye-outline" size={17} color={colors.accent} /><Text style={styles.detailStatusTextActive}>Watching</Text></View> : null}{[
            { value: "planned", label: detail?.watched ? "Plan rewatch" : "Plan", icon: "bookmark-outline" },
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
          <View style={styles.detailQuickActions}><Pressable disabled={busy} onPress={toggleFavorite} style={styles.quickAction}><Ionicons name={detail?.favorite ? "heart" : "heart-outline"} size={19} color={colors.text} /><Text style={styles.quickActionText}>{detail?.favorite ? "Favorited" : "Favorite"}</Text></Pressable><Pressable disabled={!session?.user.id || !detail?.dbId} onPress={() => setJournalVisible(true)} style={styles.quickAction}><Ionicons name="book-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>My journal</Text></Pressable><Pressable disabled={busy} onPress={() => session?.access_token ? onHide(item) : Alert.alert("Sign in needed", "Sign in before changing recommendations.")} style={styles.quickAction}><Ionicons name="ban-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Not interested</Text></Pressable><Pressable disabled={busy} onPress={() => setWatchSheetVisible(true)} style={styles.quickAction}><Ionicons name="calendar-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>{detail?.watched || detail?.seriesProgress ? "Add another watch" : "First watch"}</Text></Pressable><Pressable onPress={() => sharePublicTitle(`/title/${item.kind}/${item.id}`, item.title, detailOverview)} style={styles.quickAction}><Ionicons name="share-social-outline" size={19} color={colors.text} /><Text style={styles.quickActionText}>Share</Text></Pressable></View>
          {detail?.lists.length ? <View style={styles.detailLists}><Pressable disabled={busy} onPress={() => setListSheetVisible(true)} style={styles.addToListButton}><Ionicons name="list-outline" size={21} color={colors.text} /><Text style={styles.addToListText}>Add to list</Text><Ionicons name="chevron-up" size={18} color={colors.muted} /></Pressable></View> : null}
        </View>
        <RatingSheet visible={ratingSheetVisible} value={detail?.userRating ?? null} busy={busy} onClose={() => setRatingSheetVisible(false)} onSave={saveUserRating} />
        <WatchLogSheet visible={watchSheetVisible} title={item.title} releaseDate={detail?.releaseDate || item.releaseDate} runtime={detail?.runtime ?? null} busy={busy} watched={Boolean(detail?.watched)} onClose={() => setWatchSheetVisible(false)} onSave={saveWatchLog} />
        <DetailListSheet visible={listSheetVisible} lists={detail?.lists ?? []} busy={busy} onClose={() => setListSheetVisible(false)} onToggle={toggleDetailList} />
        {session?.user.id && detail?.dbId ? <JournalSheet visible={journalVisible} userId={session.user.id} mediaId={detail.dbId} title={item.title} onClose={() => setJournalVisible(false)} /> : null}
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

type MobileJournalEntry = {
  id: string;
  title: string | null;
  body: string;
  mood: string | null;
  entry_date: string;
  created_at: string;
  image_paths: string[];
  image_urls?: string[];
  journal_entry_blocks?: Array<{ id: string; position: number; body: string; target_labels: string[] }>;
};

type MobileJournalSeason = {
  id: number;
  seasonNumber: number;
  name: string;
  episodes: Array<{ id: number; episodeNumber: number; name: string }>;
};

type MobileJournalSection = {
  key: string;
  body: string;
  seasonIds: number[];
  episodeIds: number[];
};

function createJournalSection(seasonId?: number, episodeId?: number): MobileJournalSection {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    body: "",
    seasonIds: seasonId && !episodeId ? [seasonId] : [],
    episodeIds: episodeId ? [episodeId] : []
  };
}

export function JournalSheet({ visible, userId, mediaId, seasonId, episodeId, title, onClose }: { visible: boolean; userId: string; mediaId: number; seasonId?: number; episodeId?: number; title: string; onClose: () => void }) {
  const [entries, setEntries] = useState<MobileJournalEntry[]>([]);
  const [entryTitle, setEntryTitle] = useState("");
  const [sections, setSections] = useState<MobileJournalSection[]>(() => [createJournalSection(seasonId, episodeId)]);
  const [targetSeasons, setTargetSeasons] = useState<MobileJournalSeason[]>([]);
  const [openTargetSection, setOpenTargetSection] = useState<string | null>(null);
  const [expandedSeasonKeys, setExpandedSeasonKeys] = useState<Set<string>>(() => new Set());
  const [mood, setMood] = useState("");
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const client = supabase;
    const [entryResult, seasonResult] = await Promise.all([
      client.from("journal_entries").select("id,title,body,mood,entry_date,created_at,image_paths,journal_entry_blocks(id,position,body,target_labels)").eq("user_id", userId).eq("media_id", mediaId).order("entry_date", { ascending: false }).order("created_at", { ascending: false }),
      client.from("seasons").select("id,season_number,name,episodes(id,episode_number,name)").eq("media_id", mediaId).order("season_number", { ascending: true })
    ]);
    const { data, error } = entryResult;
    if (error) throw error;
    if (seasonResult.error) throw seasonResult.error;
    setTargetSeasons((seasonResult.data ?? []).map((season: any) => ({
      id: Number(season.id),
      seasonNumber: Number(season.season_number),
      name: season.name || `Season ${season.season_number}`,
      episodes: [...(season.episodes ?? [])].map((episode: any) => ({
        id: Number(episode.id),
        episodeNumber: Number(episode.episode_number),
        name: episode.name || `Episode ${episode.episode_number}`
      })).sort((a, b) => a.episodeNumber - b.episodeNumber)
    })).filter(season => season.seasonNumber > 0));
    const hydrated = await Promise.all(((data ?? []) as MobileJournalEntry[]).map(async entry => {
      if (!entry.image_paths?.length) return { ...entry, image_paths: [] };
      const { data: signed } = await client.storage.from("journal-media").createSignedUrls(entry.image_paths, 3600);
      return { ...entry, image_urls: (signed ?? []).flatMap(image => image.signedUrl ? [image.signedUrl] : []) };
    }));
    setEntries(hydrated);
  }, [mediaId, userId]);

  useEffect(() => {
    if (!visible) return;
    setEntryTitle("");
    setSections([createJournalSection(seasonId, episodeId)]);
    setOpenTargetSection(null);
    setExpandedSeasonKeys(new Set());
    setMood("");
    setAssets([]);
    void load().catch(reason => Alert.alert("Journal unavailable", reason instanceof Error ? reason.message : "Try again."));
  }, [episodeId, load, seasonId, visible]);

  async function pickImages() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert("Photo access needed", "Allow photo access to attach images to this private entry.");
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 4, quality: .88 });
    if (!result.canceled) setAssets(result.assets.slice(0, 4));
  }

  async function save() {
    if (!supabase) return;
    const filledSections = sections.filter(section => section.body.trim());
    if (!filledSections.length) return;
    setBusy(true);
    const paths: string[] = [];
    let createdEntryId: string | null = null;
    try {
      for (const asset of assets) {
        const extension = (asset.fileName?.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase();
        const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
        const blob = await (await fetch(asset.uri)).blob();
        const { error } = await supabase.storage.from("journal-media").upload(path, blob, { contentType: asset.mimeType || "image/jpeg" });
        if (error) throw error;
        paths.push(path);
      }
      const { data: createdEntry, error } = await supabase.from("journal_entries").insert({
        user_id: userId,
        media_id: mediaId,
        season_id: seasonId ?? null,
        episode_id: episodeId ?? null,
        title: entryTitle.trim() || null,
        body: filledSections.map(section => section.body.trim()).join("\n\n"),
        mood: mood || null,
        image_paths: paths,
        entry_date: new Date().toISOString().slice(0, 10)
      }).select("id").single();
      if (error) throw error;
      createdEntryId = createdEntry.id;
      const blockRows = filledSections.map((section, position) => ({
        entry_id: createdEntry.id,
        position,
        body: section.body.trim(),
        season_ids: section.seasonIds,
        episode_ids: section.episodeIds,
        target_labels: journalSectionLabels(section)
      }));
      const { error: blockError } = await supabase.from("journal_entry_blocks").insert(blockRows);
      if (blockError) throw blockError;
      setEntryTitle(""); setSections([createJournalSection(seasonId, episodeId)]); setOpenTargetSection(null); setExpandedSeasonKeys(new Set()); setMood(""); setAssets([]);
      await load();
    } catch (reason) {
      if (createdEntryId) await supabase.from("journal_entries").delete().eq("id", createdEntryId).eq("user_id", userId);
      if (paths.length) await supabase.storage.from("journal-media").remove(paths);
      Alert.alert("Could not save entry", reason instanceof Error ? reason.message : "Try again.");
    } finally { setBusy(false); }
  }

  function updateSection(key: string, change: (section: MobileJournalSection) => MobileJournalSection) {
    setSections(current => current.map(section => section.key === key ? change(section) : section));
  }

  function journalSectionLabels(section: MobileJournalSection) {
    const seasonLabels = section.seasonIds.flatMap(id => {
      const season = targetSeasons.find(candidate => candidate.id === id);
      return season ? [`Season ${season.seasonNumber}`] : [];
    });
    const episodeLabels = section.episodeIds.flatMap(id => {
      for (const season of targetSeasons) {
        const episode = season.episodes.find(candidate => candidate.id === id);
        if (episode) return [`S${season.seasonNumber} E${episode.episodeNumber} · ${episode.name}`];
      }
      return [];
    });
    return [...seasonLabels, ...episodeLabels];
  }

  function toggleSeason(sectionKey: string, target: MobileJournalSeason) {
    updateSection(sectionKey, section => {
      const selected = section.seasonIds.includes(target.id);
      return {
        ...section,
        seasonIds: selected ? section.seasonIds.filter(id => id !== target.id) : [...section.seasonIds, target.id],
        episodeIds: selected ? section.episodeIds : section.episodeIds.filter(id => !target.episodes.some(episode => episode.id === id))
      };
    });
  }

  function toggleEpisode(sectionKey: string, target: MobileJournalSeason, targetEpisodeId: number) {
    updateSection(sectionKey, section => ({
      ...section,
      seasonIds: section.seasonIds.filter(id => id !== target.id),
      episodeIds: section.episodeIds.includes(targetEpisodeId) ? section.episodeIds.filter(id => id !== targetEpisodeId) : [...section.episodeIds, targetEpisodeId]
    }));
  }

  function toggleSeasonExpanded(sectionKey: string, targetSeasonId: number) {
    const compositeKey = `${sectionKey}:${targetSeasonId}`;
    setExpandedSeasonKeys(current => {
      const next = new Set(current);
      if (next.has(compositeKey)) next.delete(compositeKey);
      else next.add(compositeKey);
      return next;
    });
  }

  async function remove(entry: MobileJournalEntry) {
    if (!supabase) return;
    const { error } = await supabase.from("journal_entries").delete().eq("id", entry.id).eq("user_id", userId);
    if (error) return Alert.alert("Could not delete entry", error.message);
    if (entry.image_paths.length) await supabase.storage.from("journal-media").remove(entry.image_paths);
    setEntries(current => current.filter(candidate => candidate.id !== entry.id));
  }

  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <SafeAreaView style={styles.journalSheet}>
      <View style={styles.journalSheetHeader}><View><Text style={styles.journalSheetKicker}>PRIVATE JOURNAL</Text><Text style={styles.journalSheetTitle} numberOfLines={1}>{title}</Text></View><Pressable onPress={onClose} style={styles.sheetCloseButton}><Ionicons name="close" size={24} color={colors.text} /></Pressable></View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.journalSheetContent}>
        <View style={styles.journalPrivacyCard}><Ionicons name="lock-closed" size={17} color={colors.accent} /><Text style={styles.journalPrivacyText}><Text style={styles.journalPrivacyStrong}>Only you can see this.</Text> Keep the thoughts you will want to rediscover years from now.</Text></View>
        <View style={styles.journalComposerMobile}>
          <TextInput value={entryTitle} onChangeText={setEntryTitle} maxLength={120} placeholder="Give this memory a title (optional)" placeholderTextColor={colors.muted} style={styles.journalTitleInputMobile} />
          {sections.map((section, sectionIndex) => {
            const labels = journalSectionLabels(section);
            const pickerOpen = openTargetSection === section.key;
            return <View key={section.key} style={[styles.journalDraftSection, sectionIndex > 0 && styles.journalDraftSectionLater]}>
              {sectionIndex > 0 ? <View style={styles.journalDraftSectionHeader}><Text style={styles.journalDraftSectionLabel}>THOUGHT {sectionIndex + 1}</Text><Pressable onPress={() => setSections(current => current.filter(candidate => candidate.key !== section.key))} hitSlop={8}><Ionicons name="close" size={18} color={colors.muted} /></Pressable></View> : null}
              <TextInput value={section.body} onChangeText={value => updateSection(section.key, current => ({ ...current, body: value }))} maxLength={20000} multiline placeholder={sectionIndex ? "Continue with another season, episode, or idea..." : "What stayed with you? A scene, a feeling, a theory..."} placeholderTextColor={colors.muted} style={styles.journalBodyInputMobile} />
              {targetSeasons.length ? <>
                <Pressable onPress={() => setOpenTargetSection(current => current === section.key ? null : section.key)} style={styles.journalTargetButton}>
                  <View style={styles.journalTargetButtonCopy}><Ionicons name="pricetags-outline" size={15} color={labels.length ? colors.accent : colors.muted} /><Text style={[styles.journalTargetButtonText, Boolean(labels.length) && styles.journalTargetButtonTextActive]} numberOfLines={1}>{labels.length ? `${labels.length} ${labels.length === 1 ? "part" : "parts"} tagged` : "Tag seasons or episodes"}</Text></View>
                  <Ionicons name={pickerOpen ? "chevron-up" : "chevron-down"} size={15} color={colors.muted} />
                </Pressable>
                {labels.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.journalDraftTags}>{labels.map(label => <Text key={label} style={styles.journalEntryBlockTag}>{label}</Text>)}</ScrollView> : null}
                {pickerOpen ? <View style={styles.journalTargetPicker}>
                  {targetSeasons.map(targetSeason => {
                    const wholeSeason = section.seasonIds.includes(targetSeason.id);
                    const chosenEpisodes = targetSeason.episodes.filter(targetEpisode => section.episodeIds.includes(targetEpisode.id)).length;
                    const expandedKey = `${section.key}:${targetSeason.id}`;
                    const expanded = expandedSeasonKeys.has(expandedKey);
                    return <View key={targetSeason.id} style={styles.journalTargetSeason}>
                      <View style={[styles.journalTargetSeasonRow, (wholeSeason || chosenEpisodes > 0) && styles.journalTargetSeasonRowActive]}>
                        <Pressable onPress={() => toggleSeason(section.key, targetSeason)} style={styles.journalTargetSeasonSelect}>
                          <View style={[styles.journalTargetCheck, wholeSeason && styles.journalTargetCheckActive]}>{wholeSeason ? <Ionicons name="checkmark" size={13} color="#101010" /> : null}</View>
                          <View style={styles.journalTargetSeasonCopy}><Text style={styles.journalTargetSeasonName}>Season {targetSeason.seasonNumber}</Text>{chosenEpisodes ? <Text style={styles.journalTargetSeasonCount}>{chosenEpisodes} {chosenEpisodes === 1 ? "episode" : "episodes"} selected</Text> : null}</View>
                        </Pressable>
                        {targetSeason.episodes.length ? <Pressable onPress={() => toggleSeasonExpanded(section.key, targetSeason.id)} style={styles.journalTargetExpand}><Text style={styles.journalTargetExpandText}>{expanded ? "Hide" : "Episodes"}</Text><Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={14} color={colors.muted} /></Pressable> : null}
                      </View>
                      {expanded ? <View style={styles.journalEpisodePicker}>{targetSeason.episodes.map(targetEpisode => {
                        const selected = section.episodeIds.includes(targetEpisode.id);
                        return <Pressable key={targetEpisode.id} onPress={() => toggleEpisode(section.key, targetSeason, targetEpisode.id)} style={[styles.journalEpisodeOption, selected && styles.journalEpisodeOptionActive]}>
                          <View style={[styles.journalTargetCheck, selected && styles.journalTargetCheckActive]}>{selected ? <Ionicons name="checkmark" size={13} color="#101010" /> : null}</View>
                          <Text style={styles.journalEpisodeOptionText} numberOfLines={1}><Text style={styles.journalEpisodeCode}>E{targetEpisode.episodeNumber}</Text> · {targetEpisode.name}</Text>
                        </Pressable>;
                      })}</View> : null}
                    </View>;
                  })}
                  {labels.length ? <Pressable onPress={() => updateSection(section.key, current => ({ ...current, seasonIds: [], episodeIds: [] }))} style={styles.journalTargetClear}><Text style={styles.journalTargetClearText}>Clear tags</Text></Pressable> : null}
                </View> : null}
              </> : null}
            </View>;
          })}
          <Pressable onPress={() => setSections(current => [...current, createJournalSection()])} style={styles.journalAddSection}><Ionicons name="add" size={17} color={colors.accent} /><Text style={styles.journalAddSectionText}>Add another section</Text></Pressable>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.journalMoodRow}>{["Moved","Delighted","Shocked","Thoughtful","Heartbroken","Confused","Obsessed"].map(value => <Pressable key={value} onPress={() => setMood(current => current === value ? "" : value)} style={[styles.journalMoodChip, mood === value && styles.journalMoodChipActive]}><Text style={[styles.journalMoodChipText, mood === value && styles.journalMoodChipTextActive]}>{value}</Text></Pressable>)}</ScrollView>
          <View style={styles.journalComposerActions}><Pressable onPress={pickImages} style={styles.journalPhotoButton}><Ionicons name="images-outline" size={18} color={colors.text} /><Text style={styles.journalPhotoButtonText}>{assets.length ? `${assets.length} selected` : "Add images"}</Text></Pressable><Pressable disabled={busy || !sections.some(section => section.body.trim())} onPress={save} style={[styles.journalSaveButton, (!sections.some(section => section.body.trim()) || busy) && { opacity: .45 }]}>{busy ? <ActivityIndicator color="#101010" /> : <Text style={styles.journalSaveButtonText}>Keep memory</Text>}</Pressable></View>
        </View>
        <Text style={styles.journalTimelineTitle}>{entries.length ? "Your memories" : "The first page is yours"}</Text>
        {entries.map(entry => <View key={entry.id} style={styles.journalEntryMobile}><View style={styles.journalEntryMobileHeader}><Text style={styles.journalEntryDate}>{new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString(undefined, { dateStyle: "long" })}</Text>{entry.mood ? <Text style={styles.journalEntryMood}>{entry.mood}</Text> : null}</View>{entry.title ? <Text style={styles.journalEntryTitle}>{entry.title}</Text> : null}{entry.journal_entry_blocks?.length ? [...entry.journal_entry_blocks].sort((a, b) => a.position - b.position).map(block => <View key={block.id} style={styles.journalEntryBlockMobile}>{block.target_labels.length ? <View style={styles.journalEntryBlockTags}>{block.target_labels.map(label => <Text key={label} style={styles.journalEntryBlockTag}>{label}</Text>)}</View> : null}<Text style={styles.journalEntryBody}>{block.body}</Text></View>) : <Text style={styles.journalEntryBody}>{entry.body}</Text>}{entry.image_urls?.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.journalEntryImages}>{entry.image_urls.map(url => <RemoteImage key={url} uri={url} style={styles.journalEntryImage} resizeMode="cover" />)}</ScrollView> : null}<Pressable onPress={() => Alert.alert("Delete this memory?", "This cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => void remove(entry) }])} style={styles.journalDeleteButton}><Ionicons name="trash-outline" size={15} color={colors.muted} /><Text style={styles.journalDeleteText}>Delete</Text></Pressable></View>)}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

export function DetailListSheet({ visible, lists, busy, onClose, onToggle }: { visible: boolean; lists: ListMembership[]; busy: boolean; onClose: () => void; onToggle: (list: ListMembership) => Promise<void> }) {
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

export function SeriesProgressCard({ summary }: { summary: SeriesViewingSummary }) {
  const next = summary.nextSeasonNumber != null && summary.nextEpisodeNumber != null
    ? ` · Next S${summary.nextSeasonNumber} E${summary.nextEpisodeNumber}`
    : "";
  const icon = summary.rewatching ? "repeat-outline" : summary.label === "Completed" ? "checkmark-circle-outline" : "eye-outline";
  return (
    <View style={[styles.seriesProgressCard, summary.rewatching && styles.seriesProgressCardRewatching]}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <View style={styles.seriesProgressCopy}>
        <Text style={styles.seriesProgressTitle}>{summary.label}</Text>
        <Text style={styles.seriesProgressMeta}>{summary.watched} / {summary.total} episodes{next}</Text>
      </View>
    </View>
  );
}

export function RatingSource({ label, value, loading = false }: { label: string; value: string; loading?: boolean }) {
  return <View style={[styles.ratingSource, loading && styles.ratingSourceLoading]}><Text style={styles.ratingSourceLabel}>{label}</Text><View style={styles.ratingSourceValueRow}>{loading ? <ActivityIndicator size="small" color={colors.accent} /> : null}<Text style={[styles.ratingSourceValue, loading && styles.ratingSourceValueLoading]}>{value}</Text></View></View>;
}

export function mapDetailReview(review: any): ReviewItem[] {
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
    isPrivate: Boolean(review.is_private),
    kind: mediaRow.kind,
    mediaTitle: mediaRow.title,
    artwork: mediaRow.backdrop_path ?? mediaRow.poster_path ?? null,
    score: Number.isFinite(score) ? score : null,
    item: fromDbMedia(mediaRow)
  }];
}

export function mapTargetReview(review: any, item: MediaSummary, label: "season" | "episode"): ReviewItem[] {
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
    isPrivate: Boolean(review.is_private),
    kind: item.kind,
    targetLabel: label,
    mediaTitle: `${item.title} ${label}`,
    artwork: item.backdropPath ?? item.posterPath ?? null,
    score: Number.isFinite(score) ? score : null,
    item
  }];
}

export function SeasonsSection({ seasons, limited, onOpenSeason, onOpenAllSeasons }: { seasons: DetailSeason[]; limited: boolean; onOpenSeason: (season: DetailSeason) => void; onOpenAllSeasons: (seasons: DetailSeason[]) => void }) {
  return (
    <View style={styles.detailSection}>
      <View style={styles.seasonsHeader}>
        <View style={styles.seasonsHeaderCopy}>
          <Text style={styles.detailKicker}>The full story</Text>
          <Text style={styles.seasonsHeaderTitle}>Seasons & episodes</Text>
        </View>
        <Pressable onPress={() => onOpenAllSeasons(seasons)} hitSlop={10} style={styles.seasonsHeaderAction}>
          <Text style={styles.seasonsHeaderActionText}>All episodes & ratings</Text>
          <Ionicons name="arrow-forward" size={16} color={colors.muted} />
        </Pressable>
      </View>
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

export function TitleMediaPreview({ trailer, images }: { trailer?: DetailVideo; images: DetailImage[] }) {
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

export function CastSection({ cast, onOpen }: { cast: DetailPerson[]; onOpen: (entity: EntityTarget) => void }) {
  return <View style={styles.detailSection}><SectionTitle kicker="In front of the camera" title="Cast" /><View style={styles.castGrid}>{cast.map((person, index) => <Pressable disabled={!person.id} onPress={() => person.id && onOpen({ type: "person", id: person.id, name: person.name, subtitle: person.character, imagePath: person.profile_path ?? null })} key={`${person.id ?? person.name}-${index}`} style={styles.personCard}>{person.profile_path ? <RemoteImage uri={tmdbImage(person.profile_path, "w342")!} style={styles.personPhoto} /> : <View style={styles.personPhoto} />}<Text style={styles.personName} numberOfLines={1}>{person.name}</Text><Text style={styles.personRole} numberOfLines={1}>{person.character}</Text></Pressable>)}</View></View>;
}

export function CompanySection({ companies, onOpen }: { companies: DetailCompany[]; onOpen: (entity: EntityTarget) => void }) {
  return <View style={styles.detailSection}><SectionTitle kicker="Behind the production" title="Studios & companies" /><View style={styles.companyGrid}>{companies.map((company, index) => <Pressable disabled={!company.id} onPress={() => company.id && onOpen({ type: "company", id: company.id, name: company.name, imagePath: company.logo_path ?? null })} key={`${company.id ?? company.name}-${index}`} style={styles.companyCard}><View style={styles.companyLogo}>{company.logo_path ? <RemoteImage uri={tmdbImage(company.logo_path, "w342")!} style={styles.companyLogoImage} resizeMode="contain" /> : <Text style={styles.companyInitial}>{company.name.slice(0, 1)}</Text>}</View><Text style={styles.companyName} numberOfLines={2}>{company.name}</Text></Pressable>)}</View></View>;
}

export function DetailReviewsSection({ reviews, onOpen }: { reviews: ReviewItem[]; onOpen: (item: MediaSummary) => void }) {
  return <View style={styles.detailSection}><SectionTitle kicker="From the community" title="Reviews" />{reviews.length ? <View style={styles.reviewList}>{reviews.map(review => <ReviewRow key={review.id} review={review} alwaysExpandable onOpen={target => target.item && onOpen(target.item)} />)}</View> : <EmptyPanel title="No reviews yet" body="The opening line could be yours." />}</View>;
}

export function DetailMediaSection({ kicker, title, items, onOpen }: { kicker: string; title: string; items: MediaSummary[]; onOpen: (item: MediaSummary) => void }) {
  return <View style={styles.detailSection}><SectionTitle kicker={kicker} title={title} /><CardGrid items={items} onOpen={onOpen} onMenu={() => undefined} /></View>;
}

export function DetailScreen({ item, token, onBack, onHide }: { item: MediaSummary; token?: string; onBack: () => void; onHide: (item: MediaSummary) => void }) {
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

export function DetailAction({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.detailAction}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={styles.detailActionText}>{label}</Text>
    </View>
  );
}

export function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}
