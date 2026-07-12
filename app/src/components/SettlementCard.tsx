// The closing shot (docs/plan.md §6): after settlement, show
// "N ER transactions · 1 settlement · $0.00 fees" with a devnet explorer
// link to the channel's latest base-layer signature (the commitment).
// getSignaturesForAddress is the Hermes-safe substitute for
// GetCommitmentSignature (untested in RN — see docs/decisions.md).
import React, { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { PublicKey } from "@solana/web3.js";
import { colors, hairline, radius } from "../theme";
import { baseConn } from "../lib/connections";

export function SettlementCard({
  channelPk,
  erTxs,
}: {
  channelPk: PublicKey;
  erTxs: number;
}) {
  const [sig, setSig] = useState<string | null>(null);
  useEffect(() => {
    baseConn
      .getSignaturesForAddress(channelPk, { limit: 1 })
      .then((sigs) => setSig(sigs[0]?.signature ?? null))
      .catch(() => {});
  }, [channelPk.toBase58()]);

  return (
    <View style={styles.card}>
      <Feather name="check-circle" size={22} color={colors.yesText} />
      <Text style={styles.headline}>
        {erTxs > 0 ? `${erTxs} ER transactions` : "channel settled"} · 1 settlement ·
        $0.00 fees
      </Text>
      <Text style={styles.sub}>
        every hold was a real Solana transaction — settled in one commitment
      </Text>
      {sig && (
        <Pressable
          style={styles.link}
          onPress={() =>
            Linking.openURL(
              `https://explorer.solana.com/tx/${sig}?cluster=devnet`
            ).catch(() => {})
          }
        >
          <Feather name="external-link" size={12} color={colors.accent} />
          <Text style={styles.linkText}>view the settlement on Solana</Text>
        </Pressable>
      )}
      <Text style={styles.collect}>collect your balance from Profile</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    borderWidth: hairline,
    borderColor: colors.border,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  headline: { color: colors.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  sub: { color: colors.textSecondary, fontSize: 11, textAlign: "center" },
  link: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  linkText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
  collect: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
