package expo.modules.chakusacalldetection

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Observes device-wide call state (the Telephony framework exposes no
 * per-call ID to this API, only a state machine: IDLE / RINGING / OFFHOOK)
 * to determine whether the call just screened by ChakusaCallScreeningService
 * rang and ended without ever being answered.
 *
 * This is the version-agnostic missed-call signal. CallScreeningService's
 * own onCallDisconnected callback only exists from Android 14 (API 34)
 * onward; RINGING -> IDLE without ever passing through OFFHOOK has been a
 * reliable signal since Android's earliest telephony APIs, and needs only
 * READ_PHONE_STATE — a normal permission, not gated by Google Play's
 * SMS-or-Call-Log default-handler policy the way READ_CALL_LOG is.
 *
 * Relies on the platform contract that CallScreeningService.onScreenCall is
 * invoked "prior to ringing" (see Android's CallScreeningService docs) — so
 * arming this watcher at the start of onScreenCall reliably observes the
 * RINGING transition for the call that was just screened, before deciding
 * anything from a later IDLE.
 *
 * One instance covers exactly one screened call: `start` arms it, and it
 * self-terminates (unregistering its listener) the first time it confirms a
 * miss, confirms an answer, or hits `timeoutMillis` — whichever comes first.
 * It is never left registered longer than that.
 *
 * Scope note: this reads the primary/default telephony service's call
 * state, not a specific SIM on a dual-SIM device — an accepted V1
 * limitation, not an oversight.
 */
class CallStateWatcher(private val context: Context) {
  private var didSeeRinging = false
  private var didSeeOffHook = false
  private val finished = AtomicBoolean(false)
  private val mainHandler = Handler(Looper.getMainLooper())
  private var timeoutRunnable: Runnable? = null
  private var telephonyCallback: TelephonyCallback? = null
  private var legacyListener: PhoneStateListener? = null

  fun start(timeoutMillis: Long, onResult: (missed: Boolean) -> Unit) {
    val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
    if (telephonyManager == null) {
      finish(onResult, missed = false)
      return
    }

    val finishOnce: (Boolean) -> Unit = { missed -> finish(onResult, missed) }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      val callback = object : TelephonyCallback(), TelephonyCallback.CallStateListener {
        override fun onCallStateChanged(state: Int) {
          handleState(state, finishOnce)
        }
      }
      telephonyCallback = callback
      telephonyManager.registerTelephonyCallback(mainExecutor(), callback)
    } else {
      @Suppress("DEPRECATION")
      val listener = object : PhoneStateListener() {
        @Suppress("DEPRECATION")
        override fun onCallStateChanged(state: Int, phoneNumber: String?) {
          handleState(state, finishOnce)
        }
      }
      legacyListener = listener
      @Suppress("DEPRECATION")
      telephonyManager.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
    }

    val runnable = Runnable { finishOnce(false) }
    timeoutRunnable = runnable
    mainHandler.postDelayed(runnable, timeoutMillis)
  }

  private fun handleState(state: Int, finishOnce: (Boolean) -> Unit) {
    when (state) {
      TelephonyManager.CALL_STATE_RINGING -> didSeeRinging = true
      TelephonyManager.CALL_STATE_OFFHOOK -> didSeeOffHook = true
      TelephonyManager.CALL_STATE_IDLE -> {
        // Only a genuine ring-then-idle-without-answer is a "missed call".
        // An IDLE observed before this watcher ever saw RINGING (e.g. a
        // stray callback right after registering, for a call that isn't
        // the one being screened) is not a call outcome and is ignored —
        // the watcher keeps running until its own timeout instead.
        if (didSeeRinging) finishOnce(!didSeeOffHook)
      }
    }
  }

  private fun finish(onResult: (Boolean) -> Unit, missed: Boolean) {
    if (!finished.compareAndSet(false, true)) return
    timeoutRunnable?.let { mainHandler.removeCallbacks(it) }
    unregister()
    onResult(missed)
  }

  private fun unregister() {
    val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      telephonyCallback?.let { telephonyManager.unregisterTelephonyCallback(it) }
    } else {
      @Suppress("DEPRECATION")
      legacyListener?.let { telephonyManager.listen(it, PhoneStateListener.LISTEN_NONE) }
    }
  }

  private fun mainExecutor(): Executor = Executor { command -> mainHandler.post(command) }
}
