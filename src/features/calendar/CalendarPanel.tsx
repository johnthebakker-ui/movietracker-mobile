import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { calendarCells, calendarWeekDays, calendarWeekLabel, formatCalendarDate, localDateKey, shiftMonth, shiftWeek } from "../../app/date-utils";
import { styles } from "../../app/styles";
import type { CalendarEvent, CalendarMode, CalendarView } from "../../app/types";
import { EmptyPanel } from "../../components/EmptyPanel";
import { RemoteImage } from "../../components";
import { tmdbImage } from "../../config";
import { colors } from "../../theme";
import type { MediaSummary } from "../../types";

export function CalendarPanel({ mode, view, month, week, events, onMode, onView, onMonth, onWeek, onOpen, onMenu }: { mode: CalendarMode; view: CalendarView; month: string; week: string; events: CalendarEvent[]; onMode: (mode: CalendarMode) => void; onView: (view: CalendarView) => void; onMonth: (month: string) => void; onWeek: (week: string) => void; onOpen: (event: CalendarEvent) => void; onMenu: (item: MediaSummary) => void }) {
  const { cells, label: monthLabel } = calendarCells(month);
  const weekDates = calendarWeekDays(week);
  const label = view === "week" ? calendarWeekLabel(weekDates) : monthLabel;
  const currentDate = localDateKey();
  const defaultDate = view === "week" ? (weekDates.includes(currentDate) ? currentDate : weekDates[0]) : mode === "watched" ? `${month}-01` : currentDate.startsWith(`${month}-`) ? currentDate : `${month}-01`;
  const [selectedDate, setSelectedDate] = useState(defaultDate);
  const [posterCalendar, setPosterCalendar] = useState(false);
  useEffect(() => {
    setSelectedDate(view === "week" ? (weekDates.includes(currentDate) ? currentDate : weekDates[0]) : mode === "watched" ? `${month}-01` : currentDate.startsWith(`${month}-`) ? currentDate : `${month}-01`);
  }, [currentDate, mode, month, view, week]);
  const eventsByDate = new Map<string, CalendarEvent[]>();
  events.forEach(event => eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]));
  const eventDays = [...eventsByDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const orderedEventDays = eventDays.filter(([date]) => date >= selectedDate);
  const displayedDays = view === "week" ? [[selectedDate, eventsByDate.get(selectedDate) ?? []] as const] : orderedEventDays;
  return (
    <View style={styles.calendarWrap}>
      <View style={styles.segmented}>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === "upcoming" }} onPress={() => onMode("upcoming")} style={({ pressed }) => [styles.segment, mode === "upcoming" && styles.segmentActive, pressed && styles.calendarControlPressed]}><Text style={[styles.segmentText, mode === "upcoming" && styles.segmentTextActive]}>Upcoming</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === "watched" }} onPress={() => onMode("watched")} style={({ pressed }) => [styles.segment, mode === "watched" && styles.segmentActive, pressed && styles.calendarControlPressed]}><Text style={[styles.segmentText, mode === "watched" && styles.segmentTextActive]}>Watched</Text></Pressable>
      </View>
      <View style={styles.calendarControlRow}>
        <View style={styles.calendarViewSegmented}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: view === "month" }} onPress={() => onView("month")} style={({ pressed }) => [styles.calendarViewSegment, view === "month" && styles.calendarViewSegmentActive, pressed && styles.calendarControlPressed]}><Ionicons name="calendar-outline" size={15} color={view === "month" ? colors.text : colors.muted} /><Text style={[styles.calendarViewText, view === "month" && styles.calendarViewTextActive]}>Month</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: view === "week" }} onPress={() => onView("week")} style={({ pressed }) => [styles.calendarViewSegment, view === "week" && styles.calendarViewSegmentActive, pressed && styles.calendarControlPressed]}><Ionicons name="list-outline" size={15} color={view === "week" ? colors.text : colors.muted} /><Text style={[styles.calendarViewText, view === "week" && styles.calendarViewTextActive]}>Week</Text></Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: posterCalendar }} onPress={() => setPosterCalendar(value => !value)} style={({ pressed }) => [styles.calendarDisplayToggle, posterCalendar && styles.calendarDisplayToggleActive, pressed && styles.calendarControlPressed]}>
          <Ionicons name="image-outline" size={16} color={posterCalendar ? colors.accent : colors.muted} />
          <Text style={[styles.calendarDisplayToggleText, posterCalendar && styles.calendarDisplayToggleTextActive]}>Posters</Text>
        </Pressable>
      </View>
      <View style={styles.monthToolbar}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Previous ${view}`} onPress={() => view === "week" ? onWeek(shiftWeek(week, -1)) : onMonth(shiftMonth(month, -1))} style={({ pressed }) => [styles.monthButton, pressed && styles.calendarControlPressed]}><Ionicons name="chevron-back" size={21} color={colors.text} /></Pressable>
        <Text style={styles.monthTitle}>{label}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Next ${view}`} onPress={() => view === "week" ? onWeek(shiftWeek(week, 1)) : onMonth(shiftMonth(month, 1))} style={({ pressed }) => [styles.monthButton, pressed && styles.calendarControlPressed]}><Ionicons name="chevron-forward" size={21} color={colors.text} /></Pressable>
      </View>
      {view === "month" ? <View style={styles.calendarGrid}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}
        {cells.map((date, index) => {
          const dayEvents = date ? eventsByDate.get(date) ?? [] : [];
          const count = dayEvents.length;
          const today = date === currentDate;
          return (
            <Pressable key={date ?? `blank-${index}`} disabled={!date || !count} onPress={() => date && setSelectedDate(date)} style={[styles.dayCell, posterCalendar && styles.dayCellPosterMode, !date && styles.blankDay, today && styles.todayCell, date === selectedDate && styles.selectedDayCell]}>
              {date ? <View style={[styles.dayHeading, count > 0 && styles.dayHeadingWithCount]}><Text style={[styles.dayText, today && styles.todayText]}>{Number(date.slice(8, 10))}</Text>{count ? <Text style={styles.dayCount}>{count}</Text> : null}</View> : null}
              {posterCalendar && count ? <View style={styles.dayPosterStrip}>{dayEvents.slice(0, 2).map(event => {
                const thumb = tmdbImage(event.artwork, "w342");
                return thumb ? <RemoteImage key={event.id} uri={thumb} style={styles.dayPosterThumb} resizeMode="cover" /> : null;
              })}{count > 2 ? <Text style={styles.dayPosterMore}>+{count - 2}</Text> : null}</View> : null}
            </Pressable>
          );
        })}
      </View> : <View style={styles.calendarWeekStrip}>{weekDates.map(date => {
        const count = eventsByDate.get(date)?.length ?? 0;
        const today = date === currentDate;
        const selected = date === selectedDate;
        const dayEvents = eventsByDate.get(date) ?? [];
        return <Pressable key={date} onPress={() => setSelectedDate(date)} style={[styles.calendarWeekDay, posterCalendar && styles.calendarWeekDayPosterMode, today && styles.calendarWeekDayToday, selected && styles.calendarWeekDaySelected]}><Text style={styles.calendarWeekDayName}>{new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</Text><Text style={[styles.calendarWeekDayNumber, today && styles.calendarWeekDayNumberToday]}>{Number(date.slice(8, 10))}</Text><Text style={[styles.calendarWeekDayCount, count > 0 && styles.calendarWeekDayCountActive]}>{count || "-"}</Text>{posterCalendar && count ? <View style={styles.calendarWeekPosterStrip}>{dayEvents.slice(0, 1).map(event => {
          const thumb = tmdbImage(event.artwork, "w342");
          return thumb ? <RemoteImage key={event.id} uri={thumb} style={styles.calendarWeekPosterThumb} resizeMode="cover" /> : null;
        })}{count > 1 ? <Text style={styles.calendarWeekPosterMore}>+{count - 1}</Text> : null}</View> : null}</Pressable>;
      })}</View>}
      {displayedDays.length ? (
        <View style={styles.agenda}>
          {displayedDays.map(([date, dayEvents]) => (
            <View key={date} style={styles.agendaDay}>
              <View style={styles.agendaHeader}><Text style={styles.agendaDate}>{formatCalendarDate(date)}</Text><Text style={styles.agendaCount}>{dayEvents.length}</Text></View>
              {dayEvents.length ? dayEvents.map(event => <AgendaRow key={event.id} event={event} onOpen={onOpen} onMenu={onMenu} />) : <Text style={styles.calendarWeekEmpty}>{mode === "watched" ? "Nothing logged" : "No releases"}</Text>}
            </View>
          ))}
        </View>
      ) : (
        <EmptyPanel title={mode === "watched" ? "Nothing logged from this date" : "No releases from this date"} body={mode === "watched" ? "Choose an earlier date to see watched movies and episodes." : "Choose an earlier date or track more shows to see upcoming releases."} />
      )}
    </View>
  );
}

export function AgendaRow({ event, onOpen, onMenu }: { event: CalendarEvent; onOpen: (event: CalendarEvent) => void; onMenu: (item: MediaSummary) => void }) {
  const image = tmdbImage(event.artwork, "w342");
  return (
    <Pressable onPress={() => onOpen(event)} onLongPress={() => event.item && onMenu(event.item)} delayLongPress={280} style={({ pressed }) => [styles.agendaRow, pressed && styles.agendaRowPressed]}>
      <View style={styles.agendaImage}>{image ? <RemoteImage uri={image} style={styles.posterImage} resizeMode="cover" /> : <Ionicons name="calendar-outline" size={20} color={colors.muted} />}</View>
      <View style={styles.agendaCopy}><Text style={styles.agendaTitle} numberOfLines={1}>{event.title}</Text><Text style={styles.agendaSub} numberOfLines={1}>{event.subtitle}</Text></View>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}
