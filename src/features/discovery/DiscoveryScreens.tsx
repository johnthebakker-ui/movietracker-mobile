import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";

import { fetchTonight, fetchUpNext, fetchWrapped, fetchWrappedShare } from "../../api";
import { formatShortDate, minutesToLabel } from "../../app/date-utils";
import { styles } from "../../app/styles";
import type { GenreStat, ProfileData, TrackedStatus } from "../../app/types";
import { RemoteImage, SectionTitle } from "../../components";
import { EmptyPanel } from "../../components/EmptyPanel";
import { tmdbImage } from "../../config";
import { CardGrid } from "../library/LibraryComponents";
import { ChoiceChips, ProfileHistorySection } from "../profile/ProfileSections";
import { RatingLegend } from "../ratings/RatingTable";
import { colors } from "../../theme";
import type { MediaSummary } from "../../types";
import { episodeTargetForUpNext, type UpNextEntry } from "../../up-next-navigation";

const trackedStatusOrder: TrackedStatus[] = ["completed", "watching", "planned", "paused", "dropped"];

export function TonightScreen({ token, onBack, onOpen }: { token?: string; onBack: () => void; onOpen: (item: MediaSummary) => void }) {
  const [filters, setFilters] = useState({ minutes: "120", mood: "comforting", kind: "movie", company: "solo", source: token ? "personal" : "generic", services: "" });
  const [picks, setPicks] = useState<Array<{ item: MediaSummary; reason: string }>>([]); const [busy, setBusy] = useState(false); const [exclude, setExclude] = useState<string[]>([]); const [message, setMessage] = useState("");
  const choose = async (blocked?: string) => {
    if (busy) return;
    setBusy(true); setMessage("");
    const next = blocked ? [...exclude, blocked] : exclude;
    if (blocked) setExclude(next);
    try {
      const data = await fetchTonight({ ...filters, exclude: next.join(",") }, token);
      const nextPicks = data.picks ?? [];
      setPicks(nextPicks);
      if (data.resetExclusions) setExclude([]);
      if (!nextPicks.length) setMessage("No strong matches for every filter yet. Try a different service, mood, or available time.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Could not choose titles right now. Please try again.");
    } finally { setBusy(false); }
  };
  const row = (label: string, key: keyof typeof filters, values: Array<[string, string]>) => <View style={styles.featureField}><Text style={styles.featureLabel}>{label}</Text><ChoiceChips values={values} value={filters[key]} onChange={value => setFilters(current => ({ ...current, [key]: value }))} /></View>;
  const moods: Array<[string, string]> = filters.company === "date" ? [["romantic", "Romantic"], ["funny", "Funny"], ["comforting", "Comforting"], ["intense", "Intense"], ["emotional", "Emotional"], ["weird", "Weird"]] : [["comforting", "Comforting"], ["intense", "Intense"], ["funny", "Funny"], ["weird", "Weird"], ["emotional", "Emotional"]];
  return <View style={styles.profileSection}><SectionTitle kicker="Decision mode" title="What should we watch tonight?" action="Back ->" onAction={onBack} /><Text style={styles.featureIntro}>A few useful questions, then three strong choices. No endless grid.</Text><View style={styles.featureForm}>{row("Available time", "minutes", [["30", "30 min"], ["60", "1 hour"], ["90", "90 min"], ["120", "2+ hours"]])}{row("Who is watching?", "company", [["solo", "Solo"], ["date", "Date night"], ["family", "Family"], ["group", "Group"]])}{row("Mood", "mood", moods)}{row("Format", "kind", [["movie", "Movie"], ["show", "Series"]])}{row("Choose from", "source", token ? [["personal", "For me"], ["generic", "Surprise me"], ["new", "Something new"], ["saved", "Already saved"]] : [["generic", "Surprise me"], ["new", "Something new"]])}{row("Streaming service", "services", [["", "Any"], ["netflix", "Netflix"], ["prime", "Prime"], ["disney", "Disney+"], ["max", "Max"], ["apple", "Apple TV+"]])}<Pressable disabled={busy} onPress={() => void choose()} style={[styles.featurePrimary, busy && styles.disabledButton]}>{busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="sparkles-outline" size={20} color="#fff" />}<Text style={styles.featurePrimaryText}>{busy ? "Choosing..." : "Give me three choices"}</Text></Pressable>{message ? <Text style={styles.tonightMessage}>{message}</Text> : null}</View>{picks.map(({ item, reason }) => <View style={styles.tonightMobileCard} key={`${item.kind}-${item.id}`}><Pressable onPress={() => onOpen(item)}><RemoteImage uri={tmdbImage(item.backdropPath || item.posterPath, "w780")} style={styles.tonightMobileArt} resizeMode="cover" /></Pressable><Text style={styles.kickerText}>{item.kind === "movie" ? "Film" : "Series"}</Text><Text style={styles.tonightMobileTitle}>{item.title}</Text><Text style={styles.tonightReason}>{reason}</Text><View style={styles.featureChoices}>{[["Wrong mood", "close-circle-outline"], ["Seen it", "checkmark-circle-outline"], ["Too long", "time-outline"]].map(([label, icon]) => <Pressable key={label} onPress={() => void choose(`${item.kind}-${item.id}`)} style={styles.featureChoice}><Ionicons name={icon as any} size={15} color={colors.muted} /><Text style={styles.featureChoiceText}>{label}</Text></Pressable>)}</View></View>)}</View>;
}

export function UpNextScreen({ token, onBack, onOpen }: { token: string; onBack: () => void; onOpen: (entry: UpNextEntry) => void }) {
  const [minutes, setMinutes] = useState("120"); const [data, setData] = useState<any>(null); const [busy, setBusy] = useState(true);
  useEffect(() => { let live = true; setBusy(true); fetchUpNext(token, Number(minutes)).then(value => live && setData(value)).finally(() => live && setBusy(false)); return () => { live = false; }; }, [minutes, token]);
  const shelf = (title: string, items: UpNextEntry[]) => items?.length ? (
    <View style={styles.featureShelf}>
      <View style={styles.upNextShelfHead}><Text style={styles.upNextShelfTitle}>{title}</Text><Text style={styles.upNextShelfCount}>{items.length}</Text></View>
      {items.map(entry => <Pressable key={`${title}-${entry.item.kind}-${entry.item.id}-${entry.seasonNumber ?? 0}-${entry.episodeNumber ?? 0}`} onPress={() => onOpen(entry)} style={styles.upNextMobileRow}>
        <RemoteImage uri={tmdbImage(entry.item.backdropPath || entry.item.posterPath, "w500")} style={styles.upNextMobileArt} resizeMode="cover" />
        <View style={styles.upNextMobileCopy}><Text style={styles.upNextKicker}>{entry.label}</Text><Text numberOfLines={1} style={styles.upNextMobileTitle}>{entry.item.title}</Text><Text numberOfLines={1} style={styles.upNextMobileSubtitle}>{entry.episodeTitle || entry.reason}</Text><Text numberOfLines={1} style={styles.upNextMobileMeta}>{entry.runtime ?? "?"} min · {entry.reason}</Text></View>
        <Ionicons name="chevron-forward" size={18} color={colors.muted} />
      </Pressable>)}
    </View>
  ) : null;
  return <View style={styles.profileSection}><SectionTitle kicker="Your unfinished viewing" title="Up Next" action="Back ->" onAction={onBack} /><Text style={styles.featureIntro}>What is ready, nearly finished, newly released, or waiting for you.</Text><View style={styles.eveningMobile}><Text style={styles.kickerText}>Clear an evening</Text><Text style={styles.eveningTitle}>Build a queue</Text><ChoiceChips values={[["60", "60 min"], ["90", "90 min"], ["120", "2 hours"], ["180", "3 hours"]]} value={minutes} onChange={setMinutes} />{data?.evening ? <><Text style={styles.eveningTotal}>{data.evening.minutes} of {minutes} min planned</Text>{(data.evening.items as UpNextEntry[]).map(entry => <Pressable key={`${entry.item.kind}-${entry.item.id}-${entry.seasonNumber ?? 0}-${entry.episodeNumber ?? 0}`} onPress={() => onOpen(entry)} style={styles.eveningQueueRow}><Text style={styles.upNextMobileTitle}>{entry.item.title}</Text><Text style={styles.featureLinkBody}>{entry.label} · {entry.runtime ?? 45} min</Text></Pressable>)}</> : null}</View>{busy ? <ActivityIndicator color={colors.accent} /> : null}{shelf("Watch next", data?.entries)}{shelf("New this week", data?.newThisWeek)}{shelf("Close to completion", data?.closeToCompletion)}{shelf("Pick it back up", data?.dormant)}</View>;
}

export function WrappedScreen({ token, onBack }: { token: string; onBack: () => void }) {
  const [data, setData] = useState<any>(null);
  const [sharing, setSharing] = useState(false);
  useEffect(() => { fetchWrapped(token).then(setData).catch(() => setData({ error: true })); }, [token]);
  if (!data) return <View style={styles.profileSection}><SectionTitle kicker="Your year" title="Wrapped" action="Back ->" onAction={onBack} /><ActivityIndicator color={colors.accent} /></View>;
  const cards = [[data.yearHours, "hours watched"], [data.movieEvents, "movie watches"], [data.seriesEvents, "episode watches"], [data.longestStreak, "day longest streak"], [data.monthHours, "hours this month"], [`${data.completionRate}%`, "series completion"], [data.productiveDay || "—", "top viewing day"], [data.languages?.[0]?.[0]?.toUpperCase() || "—", "top language"]];
  const heatByDate = new Map<string, number>((data.heatmap ?? []).map((day: any) => [String(day.date), Number(day.count) || 0]));
  const heatStart = new Date(`${data.year}-01-01T00:00:00Z`);
  const heatEnd = data.year === new Date().getUTCFullYear() ? new Date() : new Date(`${data.year}-12-31T00:00:00Z`);
  const heatDays: Array<{ date: string; count: number }> = [];
  for (const date = new Date(heatStart); date <= heatEnd; date.setUTCDate(date.getUTCDate() + 1)) {
    const key = date.toISOString().slice(0, 10);
    heatDays.push({ date: key, count: heatByDate.get(key) ?? 0 });
  }
  const leading = (heatStart.getUTCDay() + 6) % 7;
  const paddedHeat: Array<{ date: string; count: number } | null> = [...Array.from({ length: leading }, () => null), ...heatDays];
  const heatWeeks = Array.from({ length: Math.ceil(paddedHeat.length / 7) }, (_, index) => paddedHeat.slice(index * 7, index * 7 + 7));
  const share = async () => {
    setSharing(true);
    try {
      const snapshot = await fetchWrappedShare(token);
      await Share.share({ title: "My MovieTracker Wrapped", message: `${snapshot.url}\n\n${data.shareLine}`, url: Platform.OS === "ios" ? snapshot.url : undefined });
    } catch (reason) { Alert.alert("Could not share Wrapped", reason instanceof Error ? reason.message : "Please try again."); }
    finally { setSharing(false); }
  };
  return <View style={styles.profileSection}>
    <View style={styles.wrappedHeader}><Pressable onPress={onBack} style={styles.wrappedBack}><Ionicons name="chevron-back" size={17} color={colors.text} /><Text style={styles.wrappedBackText}>Statistics</Text></Pressable><Text style={styles.kickerText}>January 1 through today</Text><Text style={styles.wrappedTitle}>{data.year} Rewind</Text><Text style={styles.wrappedMobileLine}>{data.shareLine}</Text><Pressable disabled={sharing} style={styles.wrappedShareButton} onPress={() => void share()}>{sharing ? <ActivityIndicator size="small" color={colors.text} /> : <Ionicons name="share-social-outline" size={17} color={colors.accent} />}<Text style={styles.wrappedShareText}>{sharing ? "Building snapshot…" : "Share snapshot"}</Text></Pressable></View>
    <View style={styles.wrappedStatsGrid}>{cards.map(([value, label]) => <View style={styles.wrappedStatCard} key={String(label)}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.64} style={styles.wrappedStatValue}>{value}</Text><Text style={styles.wrappedStatLabel}>{label}</Text></View>)}</View>
    <View style={styles.wrappedSectionHead}><Text style={styles.kickerText}>Your viewing fingerprint</Text><Text style={styles.wrappedSectionTitle}>Taste, by the numbers</Text></View>
    <View style={styles.wrappedBars}>{(data.genres ?? []).map(([name, count]: [string, number]) => <View key={name} style={styles.wrappedMobileBar}><Text style={styles.genreStatName}>{name}</Text><View style={styles.genreStatBar}><View style={[styles.genreStatFill, { width: `${count / (data.genres[0]?.[1] || 1) * 100}%`, backgroundColor: colors.accent }]} /></View><Text style={styles.genreStatTotal}>{count}</Text></View>)}</View>
    <View style={styles.wrappedCalloutList}>{[["Highest-rated director", data.topDirector], ["Most-watched actor", data.mostWatchedActor], ["Most generous rating", data.generous ? `${data.generous.title} · ${data.generous.score}/10` : null], ["Harshest rating", data.harshest ? `${data.harshest.title} · ${data.harshest.score}/10` : null]].map(([label, value]) => <View key={label} style={styles.wrappedMobileCallout}><Text style={styles.wrappedCalloutLabel}>{label}</Text><Text style={styles.wrappedCalloutValue}>{value || "More watches needed"}</Text></View>)}</View>
    <View style={styles.wrappedSectionHead}><Text style={styles.kickerText}>Every watched day</Text><Text style={styles.wrappedSectionTitle}>Your viewing heatmap</Text><Text style={styles.wrappedHeatHint}>Darker squares are busier viewing days.</Text></View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.wrappedHeatScroll}>
      <View style={styles.wrappedHeatWeeks}>{heatWeeks.map((week, weekIndex) => <View key={weekIndex} style={styles.wrappedHeatWeek}>{week.map((day, dayIndex) => day ? <View accessibilityLabel={`${day.date}: ${day.count} watches`} key={day.date} style={[styles.wrappedHeatCell, day.count > 0 && styles.wrappedHeatCell1, day.count > 1 && styles.wrappedHeatCell2, day.count > 3 && styles.wrappedHeatCell3, day.count > 6 && styles.wrappedHeatCell4]} /> : <View key={`empty-${dayIndex}`} style={styles.wrappedHeatCellEmpty} />)}</View>)}</View>
    </ScrollView>
  </View>;
}

export function StatisticsPage({ data, onBack, onWrapped, onOpen, onGenreShelf }: { data: ProfileData; onBack: () => void; onWrapped: () => void; onOpen: (item: MediaSummary) => void; onGenreShelf: (offset: number) => void }) {
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
      <Pressable onPress={onWrapped} style={styles.wrappedEntryCard}><View style={styles.wrappedEntryIcon}><Ionicons name="sparkles-outline" size={21} color={colors.accent} /></View><View style={styles.wrappedEntryCopy}><Text style={styles.wrappedEntryEyebrow}>2026 Rewind</Text><Text style={styles.wrappedEntryTitle}>Your year, beautifully summarized</Text><Text style={styles.wrappedEntryBody}>Open your shareable viewing snapshot.</Text></View><Ionicons name="chevron-forward" size={19} color={colors.muted} /></Pressable>
      <View style={styles.statisticsGrid}>
        {cards.map(card => (
          <View key={card.label} style={styles.statisticsCard}>
            <Text style={styles.statisticsValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.5}>{card.value}</Text>
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

export function GenreStatRow({ genre, max, selected, onPress }: { genre: GenreStat; max: number; selected: boolean; onPress: () => void }) {
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

export function genreStatusColor(status: TrackedStatus) {
  if (status === "completed") return "#35cf86";
  if (status === "watching") return colors.accent;
  if (status === "planned") return "#6c8cff";
  if (status === "paused") return "#f1bf4a";
  return "#9b78b8";
}
