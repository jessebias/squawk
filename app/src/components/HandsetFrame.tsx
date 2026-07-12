// The walkie-talkie handset body: rounded device shell with a bezel edge,
// antenna nub + signal LED, and a speaker-grille hint strip up top. Purely
// presentational — the channel internals render as the device face.
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, hairline, radius } from "../theme";
import { LiveDot } from "./LiveDot";

export function HandsetFrame({
  children,
  live,
  isPrivate,
}: {
  children: React.ReactNode;
  live: boolean;
  isPrivate: boolean;
}) {
  return (
    <View style={styles.shell}>
      <View style={styles.antennaRow}>
        <View style={styles.antenna} />
      </View>
      <View style={styles.body}>
        <View style={styles.topStrip}>
          <View style={styles.vents}>
            {Array.from({ length: 5 }, (_, i) => (
              <View key={i} style={styles.vent} />
            ))}
          </View>
          <View style={styles.signalWrap}>
            {isPrivate && <Text style={styles.privateTag}>🔒</Text>}
            {live ? (
              <LiveDot size={7} />
            ) : (
              <View style={styles.idleDot} />
            )}
          </View>
        </View>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { paddingHorizontal: 2 },
  antennaRow: { alignItems: "flex-start", paddingLeft: 26, marginBottom: -1 },
  antenna: {
    width: 14,
    height: 16,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: colors.bodyEdge,
    borderWidth: hairline,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  body: {
    backgroundColor: colors.body,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.bodyEdge,
    // subtle raised-device edge: brighter top, darker bottom
    borderTopColor: "#3A3A46",
    borderBottomColor: "#1A1A22",
    padding: 14,
    gap: 12,
  },
  topStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  vents: { flexDirection: "row", gap: 4 },
  vent: {
    width: 22,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bodyEdge,
  },
  signalWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  privateTag: { fontSize: 10 },
  idleDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
  },
});
