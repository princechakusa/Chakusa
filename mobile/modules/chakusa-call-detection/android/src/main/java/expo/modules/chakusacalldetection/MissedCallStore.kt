package expo.modules.chakusacalldetection

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Minimal, dependency-free on-device queue for missed-call events. Backed by
 * SharedPreferences rather than a database — expected volume is a handful of
 * events between JS-layer sync opportunities (app foreground/launch), never
 * a high-frequency stream, so a single JSON array under one key is simpler
 * and just as reliable as introducing SQLite for this.
 *
 * Every write is append-then-persist-whole-array. CallScreeningService and
 * the JS-facing module both run in this app's own process, so
 * SharedPreferences' own commit atomicity plus the @Synchronized methods
 * below are sufficient — no separate lock file or cross-process guard is
 * needed.
 */
object MissedCallStore {
  private const val PREFS_NAME = "chakusa_call_detection"
  private const val KEY_EVENTS = "pending_missed_call_events"

  data class Event(val clientEventId: String, val phone: String, val occurredAt: String)

  @Synchronized
  fun append(context: Context, event: Event) {
    val current = readAll(context)
    // Idempotent at the store layer too — a retried/duplicate detection for
    // the same call must never be queued twice.
    if (current.any { it.clientEventId == event.clientEventId }) return
    persist(context, current + event)
  }

  @Synchronized
  fun readAll(context: Context): List<Event> {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val raw = prefs.getString(KEY_EVENTS, null) ?: return emptyList()
    return deserialize(raw)
  }

  @Synchronized
  fun remove(context: Context, clientEventIds: List<String>) {
    val remaining = readAll(context).filterNot { clientEventIds.contains(it.clientEventId) }
    persist(context, remaining)
  }

  private fun persist(context: Context, events: List<Event>) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putString(KEY_EVENTS, serialize(events)).apply()
  }

  private fun serialize(events: List<Event>): String {
    val array = JSONArray()
    events.forEach { event ->
      val obj = JSONObject()
      obj.put("clientEventId", event.clientEventId)
      obj.put("phone", event.phone)
      obj.put("occurredAt", event.occurredAt)
      array.put(obj)
    }
    return array.toString()
  }

  private fun deserialize(raw: String): List<Event> {
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).map { index ->
        val obj = array.getJSONObject(index)
        Event(
          clientEventId = obj.getString("clientEventId"),
          phone = obj.getString("phone"),
          occurredAt = obj.getString("occurredAt"),
        )
      }
    } catch (error: Exception) {
      // A corrupted/unparseable store must never crash call handling —
      // treat it as empty and let future events accumulate cleanly.
      emptyList()
    }
  }
}
