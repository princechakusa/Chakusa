package expo.modules.chakusacalldetection

import android.telecom.Call
import android.telecom.CallScreeningService
import java.util.UUID

/**
 * Bound by the platform only while this app holds
 * RoleManager.ROLE_CALL_SCREENING (requested via
 * ChakusaCallDetectionModule.requestCallScreeningRole — never granted
 * implicitly, and revocable by the user at any time in Settings). Invoked
 * for every incoming call, before it rings.
 *
 * This service never blocks, silences, or otherwise screens anything — its
 * CallResponse is always the default "allow" response. Its only job is
 * observation: capture who called (from the Call.Details handle, which
 * this API provides directly without needing READ_CALL_LOG), then hand off
 * to CallStateWatcher to determine, from device-wide telephony state,
 * whether that call ends up missed.
 */
class ChakusaCallScreeningService : CallScreeningService() {

  companion object {
    /** How long to wait for the call to resolve (ring through to voicemail,
     * be answered, or be rejected) before giving up on this one call. Real
     * ring timeouts are typically 20-30s; this is deliberately generous. */
    private const val CALL_RESOLUTION_TIMEOUT_MS = 45_000L
  }

  override fun onScreenCall(callDetails: Call.Details) {
    // Always respond within the platform's 5-second budget before doing
    // anything else — an empty CallResponse means "do not block, do not
    // silence, behave exactly as if this service didn't exist" for the
    // call itself. Detection happens independently, after this.
    respondToCall(callDetails, CallResponse.Builder().build())

    val direction = callDetails.callDirection
    if (direction != Call.Details.DIRECTION_INCOMING) return // only inbound calls represent a customer trying to reach the business

    val phone = callDetails.handle?.schemeSpecificPart
    if (phone.isNullOrBlank()) return // no caller identity to attach a lead to — nothing usable to detect

    CallStateWatcher(applicationContext).start(CALL_RESOLUTION_TIMEOUT_MS) { missed ->
      if (!missed) return@start

      val event = MissedCallStore.Event(
        clientEventId = UUID.randomUUID().toString(),
        phone = phone,
        occurredAt = java.time.Instant.now().toString(),
      )
      MissedCallStore.append(applicationContext, event)
      // Best-effort only — the persisted queue above is the guaranteed
      // delivery path, drained by the JS layer on next foreground/launch.
      // This just lets a currently-running app react instantly instead of
      // waiting for that next drain.
      ChakusaCallDetectionModule.emitMissedCallIfListening(event)
    }
  }
}
