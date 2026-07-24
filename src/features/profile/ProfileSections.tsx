import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { formatHistoryTime, formatLastWatched, formatShortDate, normalizeHistoryItemTime } from "../../app/date-utils";
import { firstRow, fromDbMedia } from "../../app/media-model";
import { styles } from "../../app/styles";
import type { HistoryFilter, HistoryItem, ProfileData, ProfilePanel, ReviewItem } from "../../app/types";
import { fetchMobileHistory, fetchMobileReviews } from "../../api";
import { EmptyPanel } from "../../components/EmptyPanel";
import { RemoteImage, SectionTitle } from "../../components";
import { tmdbImage } from "../../config";
import { compactProfileStatValue } from "../../profile-stats";
import { supabase } from "../../supabase";
import { colors } from "../../theme";
import type { MediaSummary } from "../../types";
import { CardGrid } from "../library/LibraryComponents";
import { ProfileMediaSection, ReviewRow } from "./ProfileComponents";

export function ProfileStatBand({ data, onNavigate }: { data: ProfileData; onNavigate?: (target: "library" | "history" | "reviews" | "statistics" | "lists") => void }) {
  const stats = [
    { icon: "film-outline" as const, value: data.historyUniqueTitles, label: "unique watched titles", shortLabel: "watched\ntitles", target: "history" as const },
    { icon: "time-outline" as const, value: data.watchEvents, label: "watch events", shortLabel: "watch\nevents", target: "history" as const },
    { icon: "speedometer-outline" as const, value: data.averageRating, label: "average rating", shortLabel: "average\nrating", target: "statistics" as const },
    { icon: "chatbox-outline" as const, value: data.reviewCount, label: "written reviews", shortLabel: "written\nreviews", target: "reviews" as const },
    { icon: "list-outline" as const, value: data.listCount, label: "custom lists", shortLabel: "custom\nlists", target: "lists" as const },
    { icon: "bookmark-outline" as const, value: data.trackedLibraryTitles, label: "unique saved titles across your watchlist, favorites, and custom lists", shortLabel: "saved\ntitles", target: "library" as const }
  ];
  return (
    <View style={styles.profileStats}>
      {stats.map(stat => (
        <Pressable accessibilityRole="button" accessibilityLabel={`${stat.value} ${stat.label}`} key={stat.label} onPress={() => onNavigate?.(stat.target)} style={({ pressed }) => [styles.profileStat, pressed && styles.profileStatPressed]}>
          <View style={styles.profileStatIcon}><Ionicons name={stat.icon} size={18} color={colors.accent} /></View>
          <View style={styles.profileStatCopy}>
            <Text style={styles.profileStatValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.65}>{compactProfileStatValue(stat.value)}</Text>
            <Text style={styles.profileStatLabel} numberOfLines={2}>{stat.shortLabel}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export function ProfileNav({ onChange }: { onChange: (value: ProfilePanel) => void }) {
  const tabs: Array<{ value: ProfilePanel; label: string }> = [
    { value: "journal", label: "Journal" },
    { value: "reviews", label: "Reviews" },
    { value: "history", label: "Full history" },
    { value: "statistics", label: "Statistics" }
  ];
  return (
    <View style={styles.profileNavOuter}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.profileNav}>
        {tabs.map(tab => (
          <Pressable key={tab.value} onPress={() => onChange(tab.value)} style={styles.profileNavPill}>
            <Text style={styles.profileNavText}>{tab.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

type ProfileJournalEntry = {
  id: string;
  title: string | null;
  body: string;
  mood: string | null;
  entry_date: string;
  created_at: string;
  media: unknown;
  journal_entry_blocks?: Array<{ id: string; position: number; body: string; target_labels: string[] }>;
};

export function FullJournalPage({ userId, onBack, onOpen }: { userId: string; onBack: () => void; onOpen: (item: MediaSummary) => void }) {
  const [entries, setEntries] = useState<ProfileJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    if (!supabase) {
      setError("Your private journal is unavailable right now.");
      setLoading(false);
      return () => { alive = false; };
    }
    const client = supabase;
    void (async () => {
      try {
        const { data, error: loadError } = await client
          .from("journal_entries")
          .select("id,title,body,mood,entry_date,created_at,media(*),journal_entry_blocks(id,position,body,target_labels)")
          .eq("user_id", userId)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false });
        if (!alive) return;
        if (loadError) setError(loadError.message);
        else setEntries((data ?? []) as ProfileJournalEntry[]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return entries;
    return entries.filter(entry => {
      const media = firstRow(entry.media) as any;
      const blocks = entry.journal_entry_blocks ?? [];
      return [entry.title, entry.body, entry.mood, media?.title, ...blocks.flatMap(block => [block.body, ...block.target_labels])]
        .some(value => String(value ?? "").toLocaleLowerCase().includes(needle));
    });
  }, [entries, query]);

  return (
    <View style={styles.profileSection}>
      <SectionTitle kicker="Private, personal, always yours" title="Your journal" action="Back to profile ->" onAction={onBack} />
      <View style={styles.profileJournalIntro}>
        <View style={styles.profileJournalIntroIcon}><Ionicons name="lock-closed" size={18} color={colors.accent} /></View>
        <View style={styles.profileJournalIntroCopy}>
          <Text style={styles.profileJournalIntroTitle}>{entries.length} {entries.length === 1 ? "memory" : "memories"} kept</Text>
          <Text style={styles.profileJournalIntroText}>Your thoughts and images are visible only to you.</Text>
        </View>
      </View>
      <View style={styles.profileJournalSearch}>
        <Ionicons name="search-outline" size={18} color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search titles, thoughts, seasons or episodes" placeholderTextColor={colors.muted} style={styles.profileJournalSearchInput} />
        {query ? <Pressable onPress={() => setQuery("")} hitSlop={8}><Ionicons name="close-circle" size={19} color={colors.muted} /></Pressable> : null}
      </View>
      {filtered.map(entry => {
        const mediaRow = firstRow(entry.media) as any;
        const item = mediaRow ? fromDbMedia(mediaRow) : null;
        const artwork = item ? tmdbImage(item.posterPath || item.backdropPath, "w342") : null;
        const blocks = [...(entry.journal_entry_blocks ?? [])].sort((a, b) => a.position - b.position);
        return (
          <Pressable key={entry.id} disabled={!item} onPress={() => item && onOpen(item)} style={styles.profileJournalEntry}>
            {artwork ? <RemoteImage uri={artwork} style={styles.profileJournalPoster} resizeMode="cover" /> : <View style={styles.profileJournalPosterFallback}><Ionicons name="book-outline" size={22} color={colors.muted} /></View>}
            <View style={styles.profileJournalEntryCopy}>
              <View style={styles.profileJournalMetaRow}>
                <Text style={styles.profileJournalDate}>{new Date(`${entry.entry_date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Text>
                {entry.mood ? <Text style={styles.profileJournalMood}>{entry.mood}</Text> : null}
              </View>
              <Text style={styles.profileJournalEntryTitle} numberOfLines={1}>{entry.title || mediaRow?.title || "Untitled memory"}</Text>
              {entry.title && mediaRow?.title ? <Text style={styles.profileJournalMedia} numberOfLines={1}>{mediaRow.title}</Text> : null}
              {blocks.flatMap(block => block.target_labels).length ? <View style={styles.profileJournalTags}>{blocks.flatMap(block => block.target_labels).slice(0, 3).map((label, index) => <Text key={`${label}-${index}`} style={styles.profileJournalTag}>{label}</Text>)}</View> : null}
              <Text style={styles.profileJournalExcerpt} numberOfLines={3}>{blocks[0]?.body || entry.body}</Text>
            </View>
            {item ? <Ionicons name="chevron-forward" size={17} color={colors.muted} /> : null}
          </Pressable>
        );
      })}
      {!loading && !filtered.length ? <EmptyPanel title={query ? "No matching memories" : "Your first page is waiting"} body={query ? "Try another title, thought, season or episode." : "Open a movie or series and tap My journal to keep a private thought."} /> : null}
      {loading ? <View style={styles.historyInlineLoading}><ActivityIndicator color={colors.accent} /><Text style={styles.historyInlineLoadingText}>Opening your journal...</Text></View> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

export function ProfileHistorySection({ items, onOpen, onMenu, onHistory }: { items: HistoryItem[]; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void; onHistory: () => void }) {
  if (!items.length) return null;
  return <View style={[styles.profileSection, styles.profileHistorySection]}><SectionTitle kicker="A dated viewing diary" title="Recent history" action="See complete history ->" onAction={onHistory} /><View style={styles.historyGrid}>{items.slice(0, 6).map(item => <HistoryCard key={item.id} item={item} onOpen={onOpen} onMenu={onMenu} />)}</View></View>;
}

export function FullHistoryPage({ data, token, onOpen, onMenu, onBack, onRemove, onScrollTop }: { data: ProfileData; token: string; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void; onBack: () => void; onRemove: (id: string, title: string, onResult?: (success: boolean) => void) => void; onScrollTop: () => void }) {
  const [items, setItems] = useState(() => data.history.map(normalizeHistoryItemTime));
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(data.history.length >= 40);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [removingIds, setRemovingIds] = useState<Set<string>>(() => new Set());
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
    setRemovingIds(current => new Set(current).add(id));
    onRemove(id, title, success => {
      if (success) setItems(current => current.filter(item => item.id !== id));
      setRemovingIds(current => { const next = new Set(current); next.delete(id); return next; });
    });
  }

  return (
    <View style={styles.profileSection}>
      <SectionTitle kicker="Every play, kept in order" title="Watch history" action="Back to profile ->" onAction={onBack} />
      <View style={styles.historySummary}>
        <HistorySummary icon="time-outline" value={data.watchEvents} label="watch events" />
        <HistorySummary icon="time-outline" value={`${data.screenTimeHours}h`} label="screen time" />
        <HistorySummary icon="film-outline" value={data.historyUniqueTitles} label="unique watched titles" last />
      </View>
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
          <View style={styles.historyTimeline}>
            {groups.map(group => <MemoHistoryDay key={group.dateKey} group={group} removingIds={removingIds} onOpen={onOpen} onMenu={onMenu} onRemove={removeItem} />)}
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

export function HistorySummary({ icon, value, label, last }: { icon: keyof typeof Ionicons.glyphMap; value: string | number; label: string; last?: boolean }) {
  return <View style={[styles.historySummaryCell, last && styles.historySummaryCellLast]}><Ionicons name={icon} size={18} color={colors.accent} /><Text style={styles.historySummaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.5}>{value}</Text><Text style={styles.historySummaryLabel}>{label}</Text></View>;
}

export function HistoryDay({ group, removingIds, onOpen, onMenu, onRemove }: { group: { dateTitle: string; dateSubtitle: string; items: HistoryItem[] }; removingIds: Set<string>; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void; onRemove: (id: string, title: string) => void }) {
  return (
    <View style={styles.historyDay}>
      <View style={styles.historyDayDate}><Text style={styles.historyDayTitle}>{group.dateTitle}</Text><Text style={styles.historyDaySub}>{group.dateSubtitle}</Text></View>
      <View style={styles.historyEventList}>{group.items.map(item => <MemoHistoryEventRow key={item.id} item={item} removing={removingIds.has(item.id)} onOpen={onOpen} onMenu={onMenu} onRemove={onRemove} />)}</View>
    </View>
  );
}

export function HistoryEventRow({ item, removing, onOpen, onMenu, onRemove }: { item: HistoryItem; removing: boolean; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void; onRemove: (id: string, title: string) => void }) {
  const image = tmdbImage(item.artwork, "w500");
  return (
    <Pressable disabled={removing} onPress={() => onOpen(item)} onLongPress={() => item.item && onMenu(item.item)} delayLongPress={280} style={[styles.historyEvent, removing && { opacity: .42 }]}>
      <View style={styles.historyEventArt}>{image ? <RemoteImage uri={image} style={styles.posterImage} resizeMode="cover" /> : <Ionicons name="film-outline" size={22} color={colors.muted} />}{item.rating != null ? <Text style={styles.historyRating}>{item.rating.toFixed(1)}<Text style={styles.historyRatingSmall}>/10</Text></Text> : null}</View>
      <View style={styles.historyEventCopy}>
        <Text style={styles.historyEventKicker}>{item.metaLabel}</Text>
        <Text style={styles.historyEventTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.historyEventSubtitle} numberOfLines={1}>{item.subtitle}</Text>
      </View>
      <View style={styles.historyEventMeta}>
        {item.rewatchNumber ? <View style={styles.historyMetaInline}><Ionicons name="refresh-outline" size={13} color={colors.accent} /><Text style={styles.historyRewatch}>Rewatch {item.rewatchNumber}</Text></View> : null}
        <Text style={styles.historyEventTime}>{item.timeLabel}</Text>
        <Pressable disabled={removing} onPress={() => onRemove(item.id, item.title)} hitSlop={10} style={styles.historyRemoveButton}>
          {removing ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="trash-outline" size={16} color={colors.danger} />}
        </Pressable>
      </View>
    </Pressable>
  );
}

const MemoHistoryDay = React.memo(HistoryDay);
const MemoHistoryEventRow = React.memo(HistoryEventRow);

export function HistoryCard({ item, onOpen, onMenu }: { item: HistoryItem; onOpen: (item: HistoryItem) => void; onMenu: (item: MediaSummary) => void }) {
  const image = tmdbImage(item.artwork, "w500");
  const badgeDate = item.dateKey && item.dateKey !== "unknown" ? new Date(`${item.dateKey}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : formatShortDate(item.date);
  return <Pressable onPress={() => onOpen(item)} onLongPress={() => item.item && onMenu(item.item)} delayLongPress={280} style={styles.historyCard}><View style={styles.historyArt}>{image ? <RemoteImage uri={image} style={styles.posterImage} resizeMode="cover" /> : null}{item.rating != null ? <Text style={styles.historyRating}>{item.rating.toFixed(1)}/10</Text> : null}{item.rewatchNumber ? <View style={styles.historyCardRewatch}><Ionicons name="refresh-outline" size={12} color={colors.accent} /><Text style={styles.historyCardRewatchText}>Rewatch {item.rewatchNumber}</Text></View> : null}<Text style={styles.historyDate}>{badgeDate}</Text></View><Text style={styles.historyTitle} numberOfLines={1}>{item.title}</Text><Text style={styles.historySub} numberOfLines={1}>{item.subtitle}</Text></Pressable>;
}

export function ProfileProgressSection({ data, onLibrary, onStatus, onWatching, onOpen, onMenu }: { data: ProfileData; onLibrary: () => void; onStatus: (status: "completed" | "active" | "dropped") => void; onWatching: () => void; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  return <View style={styles.profileSection}><SectionTitle kicker="Your viewing momentum" title="Progress" action="Open library ->" onAction={onLibrary} /><View style={styles.progressGroups}>{data.progressGroups.map(group => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${group.label.toLowerCase()} titles`} onPress={() => onStatus(group.key)} key={group.key} style={({ pressed }) => [styles.progressGroup, pressed && { opacity: .68 }]}><Text style={styles.progressCount}>{group.count}</Text><Text style={styles.progressLabel}>{group.label}</Text><View style={styles.miniPosters}>{group.posters.map((poster, index) => <Image key={`${poster}-${index}`} source={{ uri: poster }} style={styles.miniPoster} />)}</View></Pressable>)}</View><View style={styles.streakRow}><Ionicons name="flame-outline" size={30} color={colors.accent} /><View><Text style={styles.streakLabel}>Current streak</Text><Text style={styles.streakValue}>{data.currentStreak} {data.currentStreak === 1 ? "day" : "days"}</Text><Text style={styles.streakMeta}>Longest streak - {data.longestStreak} days</Text></View></View>{data.currentlyWatching.length ? <><View style={styles.profileSubhead}><Text style={styles.profileSubheadTitle}>Currently watching</Text><Pressable onPress={onWatching}><Text style={styles.profileSubheadAction}>{"See all ->"}</Text></Pressable></View><CardGrid items={data.currentlyWatching.slice(0, 4)} onOpen={onOpen} onMenu={onMenu} /></> : null}</View>;
}

export function ReviewSection({ reviews, onAll, onOpen }: { reviews: ReviewItem[]; onAll?: () => void; onOpen: (review: ReviewItem) => void }) {
  if (!reviews.length) return null;
  return <View style={styles.profileSection}><SectionTitle kicker="Your opinions, collected" title="Your reviews" action={onAll ? "See all reviews ->" : undefined} onAction={onAll} /><View style={styles.reviewList}>{reviews.slice(0, onAll ? 6 : reviews.length).map(review => <ReviewRow key={review.id} review={review} onOpen={onOpen} />)}</View></View>;
}

export function FullReviewsPage({ reviews, count, token, onBack, onOpen, onScrollTop }: { reviews: ReviewItem[]; count: number; token: string; onBack: () => void; onOpen: (review: ReviewItem) => void; onScrollTop: () => void }) {
  const [items, setItems] = useState<ReviewItem[]>(reviews);
  const [total, setTotal] = useState(count);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(count > reviews.length);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [reviewsError, setReviewsError] = useState("");

  useEffect(() => {
    let alive = true;
    setLoadingReviews(true);
    setReviewsError("");
    fetchMobileReviews(token, page).then(result => {
      if (!alive) return;
      setItems(result.items ?? []);
      setTotal(result.total ?? 0);
      setHasMore(Boolean(result.hasMore));
    }).catch(reason => {
      if (alive) setReviewsError(reason instanceof Error ? reason.message : "Could not load this reviews page.");
    }).finally(() => { if (alive) setLoadingReviews(false); });
    return () => { alive = false; };
  }, [page, token]);

  function changePage(nextPage: number) {
    setPage(Math.max(1, nextPage));
    onScrollTop();
  }

  return (
    <View style={styles.profileSection}>
      <SectionTitle kicker="Every take in one place" title="Your reviews" action="Back to profile ->" onAction={onBack} />
      <ProfileDestinationTotal icon="chatbox-outline" value={total} label="reviews written" detail="Your complete collection of film, series, season, and episode reviews" />
      {items.length ? <><View style={styles.reviewList}>{items.map(review => <ReviewRow key={review.id} review={review} onOpen={onOpen} />)}</View><View style={styles.historyPager}>
        <Pressable disabled={page === 1 || loadingReviews} onPress={() => changePage(page - 1)} style={[styles.historyPageButton, (page === 1 || loadingReviews) && styles.historyPageButtonDisabled]}><Ionicons name="chevron-back" size={18} color={colors.text} /><Text style={styles.historyPageButtonText}>Newer</Text></Pressable>
        <Text style={styles.historyPageLabel}>Page {page}</Text>
        <Pressable disabled={!hasMore || loadingReviews} onPress={() => changePage(page + 1)} style={[styles.historyPageButton, (!hasMore || loadingReviews) && styles.historyPageButtonDisabled]}><Text style={styles.historyPageButtonText}>Older</Text><Ionicons name="chevron-forward" size={18} color={colors.text} /></Pressable>
      </View></> : !loadingReviews ? <EmptyPanel title="No reviews yet" body="Reviews you write on MovieTracker will appear here." /> : null}
      {loadingReviews ? <View style={styles.historyInlineLoading}><ActivityIndicator color={colors.accent} /><Text style={styles.historyInlineLoadingText}>Loading reviews...</Text></View> : null}
      {reviewsError ? <Text style={styles.errorText}>{reviewsError}</Text> : null}
    </View>
  );
}

export function ProfileDestinationTotal({ icon, value, label, detail }: { icon: keyof typeof Ionicons.glyphMap; value: number | string; label: string; detail: string }) {
  return <View style={styles.profileDestinationTotal}><View style={styles.profileDestinationIcon}><Ionicons name={icon} size={19} color={colors.accent} /></View><Text style={styles.profileDestinationValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.5}>{value}</Text><View style={styles.profileDestinationCopy}><Text style={styles.profileDestinationLabel}>{label}</Text><Text style={styles.profileDestinationDetail} numberOfLines={2}>{detail}</Text></View></View>;
}

export function ChoiceChips({ values, value, onChange }: { values: Array<[string, string]>; value: string; onChange: (value: string) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featureChoices}>{values.map(([key, label]) => <Pressable key={key} onPress={() => onChange(key)} style={[styles.featureChoice, value === key && styles.featureChoiceActive]}><Text style={[styles.featureChoiceText, value === key && styles.featureChoiceTextActive]}>{label}</Text></Pressable>)}</ScrollView>;
}
