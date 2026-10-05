package com.shinobijourney.app

import android.app.Application
import com.google.android.gms.games.PlayGamesSdk

/** Initializes optional platform services before Flutter or the WebView starts. */
class ShinobiApplication : Application() {
    var playGamesReady: Boolean = false
        private set

    override fun onCreate() {
        super.onCreate()
        val projectId = runCatching { getString(R.string.game_services_project_id).trim() }
            .getOrDefault("")
        if (projectId.isEmpty() || projectId == "0000000000" || !projectId.all(Char::isDigit)) return
        playGamesReady = runCatching {
            PlayGamesSdk.initialize(this)
            true
        }.getOrDefault(false)
    }
}
