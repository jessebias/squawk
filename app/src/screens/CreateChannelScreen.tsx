// Create Channel — the "+" tab. Title + duration + rounds → create_channel
// and N create_round on the base layer, signed by the local host burner
// (lib/hostKey.ts); the active wallet only signs one SOL funding transfer.
// The new channel appears on Discover via the existing 4s poll.
import React, { useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BN } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { colors, gradient, hairline, radius } from "../theme";
import { baseConn } from "../lib/connections";
import { getHostKeypair } from "../lib/hostKey";
import {
  createChannelOnBase,
  describeError,
  ensureHostFunded,
  estimateHostLamports,
  newChannelId,
} from "../lib/host";
import { useWallet } from "../hooks/useWallet";
import type { RootStackParamList } from "../navigators/AppNavigator";

const MAX_TITLE_BYTES = 64;
const DURATIONS = [
  { label: "1h", secs: 3600 },
  { label: "3h", secs: 3 * 3600 },
  { label: "24h", secs: 24 * 3600 },
  { label: "3d", secs: 3 * 24 * 3600 },
];
const ROUND_OPTIONS = [5, 10, 15, 20];

function Pills<T>({
  options,
  labels,
  value,
  onSelect,
  disabled,
}: {
  options: T[];
  labels: string[];
  value: T;
  onSelect: (v: T) => void;
  disabled: boolean;
}) {
  return (
    <View style={styles.pillRow}>
      {options.map((opt, i) => {
        const on = opt === value;
        return (
          <Pressable
            key={labels[i]}
            onPress={() => onSelect(opt)}
            disabled={disabled}
            style={styles.pillWrap}
          >
            {on ? (
              <LinearGradient
                colors={[...gradient]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.pill}
              >
                <Text style={styles.pillTextOn}>{labels[i]}</Text>
              </LinearGradient>
            ) : (
              <View style={[styles.pill, styles.pillOff]}>
                <Text style={styles.pillText}>{labels[i]}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function CreateChannelScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState(DURATIONS[1]);
  const [rounds, setRounds] = useState(10);
  const [visibility, setVisibility] = useState<0 | 1>(0);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // one channel id per submission attempt-series → retry resumes instead of
  // orphaning a half-created channel (create_round is strictly sequential)
  const channelIdRef = useRef<BN | null>(null);

  const titleBytes = useMemo(() => Buffer.byteLength(title, "utf8"), [title]);
  const overTitle = titleBytes > MAX_TITLE_BYTES;

  const estimateSol = estimateHostLamports(rounds) / LAMPORTS_PER_SOL;
  const gas = useQuery({
    queryKey: ["hostGas", wallet.publicKey?.toBase58()],
    queryFn: () => baseConn.getBalance(wallet.publicKey!),
    enabled: !!wallet.publicKey,
    refetchInterval: 8000,
  });
  const walletSol = gas.data !== undefined ? gas.data / LAMPORTS_PER_SOL : null;
  const shortOnSol = walletSol !== null && walletSol < estimateSol + 0.01;

  const busy = progress !== null;
  const canCreate =
    wallet.ready &&
    !!wallet.publicKey &&
    title.trim().length > 0 &&
    !overTitle &&
    !shortOnSol &&
    !busy;

  const create = async () => {
    if (!wallet.publicKey) return;
    setError(null);
    setProgress("preparing host key…");
    try {
      const host = await getHostKeypair();
      setProgress("funding host key…");
      await ensureHostFunded(wallet.signAndSend, wallet.publicKey, host.publicKey, rounds);
      if (!channelIdRef.current) channelIdRef.current = newChannelId();
      const endsAt = Math.floor(Date.now() / 1000) + duration.secs;
      const { channelPk } = await createChannelOnBase(
        host,
        channelIdRef.current,
        title.trim(),
        endsAt,
        rounds,
        setProgress,
        visibility
      );
      channelIdRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      nav.replace("Channel", { channelPk: channelPk.toBase58() });
    } catch (e) {
      setError(describeError(e).slice(0, 140));
      setProgress(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Open a frequency</Text>
        <Pressable onPress={() => nav.goBack()} hitSlop={12} disabled={busy}>
          <Feather name="x" size={20} color={colors.textSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.labelRow}>
          <Text style={styles.label}>TITLE</Text>
          <Text style={[styles.counter, overTitle && { color: colors.noText }]}>
            {titleBytes}/{MAX_TITLE_BYTES}
          </Text>
        </View>
        <TextInput
          style={styles.input}
          placeholder="⚽ e.g. Ranked duo stream"
          placeholderTextColor={colors.textMuted}
          value={title}
          onChangeText={(t) => {
            setTitle(t);
            channelIdRef.current = null; // new title = new attempt-series
          }}
          editable={!busy}
          maxLength={MAX_TITLE_BYTES} // coarse cap; byte counter is the real gate
        />

        <Text style={styles.label}>OPEN FOR</Text>
        <Pills
          options={DURATIONS}
          labels={DURATIONS.map((d) => d.label)}
          value={duration}
          onSelect={(d) => {
            setDuration(d);
            channelIdRef.current = null; // ends_at is set at create — new attempt-series
          }}
          disabled={busy}
        />

        <Text style={styles.label}>ROUNDS</Text>
        <Pills
          options={ROUND_OPTIONS}
          labels={ROUND_OPTIONS.map(String)}
          value={rounds}
          onSelect={(r) => {
            setRounds(r);
            channelIdRef.current = null;
          }}
          disabled={busy}
        />
        <Text style={styles.label}>VISIBILITY</Text>
        <Pills
          options={[0, 1] as (0 | 1)[]}
          labels={["🌐 Public", "🔒 Private"]}
          value={visibility}
          onSelect={(v) => {
            setVisibility(v);
            channelIdRef.current = null;
          }}
          disabled={busy}
        />
        <Text style={styles.hint}>
          {visibility === 1
            ? "Private = blind betting on a TEE rollup: unlisted (share the invite " +
              "code), stakes and pools hidden from players until you make the call. " +
              "No following the crowd."
            : "You'll host this channel: go live, drop questions, call YES or NO. " +
              "Going live locks entries."}
        </Text>

        <View style={styles.costRow}>
          <Text style={styles.costText}>≈ {estimateSol.toFixed(3)} SOL devnet rent</Text>
          <Text style={styles.costText}>
            gas {walletSol === null ? "—" : walletSol.toFixed(3)} SOL
          </Text>
        </View>
        {shortOnSol && (
          <Text style={styles.warn}>
            not enough devnet SOL for rent — fund this wallet from Profile
          </Text>
        )}
        {error && <Text style={styles.warn}>{error}</Text>}

        <Pressable onPress={create} disabled={!canCreate} style={styles.ctaWrap}>
          <LinearGradient
            colors={[...gradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.cta, !canCreate && { opacity: 0.4 }]}
          >
            <Text style={styles.ctaText}>
              {busy ? progress : error ? "Retry" : "Create channel"}
            </Text>
          </LinearGradient>
        </Pressable>
        <Text style={styles.footnote}>
          on-chain on devnet · your frequency goes on air the moment it's created
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  headerTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  content: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: {
    color: colors.textMuted,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "600",
    marginTop: 8,
  },
  counter: { color: colors.textMuted, fontSize: 10, marginTop: 8 },
  input: {
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
  },
  pillRow: { flexDirection: "row", gap: 8 },
  pillWrap: { flex: 1 },
  pill: {
    borderRadius: radius.pill,
    paddingVertical: 10,
    alignItems: "center",
  },
  pillOff: {
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
  },
  pillText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  pillTextOn: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 6,
  },
  costText: { color: colors.textSecondary, fontSize: 11 },
  warn: { color: colors.noText, fontSize: 11 },
  ctaWrap: { marginTop: 10 },
  cta: {
    borderRadius: radius.md,
    paddingVertical: 15,
    alignItems: "center",
  },
  ctaText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  footnote: { color: colors.textMuted, fontSize: 10, textAlign: "center" },
});
