package com.shinobijourney.app

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.gms.games.PlayGames
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/** Native edge for Play Games Services. The web game remains the gameplay authority. */
class MainActivity : FlutterActivity() {
    private val channelName = "com.shinobijourney.app/play_games"
    private val rewardChannelName = "com.shinobijourney.app/play_rewards"
    private var playRewardsBilling: PlayRewardsBillingClient? = null
    private val playGamesReady: Boolean
        get() = (application as? ShinobiApplication)?.playGamesReady == true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // super.onCreate has just set the FlutterView as the content view.
        (findViewById<View>(FLUTTER_VIEW_ID) as? ViewGroup)?.setOnHierarchyChangeListener(ShellInsetsGuard)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler(::handlePlayGamesCall)
        val rewardChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, rewardChannelName)
        playRewardsBilling = PlayRewardsBillingClient(this, configuredRewardSkus()) { receipts ->
            rewardChannel.invokeMethod("onRewardPurchases", receipts)
        }
    }

    override fun onResume() {
        super.onResume()
        // Reward offers can be claimed outside the game. Re-query on every
        // foreground transition, even when Play Games Services IDs are not
        // configured; the Billing flow has its own availability boundary.
        playRewardsBilling?.refreshOnForeground()
    }

    override fun onDestroy() {
        playRewardsBilling?.close()
        playRewardsBilling = null
        super.onDestroy()
    }

    private fun configuredRewardSkus(): Set<String> = listOf("play_reward_sku_dawn", "play_reward_sku_ember", "play_reward_sku_ryo_cache_small")
        .mapNotNull { name ->
            val id = resources.getIdentifier(name, "string", packageName)
            if (id == 0) null else getString(id).trim()
        }
        .filter { it.isNotBlank() && it != "UNCONFIGURED" }
        .toSet()

    private fun handlePlayGamesCall(call: MethodCall, result: MethodChannel.Result) {
        if (!playGamesReady) {
            result.success(mapOf("available" to false))
            return
        }
        when (call.method) {
            "status" -> PlayGames.getGamesSignInClient(this).isAuthenticated()
                .addOnCompleteListener { task ->
                    result.success(mapOf(
                        "available" to true,
                        "authenticated" to (task.isSuccessful && task.result.isAuthenticated),
                    ))
                }

            "unlockAchievement" -> {
                val key = call.argument<String>("key")
                val achievementId = configuredPlayId("pgs_achievement_", key)
                if (achievementId == null) {
                    result.success(mapOf("available" to true, "configured" to false))
                    return
                }
                PlayGames.getAchievementsClient(this).unlockImmediate(achievementId)
                    .addOnCompleteListener { task ->
                        result.success(mapOf("available" to true, "configured" to true, "accepted" to task.isSuccessful))
                    }
            }

            "recordEvent" -> {
                val key = call.argument<String>("key")
                // PGS defines progressUpdate as a built-in event name. It does
                // not receive a generated Console event ID like player events.
                val eventName = if (key == "progress_update") {
                    "progressUpdate"
                } else {
                    configuredPlayId("pgs_event_", key)
                }
                if (eventName == null) {
                    result.success(mapOf("available" to true, "configured" to false))
                    return
                }
                val event = com.google.android.gms.games.playergameevent.PlayerGameEvent.Builder(eventName)
                val properties = call.argument<Map<String, Any?>>("properties").orEmpty()
                properties.forEach { (name, value) ->
                    when (value) {
                        is String -> event.addProperty(name, value.take(128))
                        is Boolean -> event.addProperty(name, value)
                        is Int -> event.addProperty(name, value.toLong())
                        is Long -> event.addProperty(name, value)
                        is Double -> if (value.isFinite()) event.addProperty(name, value)
                        is Number -> event.addProperty(name, value.toLong())
                    }
                }
                val stats = PlayGames.getGameStatsClient(this)
                // The buffered API is fire-and-forget, so it cannot truthfully
                // report acceptance back through Flutter. Wait for the local
                // write Task before confirming the event to the web client.
                stats.recordEventImmediate(event.build())
                    .addOnCompleteListener { task ->
                        if (task.isSuccessful) stats.requestEventsUpload()
                        result.success(mapOf(
                            "available" to true,
                            "configured" to true,
                            "accepted" to task.isSuccessful,
                        ))
                    }
            }

            "showAchievements" -> PlayGames.getAchievementsClient(this).achievementsIntent
                .addOnSuccessListener { intent ->
                    runCatching { startActivity(intent) }
                        .onSuccess { result.success(true) }
                        .onFailure { result.success(false) }
                }
                .addOnFailureListener { result.success(false) }

            else -> result.notImplemented()
        }
    }

    private fun configuredPlayId(prefix: String, key: String?): String? {
        if (key.isNullOrBlank() || key.length > 64 || !key.all { it.isLetterOrDigit() || it == '-' || it == '_' }) return null
        val resourceName = prefix + key.replace('-', '_').lowercase()
        val resourceId = resources.getIdentifier(resourceName, "string", packageName)
        if (resourceId == 0) return null
        val id = getString(resourceId).trim()
        return id.takeIf { it.isNotEmpty() && it != "UNCONFIGURED" }
    }
}

/**
 * Keeps the system bars from being padded for twice.
 *
 * The Dart layout (lib/src/shell_page.dart) already keeps the WebView clear of
 * the status bar, the navigation bar and any display cutout. Android System
 * WebView 144 and later also hands those insets to the page as
 * env(safe-area-inset-*), and the game then pads for them again: a bar-high
 * empty band under the bottom menu and above the top HUD.
 *
 * Android's documented fix is to zero the insets the app has already handled
 * before they reach the WebView. That cannot happen on the FlutterView itself:
 * Flutter reads the real insets there, and Flutter's keyboard-animation
 * listener owns that view's insets listener. So it happens on each platform
 * view wrapper Flutter adds under the FlutterView, before the WebView inside
 * has seen a single inset. Keyboard (ime) insets pass through unchanged.
 */
private object ShellInsetsGuard : ViewGroup.OnHierarchyChangeListener {
    private val handledByShell = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()

    override fun onChildViewAdded(parent: View, child: View) {
        ViewCompat.setOnApplyWindowInsetsListener(child) { view, insets ->
            val zeroed = WindowInsetsCompat.Builder(insets)
                .setInsets(handledByShell, Insets.NONE)
                .setDisplayCutout(null)
                .build()
            ViewCompat.onApplyWindowInsets(view, zeroed)
        }
    }

    override fun onChildViewRemoved(parent: View, child: View) {}
}
