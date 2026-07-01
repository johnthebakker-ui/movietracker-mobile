import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, shadow } from "./theme";
import { countries, excludeGenreOptions, genres, ratingLabel, titleYear, tmdbImage, userRatingLabel } from "./config";
import type { AppTab, DiscoverFilters, MediaSummary, RecommendationFilters } from "./types";

const logoIcon = require("../assets/logo.png");

const tabIcons: Record<AppTab, keyof typeof Ionicons.glyphMap> = {
  home: "home-outline",
  discover: "compass-outline",
  calendar: "calendar-outline",
  library: "library-outline",
  profile: "person-outline"
};

export type PickerAnchor = { x: number; y: number; width: number; height: number };

export function AppHeader({ session, onProfile, onSearch, onNotifications }: { session: Session | null; onProfile: () => void; onSearch: () => void; onNotifications?: () => void }) {
  const avatarUrl = (session?.user.user_metadata?.avatar_url || session?.user.user_metadata?.picture) as string | undefined;

  return (
    <View style={styles.header}>
      <View style={styles.logoDot}>
        <Image source={logoIcon} style={styles.logoImage} resizeMode="contain" />
      </View>
      <Text style={styles.logoText}>MovieTracker</Text>
      <View style={styles.headerSpacer} />
      <HeaderButton icon="search-outline" onPress={onSearch} />
      <HeaderButton icon="notifications-outline" onPress={onNotifications} />
      <Pressable onPress={onProfile} style={styles.avatar} hitSlop={8}>
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
        ) : (
          <Ionicons name={session ? "person" : "person-outline"} size={22} color={session ? colors.text : colors.muted} />
        )}
      </Pressable>
    </View>
  );
}

function HeaderButton({ icon, onPress }: { icon: keyof typeof Ionicons.glyphMap; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.headerButton} hitSlop={8}>
      <Ionicons name={icon} size={23} color={colors.text} />
    </Pressable>
  );
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
    <BlurView intensity={Platform.OS === "android" ? 35 : 55} tint="dark" style={styles.bottomNav}>
      <View style={styles.bottomNavTint} />
      {tabs.map(item => {
        const active = tab === item.key;
        return (
          <Pressable key={item.key} onPress={() => onTab(item.key)} style={styles.navItem} hitSlop={8}>
            <Ionicons name={tabIcons[item.key]} size={25} color={active ? colors.accent : colors.muted} />
            <Text style={[styles.navText, active && styles.navActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </BlurView>
  );
}

export function Hero({ item, index, count, onOpen, onPrevious, onNext }: { item: MediaSummary | null; index?: number; count?: number; onOpen: (item: MediaSummary) => void; onPrevious?: () => void; onNext?: () => void }) {
  if (!item) {
    return (
      <View style={[styles.hero, styles.heroEmpty]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const backdrop = tmdbImage(item.backdropPath || item.posterPath, "w780");
  return (
    <View style={styles.hero}>
      {backdrop ? <Image source={{ uri: backdrop }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      <View style={styles.heroShade} />
      <View style={styles.heroCopy}>
        <Text style={styles.kicker}>THIS WEEK'S ESSENTIAL WATCHES{count ? ` · ${(index ?? 0) + 1} OF ${count}` : ""}</Text>
        <Text style={styles.heroTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.meta}>{titleYear(item)} - {item.kind === "show" ? "Series" : "Film"} - {ratingLabel(item)}</Text>
        <Text style={styles.heroOverview} numberOfLines={4}>{item.overview || "A cinematic pick from the MovieTracker catalog."}</Text>
        <Pressable onPress={() => onOpen(item)} style={styles.heroButton}>
          <Ionicons name="play" size={16} color={colors.text} />
          <Text style={styles.heroButtonText}>Explore title</Text>
        </Pressable>
      </View>
      {count && count > 1 ? (
        <View style={styles.heroControls}>
          <Pressable onPress={onPrevious} style={styles.heroArrow} hitSlop={8}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <View style={styles.heroDots}>
            {Array.from({ length: count }).map((_, dotIndex) => (
              <View key={dotIndex} style={[styles.heroDot, dotIndex === index && styles.heroDotActive]} />
            ))}
          </View>
          <Pressable onPress={onNext} style={styles.heroArrow} hitSlop={8}>
            <Ionicons name="chevron-forward" size={24} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function SectionTitle({ kicker, title, action, onAction }: { kicker?: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionTitle}>
      <View style={styles.sectionTitleCopy}>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        <Text style={styles.sectionHeading}>{title}</Text>
      </View>
      {action ? (
        <Pressable onPress={onAction} hitSlop={12} style={styles.sectionActionButton}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function TitleCard({ item, onOpen, onMenu }: { item: MediaSummary; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  const image = tmdbImage(item.posterPath || item.backdropPath, "w500");
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
      style={styles.card}
    >
      <View style={styles.poster}>
        {image ? <Image source={{ uri: image }} style={styles.posterImage} resizeMode="cover" /> : <Text style={styles.posterFallback}>{item.title}</Text>}
        <Pressable onPress={() => onMenu(item)} style={styles.menuDot} hitSlop={10}>
          <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
        </Pressable>
        {userRatingLabel(item) ? (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingBadgeText}>{userRatingLabel(item)}</Text>
          </View>
        ) : null}
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

export function FilterButton({ icon, label, value, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; onPress: (anchor?: PickerAnchor) => void }) {
  const buttonRef = useRef<View>(null);
  const handlePress = () => {
    buttonRef.current?.measureInWindow((x, y, width, height) => onPress({ x, y, width, height }));
  };

  return (
    <Pressable ref={buttonRef} onPress={handlePress} style={styles.filterButton}>
      <View style={styles.filterIcon}>
        <Ionicons name={icon} size={22} color={colors.accent} />
      </View>
      <View style={styles.filterTextWrap}>
        <Text style={styles.filterLabel}>{label}</Text>
        <Text style={styles.filterValue} numberOfLines={1}>{value}</Text>
      </View>
      <Ionicons name="chevron-down" size={20} color={colors.text} />
    </Pressable>
  );
}

export function DiscoverFiltersCard({ filters, onChange, onSelect }: { filters: DiscoverFilters; onChange: (next: DiscoverFilters) => void; onSelect: (field: "kind" | "genre" | "country" | "sort" | "excludeGenres", anchor?: PickerAnchor) => void }) {
  const excludedLabel = filters.excludeGenres.length
    ? filters.excludeGenres.map(value => excludeGenreOptions.find(option => option.value === value)?.label || value).join(", ")
    : "Nothing excluded";

  return (
    <View style={styles.filtersCard}>
      <View style={styles.filterGrid}>
        <FilterButton icon="film-outline" label="Format" value={filters.kind === "all" ? "Movies & series" : filters.kind === "movie" ? "Movies" : "Series"} onPress={anchor => onSelect("kind", anchor)} />
        <FilterButton icon="options-outline" label="Genre" value={genres.find(g => g.value === filters.genre)?.label || "Every genre"} onPress={anchor => onSelect("genre", anchor)} />
        <FilterButton icon="earth-outline" label="Country" value={countries.find(c => c.value === filters.country)?.label || "Every country"} onPress={anchor => onSelect("country", anchor)} />
        <FilterButton icon="chevron-down" label="Sort by" value={filters.sort === "rating" ? "Highest rated" : filters.sort === "newest" ? "Newest releases" : "Most popular"} onPress={anchor => onSelect("sort", anchor)} />
        <FilterButton icon="ban-outline" label="Exclude genres" value={excludedLabel} onPress={anchor => onSelect("excludeGenres", anchor)} />
      </View>
      <YearFilter
        mode={filters.yearMode ?? "exact"}
        year={filters.year}
        fromYear={filters.fromYear ?? ""}
        toYear={filters.toYear ?? ""}
        onChange={values => onChange({ ...filters, ...values })}
      />
      <View style={styles.checkRow}>
        <CheckPill label="Hide watched" checked={filters.hideWatched} onPress={() => onChange({ ...filters, hideWatched: !filters.hideWatched })} />
        <CheckPill label="Hide titles in my lists" checked={filters.hideListed} onPress={() => onChange({ ...filters, hideListed: !filters.hideListed })} />
      </View>
    </View>
  );
}

export function RecommendationFiltersCard({ filters, onChange, onSelect, onRefresh }: { filters: RecommendationFilters; onChange: (next: RecommendationFilters) => void; onSelect: (field: "kind" | "genre" | "country" | "excludeGenres", anchor?: PickerAnchor) => void; onRefresh: () => void }) {
  const excludedLabel = filters.excludeGenres.length
    ? filters.excludeGenres.map(value => excludeGenreOptions.find(option => option.value === value)?.label || value).join(", ")
    : "Nothing excluded";

  return (
    <View style={styles.filtersCard}>
      <View style={styles.filterGrid}>
        <FilterButton icon="film-outline" label="Format" value={filters.kind === "all" ? "Movies & series" : filters.kind === "movie" ? "Movies" : "Series"} onPress={anchor => onSelect("kind", anchor)} />
        <FilterButton icon="options-outline" label="Genre" value={genres.find(g => g.value === filters.genre)?.label || "Every genre"} onPress={anchor => onSelect("genre", anchor)} />
        <FilterButton icon="earth-outline" label="Country" value={countries.find(c => c.value === filters.country)?.label || "Every country"} onPress={anchor => onSelect("country", anchor)} />
        <FilterButton icon="ban-outline" label="Exclude genres" value={excludedLabel} onPress={anchor => onSelect("excludeGenres", anchor)} />
      </View>
      <YearFilter
        mode={filters.yearMode ?? "exact"}
        year={filters.year}
        fromYear={filters.fromYear ?? ""}
        toYear={filters.toYear ?? ""}
        onChange={values => onChange({ ...filters, ...values })}
      />
      <View style={styles.checkRow}>
        <CheckPill label="Hide watched" checked={filters.hideWatched} onPress={() => onChange({ ...filters, hideWatched: !filters.hideWatched })} />
        <CheckPill label="Hide titles in my lists" checked={filters.hideListed} onPress={() => onChange({ ...filters, hideListed: !filters.hideListed })} />
      </View>
      <Pressable onPress={onRefresh} style={styles.primaryButton}>
        <Ionicons name="refresh" size={20} color={colors.text} />
        <Text style={styles.primaryButtonText}>Update picks</Text>
      </Pressable>
    </View>
  );
}

function CheckPill({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.checkPill}>
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={24} color={checked ? colors.accent : colors.text} />
      <Text style={styles.checkText}>{label}</Text>
    </Pressable>
  );
}

function YearFilter({ mode, year, fromYear, toYear, onChange }: { mode: "exact" | "range"; year: string; fromYear: string; toYear: string; onChange: (values: { yearMode?: "exact" | "range"; year?: string; fromYear?: string; toYear?: string }) => void }) {
  const sanitize = (value: string) => value.replace(/\D/g, "").slice(0, 4);
  return (
    <View style={styles.yearBox}>
      <View style={styles.yearHeader}>
        <View style={styles.yearHeadingCopy}>
          <Ionicons name="calendar-outline" size={20} color={colors.text} />
          <Text style={styles.yearLabel}>Release year</Text>
        </View>
        <View style={styles.yearModeRow}>
          <Pressable onPress={() => onChange({ yearMode: "exact" })} style={[styles.yearModePill, mode !== "range" && styles.yearModePillActive]}><Text style={styles.yearModeText}>Exact</Text></Pressable>
          <Pressable onPress={() => onChange({ yearMode: "range" })} style={[styles.yearModePill, mode === "range" && styles.yearModePillActive]}><Text style={styles.yearModeText}>Range</Text></Pressable>
        </View>
      </View>
      {mode === "range" ? (
        <View style={styles.yearRangeRow}>
          <TextInput value={fromYear} onChangeText={value => onChange({ fromYear: sanitize(value) })} placeholder="From" placeholderTextColor="#6f7477" keyboardType="number-pad" style={[styles.yearInput, styles.yearRangeInput]} />
          <Text style={styles.yearRangeTo}>to</Text>
          <TextInput value={toYear} onChangeText={value => onChange({ toYear: sanitize(value) })} placeholder="To" placeholderTextColor="#6f7477" keyboardType="number-pad" style={[styles.yearInput, styles.yearRangeInput]} />
        </View>
      ) : (
        <TextInput value={year} onChangeText={value => onChange({ year: sanitize(value) })} placeholder="e.g. 2024" placeholderTextColor="#6f7477" keyboardType="number-pad" style={styles.yearInput} />
      )}
    </View>
  );
}

export function PickerSheet({ title, visible, options, value, multiValues, anchor, onClose, onPick, onApply }: { title: string; visible: boolean; options: Array<{ value: string; label: string }>; value: string; multiValues?: string[]; anchor?: PickerAnchor; onClose: () => void; onPick: (value: string) => void; onApply?: (values: string[]) => void }) {
  const multi = Array.isArray(multiValues);
  const [draftValues, setDraftValues] = useState<string[]>(multiValues ?? []);
  const window = Dimensions.get("window");
  const sheetWidth = Math.min(360, window.width - 28);
  const anchoredStyle = anchor
    ? {
      left: Math.max(14, Math.min(anchor.x, window.width - sheetWidth - 14)),
      top: Math.min(anchor.y + anchor.height + 8, window.height - 420),
      right: undefined,
      bottom: undefined,
      width: sheetWidth
    }
    : null;

  useEffect(() => {
    if (visible) setDraftValues(multiValues ?? []);
  }, [multiValues, visible]);

  const selectedValues = onApply ? draftValues : multiValues ?? [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <View style={[styles.sheet, anchoredStyle]}>
        {!anchor ? <View style={styles.grabber} /> : null}
        <Text style={styles.sheetTitle}>{title}</Text>
        <ScrollView style={styles.sheetScroll}>
          {options.map(option => (
            <Pressable
              key={option.value}
              onPress={() => {
                if (multi && onApply) {
                  setDraftValues(current => current.includes(option.value) ? current.filter(item => item !== option.value) : [...current, option.value]);
                  return;
                }
                onPick(option.value);
                if (!multi) onClose();
              }}
              style={[styles.sheetOption, (multi ? selectedValues.includes(option.value) : option.value === value) && styles.sheetOptionActive]}
            >
              <Text style={styles.sheetOptionText}>{option.label}</Text>
              {(multi ? selectedValues.includes(option.value) : option.value === value) ? <Ionicons name="checkmark" size={22} color={colors.text} /> : null}
            </Pressable>
          ))}
        </ScrollView>
        {multi && onApply ? (
          <View style={styles.sheetActions}>
            <Pressable onPress={onClose} style={styles.sheetSecondaryButton}><Text style={styles.sheetSecondaryText}>Cancel</Text></Pressable>
            <Pressable onPress={() => { onApply(draftValues); onClose(); }} style={styles.sheetPrimaryButton}><Text style={styles.sheetPrimaryText}>Update</Text></Pressable>
          </View>
        ) : null}
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
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        <Text style={styles.actionSub}>Quick actions</Text>
        {item ? (
          <>
            <ActionRow icon="open-outline" label="Open details" onPress={() => { onClose(); onOpen(item); }} />
            <ActionRow icon="list-outline" label="Add to watchlist" />
            <ActionRow icon="checkmark" label="Mark watched" />
            <ActionRow icon="heart-outline" label="Add to favorites" />
            <View style={styles.actionDivider} />
            <ActionRow icon="ban-outline" label="Not interested" danger onPress={() => onNotInterested(item)} />
          </>
        ) : null}
      </View>
    </Modal>
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

export const styles = StyleSheet.create({
  header: { height: 82, paddingHorizontal: 18, paddingTop: 22, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: "row", alignItems: "center", backgroundColor: "#080a0a" },
  logoDot: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  logoImage: { width: 39, height: 39 },
  logoText: { color: colors.text, fontSize: 24, fontWeight: "900", marginLeft: 10, letterSpacing: -0.8 },
  headerSpacer: { flex: 1 },
  headerButton: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center", marginLeft: 8, backgroundColor: "rgba(14,18,19,0.86)" },
  avatar: { width: 42, height: 42, borderRadius: 21, marginLeft: 8, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  bottomNav: { position: "absolute", left: 14, right: 14, bottom: 18, height: 78, borderRadius: 30, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", overflow: "hidden", flexDirection: "row", justifyContent: "space-around", alignItems: "center", ...shadow },
  bottomNavTint: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(15, 20, 21, 0.86)" },
  navItem: { alignItems: "center", justifyContent: "center", minWidth: 58, height: "100%" },
  navText: { color: colors.muted, fontSize: 12, fontWeight: "800", marginTop: 5 },
  navActive: { color: colors.accent },
  hero: { height: 620, borderRadius: 0, overflow: "hidden", marginHorizontal: 0, marginTop: 0, backgroundColor: colors.panel, justifyContent: "flex-end" },
  heroEmpty: { alignItems: "center", justifyContent: "center" },
  heroShade: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.43)" },
  heroCopy: { padding: 26, paddingBottom: 88 },
  kicker: { color: colors.accent, letterSpacing: 4, fontSize: 11, fontWeight: "900", textTransform: "uppercase" },
  heroTitle: { color: colors.text, fontSize: 48, lineHeight: 50, fontFamily: "serif", marginTop: 10 },
  meta: { color: colors.text, fontSize: 13, fontWeight: "700", marginTop: 12 },
  heroOverview: { color: colors.text, fontSize: 16, lineHeight: 24, marginTop: 16, maxWidth: 620 },
  heroButton: { alignSelf: "flex-start", marginTop: 20, backgroundColor: colors.accent, borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  heroButtonText: { color: colors.text, fontWeight: "900" },
  heroControls: { position: "absolute", right: 24, bottom: 28, flexDirection: "row", alignItems: "center", gap: 10 },
  heroArrow: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)", backgroundColor: "rgba(0,0,0,0.42)", alignItems: "center", justifyContent: "center" },
  heroDots: { flexDirection: "row", alignItems: "center", gap: 6 },
  heroDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.34)" },
  heroDotActive: { width: 20, backgroundColor: colors.accent },
  sectionTitle: { marginTop: 36, marginBottom: 14, paddingHorizontal: 18, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 },
  sectionTitleCopy: { flex: 1 },
  sectionHeading: { color: colors.text, fontSize: 38, lineHeight: 44, fontFamily: "serif" },
  sectionActionButton: { paddingHorizontal: 6, paddingVertical: 8 },
  sectionAction: { color: colors.muted, fontWeight: "900", fontSize: 15 },
  card: { width: "50%", paddingHorizontal: 10, marginBottom: 24, userSelect: "none" as never },
  poster: { aspectRatio: 0.68, borderRadius: 10, overflow: "hidden", backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  posterImage: { width: "100%", height: "100%" },
  posterFallback: { color: colors.muted, textAlign: "center", padding: 18, fontSize: 17, fontWeight: "800" },
  menuDot: { position: "absolute", top: 10, left: 10, width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  ratingBadge: { position: "absolute", top: 10, right: 10, borderRadius: 18, backgroundColor: "rgba(0,0,0,0.62)", paddingHorizontal: 10, paddingVertical: 6 },
  ratingBadgeText: { color: colors.text, fontWeight: "900" },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "900", marginTop: 10 },
  cardMetaRow: { flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 4 },
  cardMeta: { color: colors.muted, fontSize: 15 },
  reason: { color: colors.muted, marginTop: 8, fontSize: 13, lineHeight: 18 },
  filtersCard: { marginHorizontal: 18, marginTop: 10, padding: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel, borderRadius: 22 },
  filterGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  filterButton: { flex: 1, minWidth: "45%", minHeight: 66, borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", backgroundColor: colors.panel2 },
  filterIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center", marginRight: 10 },
  filterTextWrap: { flex: 1, minWidth: 0 },
  filterLabel: { color: colors.muted, fontSize: 12, fontWeight: "900" },
  filterValue: { color: colors.text, fontSize: 16, fontWeight: "900", marginTop: 2 },
  yearBox: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 },
  yearHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  yearHeadingCopy: { flexDirection: "row", alignItems: "center", gap: 9, minWidth: 0 },
  yearLabel: { color: colors.muted, fontSize: 18 },
  yearModeRow: { flexDirection: "row", padding: 4, borderRadius: 12, backgroundColor: colors.panel2 },
  yearModePill: { minHeight: 30, paddingHorizontal: 10, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  yearModePillActive: { backgroundColor: colors.accent },
  yearModeText: { color: colors.text, fontSize: 12, fontWeight: "900" },
  yearInput: { height: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, color: colors.text, fontSize: 16, backgroundColor: colors.panel2 },
  yearRangeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  yearRangeInput: { flex: 1 },
  yearRangeTo: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  checkRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  checkPill: { flex: 1, minHeight: 48, borderRadius: 13, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.panel2, paddingHorizontal: 11, paddingVertical: 9, flexDirection: "row", alignItems: "center", gap: 8 },
  checkText: { color: colors.text, fontSize: 13, fontWeight: "900", flex: 1 },
  primaryButton: { marginTop: 16, height: 60, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.accent, flexDirection: "row", gap: 8 },
  primaryButtonText: { color: colors.text, fontSize: 18, fontWeight: "900" },
  modalScrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { position: "absolute", left: 14, right: 14, bottom: 100, maxHeight: "58%", borderRadius: 26, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, padding: 10, ...shadow },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: "#4a5052", alignSelf: "center", marginBottom: 10 },
  sheetTitle: { color: colors.muted, letterSpacing: 2, fontSize: 12, fontWeight: "900", marginHorizontal: 12, marginBottom: 8, textTransform: "uppercase" },
  sheetScroll: { maxHeight: 360 },
  sheetOption: { minHeight: 58, borderRadius: 16, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetOptionActive: { backgroundColor: colors.panel2 },
  sheetOptionText: { color: colors.text, fontSize: 20 },
  sheetActions: { flexDirection: "row", gap: 10, padding: 8, paddingTop: 12 },
  sheetSecondaryButton: { flex: 1, height: 48, borderRadius: 16, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  sheetSecondaryText: { color: colors.muted, fontWeight: "900" },
  sheetPrimaryButton: { flex: 1, height: 48, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  sheetPrimaryText: { color: colors.text, fontWeight: "900" },
  actionSheet: { position: "absolute", left: 14, right: 14, bottom: 100, borderRadius: 28, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, padding: 18, ...shadow },
  actionHeader: { flexDirection: "row", alignItems: "flex-start" },
  actionTitle: { color: colors.text, flex: 1, fontSize: 22, fontWeight: "900" },
  closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.panel2, alignItems: "center", justifyContent: "center" },
  actionSub: { color: colors.muted, marginTop: 4, marginBottom: 14, fontSize: 14 },
  actionRow: { minHeight: 54, flexDirection: "row", alignItems: "center", borderRadius: 14, paddingHorizontal: 10 },
  actionIcon: { width: 38 },
  actionText: { color: colors.text, fontSize: 17, fontWeight: "800" },
  actionDivider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  dangerText: { color: colors.danger }
});

