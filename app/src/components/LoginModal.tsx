// Privy login bottom sheet (daremarket reference, Squawk theme):
// wordmark → "Log in or sign up" → email + Submit (→ OTP code step) →
// Twitter / Discord rows → "Protected by Privy" footer.
// Only mount when privyEnabled (hooks require PrivyProvider).
import React, { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather, FontAwesome6 } from "@expo/vector-icons";
import { useLoginWithEmail, useLoginWithOAuth } from "@privy-io/expo";
import { colors, fonts, hairline, radius } from "../theme";

type Props = { visible: boolean; onClose: () => void };

export function LoginModal({ visible, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const emailFlow = useLoginWithEmail({
    onLoginSuccess: () => onClose(),
    onError: (e) => setError(String(e).slice(0, 120)),
  });
  const oauth = useLoginWithOAuth({
    onSuccess: () => onClose(),
    onError: (e) => setError(String(e).slice(0, 120)),
  });

  const awaitingCode =
    emailFlow.state.status === "awaiting-code-input" ||
    emailFlow.state.status === "submitting-code";
  const busy =
    emailFlow.state.status === "sending-code" ||
    emailFlow.state.status === "submitting-code" ||
    oauth.state.status === "loading";

  const submitEmail = async () => {
    setError(null);
    if (!email.includes("@")) return setError("enter a valid email");
    await emailFlow.sendCode({ email });
  };
  const submitCode = async () => {
    setError(null);
    await emailFlow.loginWithCode({ code, email });
  };

  const socialRow = (
    label: string,
    provider: "twitter" | "telegram",
    icon: React.ReactNode
  ) => (
    <Pressable
      key={provider}
      style={styles.socialRow}
      disabled={busy}
      onPress={() => {
        setError(null);
        oauth.login({ provider });
      }}
    >
      <View style={styles.socialIcon}>{icon}</View>
      <Text style={styles.socialLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Pressable style={styles.close} onPress={onClose} hitSlop={10}>
            <Feather name="x" size={18} color={colors.textSecondary} />
          </Pressable>

          <Text style={styles.wordmark}>SQUAWK</Text>
          <Text style={styles.title}>Log in or sign up</Text>

          {!awaitingCode ? (
            <View style={styles.emailRow}>
              <Feather name="mail" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.emailInput}
                placeholder="your@email.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
                editable={!busy}
              />
              <Pressable onPress={submitEmail} disabled={busy}>
                {busy && emailFlow.state.status === "sending-code" ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.submit}>Submit</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <View style={styles.emailRow}>
              <Feather name="key" size={16} color={colors.textMuted} />
              <TextInput
                style={styles.emailInput}
                placeholder={`code sent to ${email}`}
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                value={code}
                onChangeText={setCode}
                editable={!busy}
                autoFocus
              />
              <Pressable onPress={submitCode} disabled={busy}>
                {emailFlow.state.status === "submitting-code" ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Text style={styles.submit}>Verify</Text>
                )}
              </Pressable>
            </View>
          )}

          {socialRow(
            "X",
            "twitter",
            <FontAwesome6 name="x-twitter" size={16} color="#FFFFFF" />
          )}
          {socialRow(
            "Telegram",
            "telegram",
            <FontAwesome6 name="telegram" size={17} color="#FFFFFF" />
          )}

          {error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.footer}>
            Protected by <Text style={styles.privy}>privy</Text>
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#0B0E17",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 34,
  },
  close: { alignSelf: "flex-end", padding: 6 },
  wordmark: {
    fontFamily: fonts.wordmark,
    fontSize: 30,
    color: colors.accent,
    textAlign: "center",
    marginTop: 6,
    textShadowColor: "#7A2E0E",
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 0,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 14,
    marginBottom: 20,
  },
  emailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: hairline,
    borderColor: "#2A2F3E",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: radius.md,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  emailInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 14 },
  submit: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  socialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: hairline,
    borderColor: "#2A2F3E",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
  },
  socialIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.cardElevated,
    alignItems: "center",
    justifyContent: "center",
  },
  socialLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  error: { color: colors.noText, fontSize: 12, textAlign: "center", marginTop: 4 },
  footer: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginTop: 18 },
  privy: { fontWeight: "800", letterSpacing: 0.5 },
});
