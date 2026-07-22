import { Text, View } from "react-native";

import { styles } from "../../app/styles";

export function ratingCellStyle(score: number | null, colorized: boolean) {
  if (score == null) return { backgroundColor: "#aeb0b2", color: "#151515" };
  if (!colorized) return { backgroundColor: "#f5c20b", color: "#151515" };
  if (score >= 9.5) return { backgroundColor: "#28a8f4", color: "#06131b" };
  if (score >= 8) return { backgroundColor: "#24bf74", color: "#06170e" };
  if (score >= 7) return { backgroundColor: "#f2cf3c", color: "#17130a" };
  if (score >= 6) return { backgroundColor: "#f39b19", color: "#17130a" };
  if (score >= 5) return { backgroundColor: "#e8584f", color: "#ffffff" };
  return { backgroundColor: "#8151a8", color: "#ffffff" };
}

export function RatingLegend() {
  const buckets = [
    ["Absolute", "#28a8f4"],
    ["Great", "#24bf74"],
    ["Good", "#f2cf3c"],
    ["Regular", "#f39b19"],
    ["Bad", "#e8584f"],
    ["Garbage", "#8151a8"]
  ];
  return <View style={styles.ratingLegend}>{buckets.map(([label, color]) => <View key={label} style={styles.ratingLegendItem}><View style={[styles.ratingLegendDot, { backgroundColor: color }]} /><Text style={styles.ratingLegendText}>{label}</Text></View>)}</View>;
}
