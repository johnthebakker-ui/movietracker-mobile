import { Ionicons } from "@expo/vector-icons";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from "react-native";

import { formatShortDate, isEditedReview } from "../../app/date-utils";
import { styles } from "../../app/styles";
import type { HistoryItem, MfaState, Profile, ProfileData, ReviewItem, UserList } from "../../app/types";
import { EmptyPanel } from "../../components/EmptyPanel";
import { RemoteImage, SectionTitle } from "../../components";
import { CardGrid } from "../library/LibraryComponents";
import { titleYear, tmdbImage } from "../../config";
import { colors } from "../../theme";
import type { MediaSummary } from "../../types";

export function ReviewRow({ review, onOpen, alwaysExpandable = false }: { review: ReviewItem; onOpen: (review: ReviewItem) => void; alwaysExpandable?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [bodyLineCount, setBodyLineCount] = useState(0);
  const image = tmdbImage(review.artwork, "w342");
  const score = typeof review.score === "number" ? review.score : null;
  const canExpand = alwaysExpandable ? review.body.trim().length > 0 : bodyLineCount > 2;
  useEffect(() => {
    setExpanded(false);
    setBodyLineCount(0);
  }, [review.body, review.id]);
  const hasReviewTarget = Boolean(review.item || review.seasonTarget || review.episodeTarget);
  const openReviewedTitle = () => hasReviewTarget && onOpen(review);
  return (
    <View style={styles.reviewRow}>
      <Pressable disabled={!hasReviewTarget} onPress={openReviewedTitle} accessibilityRole="button" accessibilityLabel={`Open ${review.mediaTitle}`} style={({ pressed }) => [styles.reviewTargetRow, pressed && styles.reviewTargetRowPressed]}>
        {image ? <RemoteImage uri={image} style={styles.reviewImage} resizeMode="cover" /> : <View style={styles.reviewImage} />}
        <View style={styles.reviewTargetCopy}>
          <View style={styles.reviewKindRow}>
            <Text style={styles.reviewKind}>{review.targetLabel === "episode" ? "Episode review" : review.targetLabel === "season" ? "Season review" : review.kind === "show" ? "Series review" : "Film review"}</Text>
            {review.isPrivate ? <View style={styles.reviewPrivateBadge}><Ionicons name="lock-closed-outline" size={11} color={colors.muted} /><Text style={styles.reviewPrivateText}>Private</Text></View> : null}
            {score != null ? <View style={styles.reviewScore}><Ionicons name="star" size={14} color="#ffc24b" /><Text style={styles.reviewScoreText}>{score.toFixed(1)}</Text></View> : null}
          </View>
          <Text style={styles.reviewMedia} numberOfLines={1}>{review.mediaTitle}</Text>
          <Text style={styles.reviewMeta} numberOfLines={1}>{review.targetMeta ?? (review.targetLabel === "episode" ? "Episode" : review.targetLabel === "season" ? "Season" : review.kind === "show" ? "Show" : "Movie")} - {formatShortDate(review.created_at)}{isEditedReview(review) ? " - edited" : ""}</Text>
        </View>
      </Pressable>
      <View style={styles.reviewCopy}>
        <Text style={styles.reviewTitle} numberOfLines={1}>{review.title}</Text>
        {!alwaysExpandable ? <Text accessible={false} pointerEvents="none" style={[styles.reviewBody, styles.reviewBodyMeasure]} onTextLayout={event => {
          const nextLineCount = event.nativeEvent.lines.length;
          if (nextLineCount !== bodyLineCount) setBodyLineCount(nextLineCount);
        }}>{review.body}</Text> : null}
        <Pressable disabled={!canExpand} onPress={() => setExpanded(value => !value)} accessibilityRole={canExpand ? "button" : undefined} accessibilityLabel={canExpand ? expanded ? "Show less" : "Read full review" : undefined}>
          <Text style={styles.reviewBody} numberOfLines={expanded ? undefined : 2}>{review.body}</Text>
          {canExpand ? <Text style={styles.reviewExpand}>{expanded ? "Show less" : "Read full review"}</Text> : null}
        </Pressable>
      </View>
    </View>
  );
}

export function ProfileMediaSection({ kicker, title, action, items, onAction, onOpen, onMenu }: { kicker: string; title: string; action: string; items: MediaSummary[]; onAction: () => void; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  if (!items.length) return null;
  return <View style={styles.profileSection}><SectionTitle kicker={kicker} title={title} action={action} onAction={onAction} /><CardGrid items={items} onOpen={onOpen} onMenu={onMenu} /></View>;
}

export function ProfileListsSection({ owner, lists, onOpenLists, onOpenList }: { owner: string; lists: UserList[]; onOpenLists: () => void; onOpenList: (list: UserList) => void }) {
  if (!lists.length) return null;
  return <View style={styles.profileSection}><SectionTitle kicker={`Curated by ${owner}`} title="Lists" action="Manage lists ->" onAction={onOpenLists} /><ListGrid lists={lists.slice(0, 6)} onOpen={onOpenList} /></View>;
}

export function ListGrid({ lists, onOpen }: { lists: UserList[]; onOpen?: (list: UserList) => void }) {
  if (!lists.length) return <EmptyPanel title="No lists yet" body="Create lists on the website and they will appear here." />;
  return <View style={styles.listGrid}>{lists.map(list => <Pressable key={list.id} onPress={() => onOpen?.(list)} style={styles.listCard}><PosterStack posters={list.posters} /><Text style={styles.listVisibility}>{list.visibility ?? "private"}</Text><Text style={styles.listName} numberOfLines={1}>{list.name}</Text><Text style={styles.listDescription} numberOfLines={2}>{list.description || "A hand-picked collection."}</Text><Text style={styles.listCount}>{list.count} {list.count === 1 ? "title" : "titles"}</Text></Pressable>)}</View>;
}

export function GroupedListContent({ groups, onOpen, onMenu }: { groups: Array<{ title: string; items: MediaSummary[] }>; onOpen: (item: MediaSummary) => void; onMenu: (item: MediaSummary) => void }) {
  if (!groups.some(group => group.items.length)) return <EmptyPanel title="No titles in this list" body="Add titles on the website and they will appear here." />;
  return <View>{groups.map(group => group.items.length ? <View key={group.title} style={styles.listGroupBlock}>{groups.length > 1 ? <Text style={styles.listGroupTitle}>{group.title}</Text> : null}<CardGrid items={group.items} onOpen={onOpen} onMenu={onMenu} /></View> : null)}</View>;
}

export function PosterStack({ posters }: { posters: string[] }) {
  return <View style={styles.posterStack}>{posters.slice(0, 4).map((poster, index) => <Image key={`${poster}-${index}`} source={{ uri: tmdbImage(poster, "w342") ?? poster }} style={[styles.stackPoster, { left: 16 + index * 32, transform: [{ rotate: `${(index - 1.5) * 5}deg` }] }]} />)}{!posters.length ? <Ionicons name="list-outline" size={38} color={colors.muted} /> : null}</View>;
}

export function ProfileShortcuts({ onCalendar, onHistory, onReviews, onSettings }: { onCalendar: () => void; onHistory: () => void; onReviews: () => void; onSettings: () => void }) {
  return <View style={styles.shortcuts}><Shortcut icon="settings-outline" title="Settings" body="Profile, privacy, security and integrations" onPress={onSettings} /><Shortcut icon="calendar-outline" title="Episode calendar" body="See what airs next" onPress={onCalendar} /><Shortcut icon="time-outline" title="Watch history" body="Browse your complete diary" onPress={onHistory} /><Shortcut icon="chatbox-outline" title="Your reviews" body="Open every review and its title" onPress={onReviews} /></View>;
}

export function Shortcut({ icon, title, body, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={styles.shortcut}><Ionicons name={icon} size={22} color={colors.accent} /><View><Text style={styles.shortcutTitle}>{title}</Text><Text style={styles.shortcutBody}>{body}</Text></View></Pressable>;
}

export function ProfileHero({ profile, session, data, fallbackName, onSettings }: { profile: Profile | null; session: Session; data: ProfileData; fallbackName: string; onSettings: () => void }) {
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

export function MfaPanel({ code, error, busy, onCode, onVerify }: { code: string; error?: string; busy: boolean; onCode: (code: string) => void; onVerify: () => void }) {
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
