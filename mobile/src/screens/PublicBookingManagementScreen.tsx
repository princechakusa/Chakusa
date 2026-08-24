import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError } from "../services/api";
import {
  PublicAvailabilitySlot,
  PublicBookingDetails,
  publicBusinessProfileApi,
} from "../services/publicBusinessProfile";
import { colors, radius, shadows, spacing, typography } from "../theme";

export function PublicBookingManagementScreen({
  slug,
  token,
}: {
  slug: string | null;
  token: string | null;
}) {
  const [booking, setBooking] = useState<PublicBookingDetails | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<PublicAvailabilitySlot[]>([]);
  const load = useCallback(async () => {
    if (!slug || !token) {
      setError("This booking link is invalid.");
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      setBooking(await publicBusinessProfileApi.getBooking(slug, token));
      setError(null);
    } catch {
      setError("This booking link is invalid or expired.");
    } finally {
      setBusy(false);
    }
  }, [slug, token]);
  useEffect(() => {
    void load();
  }, [load]);
  const cancel = async () => {
    if (!slug || !token || busy) return;
    setBusy(true);
    try {
      setBooking(await publicBusinessProfileApi.cancelBooking(slug, token));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not cancel this booking.",
      );
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!slug || !token || busy) return;
    setBusy(true);
    try {
      setBooking(await publicBusinessProfileApi.confirmBooking(slug, token));
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not confirm this booking.",
      );
    } finally {
      setBusy(false);
    }
  };
  const findTimes = async () => {
    if (!slug || !booking?.serviceOffering || !date) return;
    const from = new Date(`${date}T00:00:00`);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    if (Number.isNaN(from.getTime())) {
      setError("Enter the date as YYYY-MM-DD.");
      return;
    }
    setBusy(true);
    try {
      setSlots(
        await publicBusinessProfileApi.availability(
          slug,
          booking.serviceOffering.id,
          from.toISOString(),
          to.toISOString(),
        ),
      );
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load available times.",
      );
    } finally {
      setBusy(false);
    }
  };
  const reschedule = async (startsAt: string, assignedMemberId: string) => {
    if (!slug || !token || busy) return;
    setBusy(true);
    try {
      setBooking(
        await publicBusinessProfileApi.rescheduleBooking(slug, token, {
          startsAt,
          assignedMemberId,
        }),
      );
      setRescheduling(false);
      setSlots([]);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not reschedule this booking.",
      );
    } finally {
      setBusy(false);
    }
  };
  const pay = async (kind: "deposit" | "balance") => {
    if (!slug || !token || busy) return;
    setBusy(true);
    try {
      const link = await publicBusinessProfileApi.createPaymentLink(
        slug,
        token,
        kind,
      );
      await Linking.openURL(link.url);
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not open secure payment.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView
        contentContainerStyle={styles.shell}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.brand}>CHAKUSA</Text>
        <View style={styles.card}>
          {busy && !booking ? (
            <ActivityIndicator color={colors.primary} />
          ) : error && !booking ? (
            <State icon="link-outline" title={error} />
          ) : booking ? (
            <>
              <State
                icon={
                  booking.status === "CANCELED"
                    ? "close-circle-outline"
                    : "calendar-outline"
                }
                title={booking.business.name}
              />
              <Text style={styles.service}>{booking.serviceName}</Text>
              <Text style={styles.when}>
                {new Date(booking.startsAt).toLocaleString()}
              </Text>
              {booking.assignedMember ? (
                <Text style={styles.meta}>
                  With {booking.assignedMember.user.fullName}
                </Text>
              ) : null}
              <Text style={styles.status}>
                {booking.status === "CANCELED"
                  ? "Canceled"
                  : booking.status[0] + booking.status.slice(1).toLowerCase()}
              </Text>
              {["SCHEDULED", "CONFIRMED"].includes(booking.status) ? (
                <>
                  <View style={styles.actions}>
                    {booking.paymentStatus !== "paid" && booking.depositAmount && Number(booking.paidAmount) < Number(booking.depositAmount) ? (
                      <Button label={`Pay deposit · ${booking.depositAmount}`} disabled={busy} onPress={() => void pay("deposit")} />
                    ) : null}
                    {booking.paymentStatus !== "paid" && booking.price ? (
                      <Button label={`Pay balance · ${(Number(booking.price) - Number(booking.paidAmount)).toFixed(2)}`} disabled={busy} onPress={() => void pay("balance")} />
                    ) : null}
                    {booking.status === "SCHEDULED" ? (
                      <Button
                        label="Confirm attendance"
                        disabled={busy}
                        onPress={() => void confirm()}
                      />
                    ) : null}
                    <Button
                      label="Add to calendar"
                      disabled={busy}
                      onPress={() =>
                        slug &&
                        token &&
                        void Linking.openURL(
                          publicBusinessProfileApi.calendarUrl(slug, token),
                        )
                      }
                    />
                    <Button
                      label={
                        rescheduling
                          ? "Keep current time"
                          : "Choose another time"
                      }
                      disabled={busy || !booking.serviceOffering}
                      onPress={() => setRescheduling((value) => !value)}
                    />
                  </View>
                  {rescheduling ? (
                    <View style={styles.reschedule}>
                      <Text style={styles.meta}>Choose a new date</Text>
                      <TextInput
                        accessibilityLabel="New appointment date"
                        value={date}
                        onChangeText={setDate}
                        placeholder="YYYY-MM-DD"
                        style={styles.input}
                      />
                      <Button
                        label="Find available times"
                        disabled={busy || !date}
                        onPress={() => void findTimes()}
                      />
                      <View style={styles.slots}>
                        {slots.flatMap((slot) =>
                          slot.members.map((member) => (
                            <Pressable
                              accessibilityRole="button"
                              key={`${slot.startsAt}-${member.id}`}
                              onPress={() =>
                                void reschedule(slot.startsAt, member.id)
                              }
                              style={styles.slot}
                            >
                              <Text style={styles.slotText}>
                                {new Date(slot.startsAt).toLocaleTimeString(
                                  undefined,
                                  { hour: "numeric", minute: "2-digit" },
                                )}{" "}
                                · {member.name}
                              </Text>
                            </Pressable>
                          )),
                        )}
                      </View>
                    </View>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void cancel()}
                    style={styles.cancel}
                  >
                    <Text style={styles.cancelText}>
                      {busy ? "Working…" : "Cancel appointment"}
                    </Text>
                  </Pressable>
                </>
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              ) : null}
            </>
          ) : null}
        </View>
        <Text style={styles.footer}>Powered by Chakusa</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
function State({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.state}>
      <Ionicons name={icon} size={44} color={colors.primary} />
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}
function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  shell: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  brand: {
    ...typography.micro,
    color: colors.primary,
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: spacing.md,
  },
  card: {
    gap: spacing.md,
    padding: spacing.xxl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  state: { alignItems: "center", gap: spacing.sm },
  title: { ...typography.title, color: colors.text, textAlign: "center" },
  service: { ...typography.heading, color: colors.text, textAlign: "center" },
  when: { ...typography.bodyStrong, color: colors.text, textAlign: "center" },
  meta: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
  },
  status: {
    ...typography.caption,
    color: colors.primary,
    textAlign: "center",
    textTransform: "uppercase",
  },
  actions: { gap: spacing.sm },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: spacing.md,
  },
  buttonText: { ...typography.bodyStrong, color: colors.primary },
  disabled: { opacity: 0.45 },
  reschedule: { gap: spacing.sm, paddingVertical: spacing.sm },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
    ...typography.body,
  },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  slot: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.round,
    backgroundColor: colors.primarySoft,
  },
  slotText: { ...typography.caption, color: colors.primary },
  cancel: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.negativeSoft,
  },
  cancelText: { ...typography.bodyStrong, color: colors.negative },
  error: { ...typography.caption, color: colors.negative, textAlign: "center" },
  footer: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: "center",
    marginTop: spacing.lg,
  },
});
