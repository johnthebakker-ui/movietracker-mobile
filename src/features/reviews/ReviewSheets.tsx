import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";

import { localDateKey, minutesToLabel } from "../../app/date-utils";
import { styles } from "../../app/styles";
import type { ReviewItem, WatchDateMode, WatchLogValues, WatchTimePoint } from "../../app/types";
import { SectionTitle } from "../../components";
import { colors } from "../../theme";

export function RatingSheet({ visible, value, busy, onClose, onSave }: { visible: boolean; value: number | null; busy: boolean; onClose: () => void; onSave: (value: number | null) => Promise<void> }) {
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

export function WatchLogSheet({ visible, title, releaseDate, runtime, busy, watched, onClose, onSave }: { visible: boolean; title: string; releaseDate?: string | null; runtime?: number | null; busy: boolean; watched?: boolean; onClose: () => void; onSave: (values: WatchLogValues) => Promise<void> }) {
  const now = new Date();
  const scrollRef = useRef<ScrollView>(null);
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

  function revealCustomActions() {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 180);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.modalScrim} onPress={onClose} />
      <KeyboardAvoidingView pointerEvents="box-none" behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={16} style={styles.modalKeyboardAvoider}>
      <View style={styles.watchLogSheet}>
        <View style={styles.grabber} />
        <ScrollView ref={scrollRef} style={styles.watchLogScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={Platform.OS === "ios"} contentContainerStyle={styles.watchLogScrollContent}>
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
              <TextInput value={date} onChangeText={setDate} onFocus={revealCustomActions} placeholder="YYYY-MM-DD" placeholderTextColor={colors.muted} style={[styles.settingsInput, styles.watchInput]} />
              <TextInput value={time} onChangeText={setTime} onFocus={revealCustomActions} placeholder="HH:mm" placeholderTextColor={colors.muted} style={[styles.settingsInput, styles.watchTimeInput]} />
            </View>
            <View style={styles.timePointRow}>
              {(["end", "start"] as WatchTimePoint[]).map(value => <Pressable key={value} onPress={() => setTimePoint(value)} style={[styles.timePointButton, timePoint === value && styles.timePointButtonActive]}><Text style={[styles.timePointText, timePoint === value && styles.timePointTextActive]}>{value === "end" ? "End time" : "Start time"}</Text></Pressable>)}
            </View>
            {timePoint === "start" && runtime ? <Text style={styles.watchHint}>The app will add {minutesToLabel(runtime)} and store the finished-at time, just like the website.</Text> : null}
          </View>
        </ScrollView>
        <Pressable disabled={busy} onPress={() => submit("custom")} style={[styles.settingsSave, styles.watchLogSave]}>{busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.settingsSaveText}>Save watch</Text>}</Pressable>
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ReviewComposerPanel({ existingReview, currentRating, busy, onSubmit }: { existingReview: ReviewItem | null; currentRating: number | null; busy: boolean; onSubmit: (values: { score: number | null; title: string; body: string; containsSpoilers: boolean; isPrivate: boolean }) => Promise<void> }) {
  const [score, setScore] = useState<number | null>(existingReview?.score ?? currentRating ?? null);
  const [title, setTitle] = useState(existingReview?.title === "Review" ? "" : existingReview?.title ?? "");
  const [body, setBody] = useState(existingReview?.body ?? "");
  const [containsSpoilers, setContainsSpoilers] = useState(Boolean(existingReview?.containsSpoilers));
  const [isPrivate, setIsPrivate] = useState(Boolean(existingReview?.isPrivate));

  useEffect(() => {
    setScore(existingReview?.score ?? currentRating ?? null);
    setTitle(existingReview?.title === "Review" ? "" : existingReview?.title ?? "");
    setBody(existingReview?.body ?? "");
    setContainsSpoilers(Boolean(existingReview?.containsSpoilers));
    setIsPrivate(Boolean(existingReview?.isPrivate));
  }, [currentRating, existingReview?.body, existingReview?.containsSpoilers, existingReview?.id, existingReview?.isPrivate, existingReview?.score, existingReview?.title]);

  async function submit() {
    try {
      await onSubmit({ score, title, body, containsSpoilers, isPrivate });
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
          <View style={styles.spoilerCopy}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.text} />
            <View style={{ flex: 1 }}>
              <Text style={styles.spoilerTitle}>Private review</Text>
              <Text style={styles.spoilerBody}>Only you can read it. Your score still counts.</Text>
            </View>
            <Switch value={isPrivate} onValueChange={setIsPrivate} thumbColor={isPrivate ? colors.accent : colors.muted} trackColor={{ false: colors.panel2, true: colors.accentSoft }} />
          </View>
          <Pressable disabled={busy} onPress={submit} style={styles.publishReviewButton}><Ionicons name="paper-plane-outline" size={17} color={colors.text} /><Text style={styles.publishReviewText}>{busy ? "Saving..." : existingReview ? "Update review" : "Publish review"}</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

export function ScoreControl({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(value.toFixed(1));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(value.toFixed(1)); }, [value]);
  const commit = (candidate = text) => {
    const parsed = Number(candidate.replace(",", "."));
    const next = Number.isFinite(parsed) ? clampRating(parsed) : value;
    onChange(next);
    setText(next.toFixed(1));
  };
  const step = (amount: number) => {
    const draft = Number(text.replace(",", "."));
    const next = clampRating((Number.isFinite(draft) ? draft : value) + amount);
    onChange(next);
    setText(next.toFixed(1));
  };
  return (
    <View style={styles.scoreControl}>
      <Pressable onPress={() => step(-0.1)} style={styles.scoreStepButton}><Ionicons name="remove" size={18} color={colors.text} /></Pressable>
      <TextInput
        value={text}
        onChangeText={input => {
          const draft = input.replace(/[^\d.,]/g, "").replace(/([.,].*)[.,]/, "$1");
          if (!/^(?:|[1-9]|10|[1-9][.,]\d?|10[.,]0?)$/.test(draft)) return;
          setText(draft);
          const normalized = draft.replace(",", ".");
          if (/^(?:10(?:\.0)?|[1-9](?:\.\d)?)$/.test(normalized)) onChange(Number(normalized));
        }}
        onFocus={() => { editing.current = true; }}
        onEndEditing={() => { editing.current = false; commit(); }}
        keyboardType="decimal-pad"
        maxLength={4}
        selectTextOnFocus
        returnKeyType="done"
        style={styles.scoreInput}
      />
      <Pressable onPress={() => step(0.1)} style={styles.scoreStepButton}><Ionicons name="add" size={18} color={colors.text} /></Pressable>
    </View>
  );
}

export function clampRating(value: number) {
  return Math.max(1, Math.min(10, Math.round(value * 10) / 10));
}

export function resolveWatchLogDate(values: WatchLogValues, releaseDate?: string | null, runtimeMinutes = 0) {
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
