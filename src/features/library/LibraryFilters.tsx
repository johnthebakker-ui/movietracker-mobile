import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View } from "react-native";

import { styles } from "../../app/styles";
import type { LibraryFilter } from "../../app/types";
import type { MediaKindFilter } from "../../media-kind-filter";
import { colors } from "../../theme";

export function LibraryFilters({ value, onChange }: { value: LibraryFilter; onChange: (value: LibraryFilter) => void }) {
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

export function MediaKindFilterControl({ value, onChange, inline = false }: { value: MediaKindFilter; onChange: (value: MediaKindFilter) => void; inline?: boolean }) {
  const options: Array<{ value: MediaKindFilter; label: string }> = [{ value: "both", label: "Both" }, { value: "movie", label: "Movies" }, { value: "show", label: "Shows" }];
  return <View style={[styles.mediaKindFilter, inline && styles.mediaKindFilterInline]}>{options.map(option => <Pressable accessibilityRole="button" accessibilityState={{ selected: value === option.value }} key={option.value} onPress={() => onChange(option.value)} style={({ pressed }) => [styles.mediaKindFilterOption, value === option.value && styles.mediaKindFilterOptionActive, pressed && styles.mediaKindFilterOptionPressed]}><Text style={[styles.mediaKindFilterText, value === option.value && styles.mediaKindFilterTextActive]}>{option.label}</Text></Pressable>)}</View>;
}
