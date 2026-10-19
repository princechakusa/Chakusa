package expo.modules.chakusaappintegrity

import android.content.pm.PackageManager
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityTokenRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

/**
 * Reports who signed the installed APK and which store installed it. A
 * repackaged copy of Chakusa must be re-signed with someone else's key, so its
 * certificate fingerprints differ from ours. The JS layer compares them with
 * the known Chakusa keys; Play Integrity on the server is the stronger check.
 */
class ChakusaAppIntegrityModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ChakusaAppIntegrity")

    Function("getSigningInfo") {
      val context = appContext.reactContext ?: return@Function null
      val packageManager = context.packageManager
      val info = packageManager.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
      val signing = info.signingInfo ?: return@Function null
      // With key rotation, the history holds every certificate the app was
      // signed with; otherwise the current signers are authoritative.
      val certificates = if (signing.hasMultipleSigners()) signing.apkContentsSigners else signing.signingCertificateHistory
      val installer = try {
        packageManager.getInstallSourceInfo(context.packageName).installingPackageName
      } catch (_: Exception) {
        null
      }
      mapOf(
        "sha256" to certificates.map { digest("SHA-256", it.toByteArray()) },
        "sha1" to certificates.map { digest("SHA-1", it.toByteArray()) },
        "installer" to installer,
      )
    }

    // Asks Google Play for an integrity token bound to the server's nonce. The
    // token is opaque here; only the server (via Google) can decode and judge it.
    AsyncFunction("requestIntegrityToken") { nonce: String, cloudProjectNumber: Double, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("ERR_NO_CONTEXT", "No Android context", null)
        return@AsyncFunction
      }
      val request = IntegrityTokenRequest.builder()
        .setNonce(nonce)
        .setCloudProjectNumber(cloudProjectNumber.toLong())
        .build()
      IntegrityManagerFactory.create(context).requestIntegrityToken(request)
        .addOnSuccessListener { response -> promise.resolve(response.token()) }
        .addOnFailureListener { error -> promise.reject("ERR_INTEGRITY", error.message ?: "Play Integrity request failed", error) }
    }
  }

  private fun digest(algorithm: String, bytes: ByteArray): String =
    MessageDigest.getInstance(algorithm).digest(bytes).joinToString(":") { "%02X".format(it) }
}
