package io.clipvault.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ClipVaultWatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val appContext = context.applicationContext
        ClipVaultRuntime.initialize(appContext)
        if (!ClipVaultRuntime.shouldLaunchAtStartup()) {
            return
        }
        ClipVaultRuntime.startForegroundService(appContext)
        AdvancedAdbManager.ensurePersistentConnection(
            appContext,
            intent?.action ?: "watchdog-receiver",
        )
        ClipVaultWatchdogWorker.schedule(appContext)
    }
}
