import React from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, shadow } from "./theme";
import { countries, genres, ratingLabel, titleYear, tmdbImage } from "./config";
import type { AppTab, DiscoverFilters, MediaSummary, RecommendationFilters } from "./types";

const tabIcons: Record<AppTab, string> = { home: "⌂", discover: "◉", calendar: "▣", library: "▥", profile: "♙" };

export function AppHeader({ onProfile }: { onProfile: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.logoDot}><Text style={styles.logoIcon}>▣</Text></View>
      <Text style={styles.logoText}>MovieTracker</Text>
      <View style={styles.headerSpacer} />
      <HeaderButton label="⌕" />
      <HeaderButton label="♡" />
      <HeaderButton label="☾" />
      <Pressable onPress={onProfile} style={styles.avatar}><Text style={styles.avatarText}>J</Text></Pressable>
    </View>
  );
}

function HeaderButton({ label }: { label: string }) {
  return <View style={styles.headerButton}><Text style={styles.headerButtonText}>{label}</Text></View>;
}

export function BottomNav({ tab, onTab }: { tab: AppTab; onTab: (tab: AppTab) => void }) {
  const tabs: Array<{ key: AppTab; label: string }> = [
    { key: "home", label: "Home" },
    { key: "discover", label: "Discover" },
    { key: "calendar", label: "Calendar" },
    { key: "library", label: "Library" },
    { key: "profile", label: "Profile" }
  ];
  return (
    <View style={styles.bottomNav}>
      {tabs.map(item => (
        <Pressable key={item.key} onPress={() => onTab(item.key)} style={styles.navItem}>
          <Text style={[styles.navIcon, tab === item.key && styles.navActive]}>{tabIcons[item.key]}</Text>
          <Text style={[styles.navText, tab === item.key && styles.navActive]}>{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Hero({ item, onOpen }: { item: MediaSummary | null; onOpen: (item: MediaSummary) => void }) {
  if (!item) return <View style={[styles.hero, styles.heroEmpty]}><ActivityIndicator color={colors.accent} /></View>;
  const backdrop = tmdbImage(item.backdropPath || item.posterPath, "w780");
  return (
    <Pressable onPress={() => onOpen(item)} style={styles.hero}>
      {backdrop ? <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={styles.heroShade} />
      <View style={styles.heroCopy}>
        <Text style={styles.kicker}>THIS WEEK'S ESSENTIAL WATCH</Text>
        <Text style={styles.heroTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.meta}>{titleYear(item)} · {item.kind === "show" ? "Series" : "Film"} · {ratingLabel(item)}</Text>
        <Text style={styles.heroOverview} numberOfLines={4}>{item.overview || "A cinematic pick from the MovieTracker catalog."}</Text>
        <View style={styles.heroButton}><Text style={styles.heroButtonText}>▶ Explore title</Text></View>
      </View>
    </Pressable>
  );
}

export function SectionTitle({ kicker, title, action }: { kicker?: string; title: string; action?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <View>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        <Text style={styles.sectionHeading}>{title}</Text>
      </View>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
    </View>
  );
}

export function TitleCard({ item, onOpen, onMenu }: { item: MediaSummary; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  const image = tmdbImage(item.posterPath || item.backdropPath, "w500");
  return (
    <Pressable onPress={() => onOpen(item)} onLongPress={() => onMenu(item)} delayLongPress={280} style={styles.card}>
      <View style={styles.poster}>
        {image ? <Image source={{ uri: image }} style={styles.posterImage} resizeMode="cover" /> : <Text style={styles.posterFallback}>{item.title}</Text>}
        <Pressable onPress={() => onMenu(item)} style={styles.menuDot}><Text style={styles.menuDotText}>⋮</Text></Pressable>
        {item.communityRating ? <View style={styles.ratingBadge}><Text style={styles.ratingBadgeText}>{ratingLabel(item)}</Text></View> : null}
      </View>
      <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
      <View style={styles.cardMetaRow}>
        <Text style={styles.cardMeta}>{titleYear(item)}</Text>
        <Text style={styles.cardMeta}>{item.kind === "show" ? "Series" : "Film"}</Text>
      </View>
      {item.reason ? <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text> : null}
    </Pressable>
  );
}

export function FilterButton({ icon, label, value, onPress }: { icon: string; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.filterButton}>
      <Text style={styles.filterIcon}>{icon}</Text>
      <View style={styles.filterTextWrap}>
        <Text style={styles.filterLabel}>{label}</Text>
        <Text style={styles.filterValue} numberOfLines={1}>{value}</Text>
      </View>
      <Text style={styles.chevron}>⌄</Text>
    </Pressable>
  );
}

export function DiscoverFiltersCard({ filters, onChange, onSelect }: { filters: DiscoverFilters; onChange: (next: DiscoverFilters) => void; onSelect: (field: "kind" | "genre" | "country" | "sort") => void }) {
  return (
    <View style={styles.filtersCard}>
      <View style={styles.filterGrid}>
        <FilterButton icon="▣" label="Format" value={filters.kind === "all" ? "Movies & series" : filters.kind === "movie" ? "Movies" : "Series"} onPress={() => onSelect("kind")} />
        <FilterButton icon="☷" label="Genre" value={genres.find(g => g.value === filters.genre)?.label || "Every genre"} onPress={() => onSelect("genre")} />
        <FilterButton icon="◎" label="Country" value={countries.find(c => c.value === filters.country)?.label || "Every country"} onPress={() => onSelect("country")} />
        <FilterButton icon="⌄" label="Sort by" value={filters.sort === "rating" ? "Highest rated" : filters.sort === "newest" ? "Newest releases" : "Most popular"} onPress={() => onSelect("sort")} />
      </View>
      <View style={styles.yearBox}>
        <Text style={styles.yearLabel}>▣ Release year</Text>
        <TextInput value={filters.year} onChangeText={year => onChange({ ...filters, year: year.replace(/\D/g, "").slice(0, 4) })} placeholder="e.g. 2024" placeholderTextColor="#6f7477" keyboardType="number-pad" style={styles.yearInput} />
      </View>
    </View>
  );
}

export function RecommendationFiltersCard({ filters, onChange, onSelect, onRefresh }: { filters: RecommendationFilters; onChange: (next: RecommendationFilters) => void; onSelect: (field: "kind" | "genre" | "country") => void; onRefresh: () => void }) {
  return (
    <View style={styles.filtersCard}>
      <View style={styles.recoTop}>
        <FilterButton icon="▣" label="Format" value={filters.kind === "all" ? "Movies & series" : filters.kind === "movie" ? "Movies" : "Series"} onPress={() => onSelect("kind")} />
        <FilterButton icon="☷" label="Genre" value={genres.find(g => g.value === filters.genre)?.label || "Every genre"} onPress={() => onSelect("genre")} />
      </View>
      <View style={styles.yearBox}>
        <Text style={styles.yearLabel}>▣ Release year</Text>
        <TextInput value={filters.year} onChangeText={year => onChange({ ...filters, year: year.replace(/\D/g, "").slice(0, 4) })} placeholder="e.g. 2024" placeholderTextColor="#6f7477" keyboardType="number-pad" style={styles.yearInput} />
      </View>
      <View style={styles.checkRow}>
        <Pressable onPress={() => onChange({ ...filters, hideWatched: !filters.hideWatched })} style={styles.checkPill}><Text style={styles.checkBox}>{filters.hideWatched ? "☑" : "☐"}</Text><Text style={styles.checkText}>Hide watched</Text></Pressable>
        <Pressable onPress={() => onChange({ ...filters, hideListed: !filters.hideListed })} style={styles.checkPill}><Text style={styles.checkBox}>{filters.hideListed ? "☑" : "☐"}</Text><Text style={styles.checkText}>Hide titles in my lists</Text></Pressable>
      </View>
      <Pressable onPress={onRefresh} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Refresh picks</Text></Pressable>
    </View>
  );
}

export function PickerSheet({ title, visible, options, value, onClose, onPick }: { title: string; visible: boolean; options: Array<{ value: string; label: string }>; value: string; onClose: () => void; onPick: (value: string) => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView style={styles.sheetScroll}>
          {options.map(option => (
            <Pressable key={option.value} onPress={() => { onPick(option.value); onClose(); }} style={[styles.sheetOption, option.value === value && styles.sheetOptionActive]}>
              <Text style={styles.sheetOptionText}>{option.label}</Text>
              {option.value === value ? <Text style={styles.sheetCheck}>✓</Text> : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function ActionSheet({ item, visible, onClose, onOpen, onNotInterested }: { item: MediaSummary | null; visible: boolean; onClose: () => void; onOpen: (item: MediaSummary) => void; onNotInterested: (item: MediaSummary) => void }) {
  return (
    <Modal visible={visible && Boolean(item)} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <View style={styles.actionSheet}>
        <View style={styles.grabber} />
        <View style={styles.actionHeader}>
          <Text style={styles.actionTitle} numberOfLines={2}>{item?.title}</Text>
          <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeButtonText}>×</Text></Pressable>
        </View>
        <Text style={styles.actionSub}>Quick actions</Text>
        {item ? (
          <>
            <Pressable style={styles.actionRow} onPress={() => { onClose(); onOpen(item); }}><Text style={styles.actionIcon}>↗</Text><Text style={styles.actionText}>Open details</Text></Pressable>
            <Pressable style={styles.actionRow}><Text style={styles.actionIcon}>▦</Text><Text style={styles.actionText}>Add to watchlist</Text></Pressable>
            <Pressable style={styles.actionRow}><Text style={styles.actionIcon}>✓</Text><Text style={styles.actionText}>Mark watched</Text></Pressable>
            <Pressable style={styles.actionRow}><Text style={styles.actionIcon}>♡</Text><Text style={styles.actionText}>Add to favorites</Text></Pressable>
            <View style={styles.actionDivider} />
            <Pressable style={styles.actionRow} onPress={() => onNotInterested(item)}><Text style={[styles.actionIcon, styles.dangerText]}>⊘</Text><Text style={[styles.actionText, styles.dangerText]}>Not interested</Text></Pressable>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  header: { height: 86, paddingHorizontal: 18, paddingTop: 28, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", backgroundColor: "#080a0a" },
  logoDot: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  logoIcon: { color: colors.text, fontWeight: "900", fontSize: 18 },
  logoText: { color: colors.text, fontSize: 24, fontWeight: "900", marginLeft: 10 },
  headerSpacer: { flex: 1 },
  headerButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  headerButtonText: { color: colors.text, fontSize: 22, fontWeight: "700" },
  avatar: { width: 42, height: 42, borderRadius: 21, marginLeft: 8, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.text, fontWeight: "900" },
  bottomNav: { position: "absolute", left: 14, right: 14, bottom: 18, height: 74, borderRadius: 30, borderWidth: 1, borderColor: colors.line, backgroundColor: "rgba(18, 22, 23, 0.98)", flexDirection: "row", justifyContent: "space-around", alignItems: "center", ...shadow },
  navItem: { alignItems: "center", justifyContent: "center", minWidth: 58 },
  navIcon: { color: colors.muted, fontSize: 23, fontWeight: "900" },
  navText: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 4 },
  navActive: { color: colors.accent },
  hero: { height: 430, borderRadius: 30, overflow: "hidden", marginHorizontal: 18, marginTop: 18, backgroundColor: colors.panel, justifyContent: "flex-end" },
  heroEmpty: { alignItems: "center", justifyContent: "center" },
  heroShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.35)" },
  heroCopy: { padding: 24, paddingBottom: 30 },
  kicker: { color: colors.accent, letterSpacing: 4, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  heroTitle: { color: colors.text, fontSize: 54, lineHeight: 56, fontFamily: "serif", marginTop: 10 },
  meta: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 12 },
  heroOverview: { color: colors.text, fontSize: 16, lineHeight: 24, marginTop: 16, maxWidth: 620 },
  heroButton: { alignSelf: "flex-start", marginTop: 20, backgroundColor: colors.accent, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12 },
  heroButtonText: { color: colors.text, fontWeight: "900" },
  sectionTitle: { marginTop: 36, marginBottom: 14, paddingHorizontal: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  sectionHeading: { color: colors.text, fontSize: 42, lineHeight: 48, fontFamily: "serif" },
  sectionAction: { color: colors.muted, fontWeight: "900" },
  card: { width: "50%", paddingHorizontal: 10, marginBottom: 24, userSelect: "none" as never },
  poster: { aspectRatio: 0.68, borderRadius: 18, overflow: "hidden", backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  posterImage: { width: "100%", height: "100%" },
  posterFallback: { color: colors.muted, textAlign: "center", padding: 18, fontSize: 17, fontWeight: "800" },
  menuDot: { position: "absolute", top: 10, left: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  menuDotText: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: -4 },
  ratingBadge: { position: "absolute", top: 10, right: 10, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.62)", paddingHorizontal: 10, paddingVertical: 6 },
  ratingBadgeText: { color: colors.text, fontWeight: "900" },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 10 },
  cardMetaRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 4 },
  cardMeta: { color: colors.muted, fontSize: 15 },
  reason: { color: colors.muted, marginTop: 8, fontSize: 13, lineHeight: 18 },
  filtersCard: { marginHorizontal: 18, marginTop: 18, padding: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, borderRadius: 26 },
  filterGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  recoTop: { flexDirection: "row", gap: 12 },
  filterButton: { flex: 1, minWidth: "45%", minHeight: 76, borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", backgroundColor: colors.panel2 },
  filterIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.accentSoft, color: colors.accent, textAlign: "center", textAlignVertical: "center", fontSize: 20, fontWeight: "900", marginRight: 12 },
  filterTextWrap: { flex: 1 },
  filterLabel: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  filterValue: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 2 },
  chevron: { color: colors.text, fontSize: 20, fontWeight: "900" },
  yearBox: { marginTop: 16, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 16 },
  yearLabel: { color: colors.muted, fontSize: 18, marginBottom: 10 },
  yearInput: { height: 58, borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 16, color: colors.text, fontSize: 19, backgroundColor: colors.panel2 },
  checkRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  checkPill: { flex: 1, borderRadius: 16, backgroundColor: colors.panel2, padding: 14, flexDirection: "row", alignItems: "center" },
  checkBox: { color: colors.text, fontSize: 20, marginRight: 10 },
  checkText: { color: colors.text, fontWeight: "900", flex: 1 },
  primaryButton: { marginTop: 16, height: 60, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent },
  primaryButtonText: { color: colors.text, fontSize: 18, fontWeight: "900" },
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { position: "absolute", left: 14, right: 14, bottom: 100, maxHeight: "58%", borderRadius: 26, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, padding: 10, ...shadow },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: "#4a5052", alignSelf: "center", marginBottom: 10 },
  sheetTitle: { color: colors.muted, letterSpacing: 2, fontSize: 12, fontWeight: "900", marginHorizontal: 12, marginBottom: 8, textTransform: "uppercase" },
  sheetScroll: { maxHeight: 360 },
  sheetOption: { minHeight: 58, borderRadius: 16, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetOptionActive: { backgroundColor: colors.panel2 },
  sheetOptionText: { color: colors.text, fontSize: 20 },
  sheetCheck: { color: colors.text, fontSize: 20, fontWeight: "900" },
  actionSheet: { position: "absolute", left: 14, right: 14, bottom: 100, borderRadius: 28, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, padding: 18, ...shadow },
  actionHeader: { flexDirection: "row", alignItems: "flex-start" },
  actionTitle: { color: colors.text, flex: 1, fontSize: 22, fontWeight: "900" },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  closeButtonText: { color: colors.text, fontSize: 24, marginTop: -2 },
  actionSub: { color: colors.muted, marginTop: 4, marginBottom: 14, fontSize: 14 },
  actionRow: { minHeight: 54, flexDirection: "row", alignItems: "center", borderRadius: 14, paddingHorizontal: 10 },
  actionIcon: { width: 38, color: colors.text, fontSize: 22 },
  actionText: { color: colors.text, fontSize: 17, fontWeight: "800" },
  actionDivider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  dangerText: { color: colors.danger }
});
