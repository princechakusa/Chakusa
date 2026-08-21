package expo.modules.chakusacalldetection

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.os.Build
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.launch

enum class CallScreeningRoleStatusValue(val value: String) {
  GRANTED("granted"),
  NOT_GRANTED("not_granted"),
  UNSUPPORTED("unsupported"),
}

/**
 * JS-facing surface for Android missed-call detection. Two things are
 * requested independently and neither implies the other:
 *  - RoleManager.ROLE_CALL_SCREENING (a Settings-style role grant, backing
 *    ChakusaCallScreeningService — gives us the caller's number).
 *  - READ_PHONE_STATE (a normal runtime permission, backing
 *    CallStateWatcher — gives us the missed/answered outcome).
 * Both must be granted for detection to actually work end to end; the JS
 * layer is responsible for explaining that to the user before calling
 * either request function (never call these automatically/silently).
 */
class ChakusaCallDetectionModule : Module() {

  companion object {
    // Same-process only (this service is not given a separate
    // android:process in the manifest), so a live module instance really
    // can receive this call directly when the app is running — but it is
    // never the only delivery path; MissedCallStore is. See
    // ChakusaCallScreeningService's own comment on this.
    @Volatile private var activeModule: ChakusaCallDetectionModule? = null

    fun emitMissedCallIfListening(event: MissedCallStore.Event) {
      activeModule?.sendEvent(
        "onMissedCallDetected",
        mapOf("clientEventId" to event.clientEventId, "phone" to event.phone, "occurredAt" to event.occurredAt),
      )
    }
  }

  private lateinit var roleRequestLauncher: AppContextActivityResultLauncher<String, Boolean>

  override fun definition() = ModuleDefinition {
    Name("ChakusaCallDetection")

    Events("onMissedCallDetected")

    OnCreate {
      activeModule = this@ChakusaCallDetectionModule
    }

    OnDestroy {
      if (activeModule === this@ChakusaCallDetectionModule) activeModule = null
    }

    RegisterActivityContracts {
      roleRequestLauncher = registerForActivityResult(RoleRequestContract())
    }

    AsyncFunction("getCallScreeningRoleStatus") { promise: Promise ->
      promise.resolve(currentRoleStatus().value)
    }

    // Must only ever be invoked from a user-initiated JS action (a button
    // tap with an explanation shown first) — this launches the OS's own
    // role-picker UI, exactly like requesting any other sensitive
    // capability, and must never be called automatically on app start.
    AsyncFunction("requestCallScreeningRole") { promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        promise.resolve(CallScreeningRoleStatusValue.UNSUPPORTED.value)
        return@AsyncFunction
      }
      val roleManager = roleManagerOrNull()
      if (roleManager == null || !roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
        promise.resolve(CallScreeningRoleStatusValue.UNSUPPORTED.value)
        return@AsyncFunction
      }
      if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) {
        promise.resolve(CallScreeningRoleStatusValue.GRANTED.value)
        return@AsyncFunction
      }
      appContext.mainQueue.launch {
        try {
          roleRequestLauncher.launch(RoleManager.ROLE_CALL_SCREENING)
          promise.resolve(currentRoleStatus().value)
        } catch (error: Exception) {
          promise.reject("ERR_CALL_SCREENING_ROLE", error.message ?: "Unable to request the call-screening role", error)
        }
      }
    }

    AsyncFunction("hasPhoneStatePermission") { promise: Promise ->
      promise.resolve(hasPhoneStatePermission())
    }

    AsyncFunction("requestPhoneStatePermission") { promise: Promise ->
      if (hasPhoneStatePermission()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      permissions.askForPermissions(
        { result -> promise.resolve(result[Manifest.permission.READ_PHONE_STATE]?.status == PermissionsStatus.GRANTED) },
        Manifest.permission.READ_PHONE_STATE,
      )
    }

    // READ_CONTACTS is not needed for detection itself — it is what Telecom
    // checks before deciding whether to exempt a contacts-matched call from
    // screening at all (see CallScreeningServiceFilter in AOSP). Without it,
    // ChakusaCallScreeningService is silently never invoked for calls from
    // numbers already saved in the device's contacts.
    AsyncFunction("hasContactsPermission") { promise: Promise ->
      promise.resolve(hasContactsPermission())
    }

    AsyncFunction("requestContactsPermission") { promise: Promise ->
      if (hasContactsPermission()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      permissions.askForPermissions(
        { result -> promise.resolve(result[Manifest.permission.READ_CONTACTS]?.status == PermissionsStatus.GRANTED) },
        Manifest.permission.READ_CONTACTS,
      )
    }

    AsyncFunction("getPendingEvents") { promise: Promise ->
      val context = appContext.reactContext
      val events = if (context == null) emptyList() else MissedCallStore.readAll(context)
      promise.resolve(events.map { mapOf("clientEventId" to it.clientEventId, "phone" to it.phone, "occurredAt" to it.occurredAt) })
    }

    AsyncFunction("clearEvents") { clientEventIds: List<String>, promise: Promise ->
      appContext.reactContext?.let { MissedCallStore.remove(it, clientEventIds) }
      promise.resolve(null)
    }
  }

  private fun roleManagerOrNull(): RoleManager? {
    val context = appContext.reactContext ?: return null
    return context.getSystemService(Context.ROLE_SERVICE) as? RoleManager
  }

  private fun currentRoleStatus(): CallScreeningRoleStatusValue {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return CallScreeningRoleStatusValue.UNSUPPORTED
    val roleManager = roleManagerOrNull() ?: return CallScreeningRoleStatusValue.UNSUPPORTED
    if (!roleManager.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) return CallScreeningRoleStatusValue.UNSUPPORTED
    return if (roleManager.isRoleHeld(RoleManager.ROLE_CALL_SCREENING)) CallScreeningRoleStatusValue.GRANTED else CallScreeningRoleStatusValue.NOT_GRANTED
  }

  private fun hasPhoneStatePermission(): Boolean {
    return appContext.permissions?.hasGrantedPermissions(Manifest.permission.READ_PHONE_STATE) ?: false
  }

  private fun hasContactsPermission(): Boolean {
    return appContext.permissions?.hasGrantedPermissions(Manifest.permission.READ_CONTACTS) ?: false
  }
}
