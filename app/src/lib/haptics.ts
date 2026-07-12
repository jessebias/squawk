// Shared haptics vocabulary (PTTButton keeps its own accumulator ticks).
// Every call is fire-and-forget: haptics must never break a flow.
import * as Haptics from "expo-haptics";

export const haptic = {
  /** Positive completion: join landed, collect done, round won. */
  success: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  /** Something failed or the round was lost. */
  error: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
  /** Neutral outcome: round voided/refunded. */
  warning: () =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
  /** Light confirmation tap for host actions and toggles. */
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
};
