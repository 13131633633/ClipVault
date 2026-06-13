package io.clipvault.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class ClipVaultBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val appContext = context.applicationContext
        ClipVaultRuntime.initialize(appContext)
        if (ClipVaultRuntime.shouldLaunchAtStartup()) {
            ClipVaultRuntime.startForegroundService(appContext)
            AdvancedAdbManager.ensurePersistentConnection(
                appContext,
                intent?.action ?: "boot-receiver",
            )
            ClipVaultWatchdogWorker.schedule(appContext)
        }
    }
}
