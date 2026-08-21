package expo.modules.chakusacalldetection

import android.app.Activity
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import expo.modules.kotlin.activityresult.AppContextActivityResultContract

/**
 * Launches the OS's own role-picker UI for RoleManager.ROLE_CALL_SCREENING
 * and reports back only whether the user completed it with a positive
 * result — the actual grant is re-checked afterward via
 * RoleManager.isRoleHeld (see ChakusaCallDetectionModule.currentRoleStatus),
 * since a RESULT_OK here does not by itself guarantee the role was granted
 * to this app specifically.
 */
// I is String (not Unit/Kotlin's Unit is not a java.io.Serializable in this
// toolchain) — the value is unused, createIntent always requests the same
// fixed role regardless of input.
class RoleRequestContract : AppContextActivityResultContract<String, Boolean> {
  override fun createIntent(context: Context, input: String): Intent {
    val roleManager = context.getSystemService(Context.ROLE_SERVICE) as RoleManager
    return roleManager.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING)
  }

  override fun parseResult(input: String, resultCode: Int, intent: Intent?): Boolean {
    return resultCode == Activity.RESULT_OK
  }
}
