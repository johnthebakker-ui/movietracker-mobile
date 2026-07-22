import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { styles } from "../../app/styles";
import type { HomeSection } from "../../app/types";
import { RemoteImage, SectionTitle, TitleCard } from "../../components";
import { titleYear, tmdbImage, userRatingLabel } from "../../config";
import { colors } from "../../theme";
import type { MediaSummary } from "../../types";

export function PosterRail({ section, onOpen, onMenu }: { section: HomeSection; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
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

export function RailCard({ item, onOpen, onMenu }: { item: MediaSummary; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
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

export function CardGrid({ items, onOpen, onMenu }: { items: MediaSummary[]; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  return (
    <View style={styles.inlineGrid}>
      {items.map(item => <TitleCard key={`${item.kind}-${item.id}`} item={item} onOpen={onOpen} onMenu={onMenu} />)}
    </View>
  );
}

export function SearchPanel({ query, onQuery, onSearch, onClear }: { query: string; onQuery: (value: string) => void; onSearch: () => void; onClear: () => void }) {
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

export function DiscoverHeading({ view, onTonight, onForYou }: { view?: string; onTonight: () => void; onForYou: () => void }) {
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
