package com.shinobijourney.app

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import io.flutter.embedding.android.FlutterActivity

class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // super.onCreate has just set the FlutterView as the content view.
        (findViewById<View>(FLUTTER_VIEW_ID) as? ViewGroup)?.setOnHierarchyChangeListener(ShellInsetsGuard)
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
