package io.clipvault.app

import android.content.ClipboardManager
import android.content.Context
import android.os.Looper
import android.os.Process
import java.security.MessageDigest
import org.json.JSONObject

object ClipVaultShellAgent {
    @JvmStatic
    fun main(args: Array<String>) {
        when (args.firstOrNull()) {
            "watch-clipboard" -> watchClipboard()
        }
    }

    private fun watchClipboard() {
        val context = createShellContext()
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
            ?: return
        var lastHash = ""
        while (true) {
            try {
                val text = readClipboardText(context, clipboard)
                if (!text.isNullOrBlank()) {
                    val hash = sha256(text)
                    if (hash != lastHash) {
                        lastHash = hash
                        println(
                            JSONObject().apply {
                                put("type", "clipboard")
                                put("text", text)
                            }.toString(),
                        )
                        System.out.flush()
                    }
                }
            } catch (_: Exception) {
            }
            Thread.sleep(900L)
        }
    }

    private fun readClipboardText(context: Context, clipboard: ClipboardManager): String? {
        val clip = clipboard.primaryClip ?: return null
        if (clip.itemCount == 0) {
            return null
        }
        val text = clip.getItemAt(0).coerceToText(context)?.toString()?.trim()
        return text?.takeIf { it.isNotBlank() }
    }

    @Suppress("UNCHECKED_CAST")
    private fun createShellContext(): Context {
        ensureMainLooper()
        val activityThreadClass = Class.forName("android.app.ActivityThread")
        val compatibilityInfoClass = Class.forName("android.content.res.CompatibilityInfo")
        val systemMain = activityThreadClass.getDeclaredMethod("systemMain")
        val activityThread = systemMain.invoke(null)

        if (Process.myUid() == Process.SHELL_UID) {
            val getPackageInfo = activityThreadClass.getDeclaredMethod(
                "getPackageInfo",
                String::class.java,
                compatibilityInfoClass,
                Int::class.javaPrimitiveType,
                Int::class.javaPrimitiveType,
            )
            val defaultCompatibility = compatibilityInfoClass.getField("DEFAULT_COMPATIBILITY_INFO").get(null)
            val loadedApk = getPackageInfo.invoke(
                activityThread,
                "com.android.shell",
                defaultCompatibility,
                Context.CONTEXT_INCLUDE_CODE or Context.CONTEXT_IGNORE_SECURITY,
                0,
            )
            val loadedApkClass = Class.forName("android.app.LoadedApk")
            val makeApplication = loadedApkClass.getDeclaredMethod(
                "makeApplication",
                Boolean::class.javaPrimitiveType,
                Class.forName("android.app.Instrumentation"),
            )
            return makeApplication.invoke(loadedApk, false, null) as Context
        }

        val getSystemContext = activityThreadClass.getDeclaredMethod("getSystemContext")
        return getSystemContext.invoke(activityThread) as Context
    }

    private fun ensureMainLooper() {
        if (Looper.myLooper() == null) {
            Looper.prepare()
        }
    }

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .joinToString("") { each -> "%02x".format(each) }
}
