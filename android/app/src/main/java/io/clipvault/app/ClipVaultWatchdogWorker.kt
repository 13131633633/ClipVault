package io.clipvault.app

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

class ClipVaultWatchdogWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val appContext = applicationContext
        ClipVaultRuntime.initialize(appContext)
        if (ClipVaultRuntime.shouldLaunchAtStartup()) {
            ClipVaultRuntime.startForegroundService(appContext)
            AdvancedAdbManager.ensurePersistentConnection(appContext, "workmanager")
        }
        return Result.success()
    }

    companion object {
        private const val UNIQUE_NAME = "clipvault-watchdog"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<ClipVaultWatchdogWorker>(15, TimeUnit.MINUTES)
                .setInitialDelay(2, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context.applicationContext).enqueueUniquePeriodicWork(
                UNIQUE_NAME,
                ExistingPeriodicWorkPolicy.UPDATE,
                request,
            )
        }
    }
}
