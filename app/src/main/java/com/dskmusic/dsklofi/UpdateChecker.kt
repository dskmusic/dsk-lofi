package com.dskmusic.dsklofi

import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Environment
import android.webkit.JavascriptInterface
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * DSK•LoFi — UpdateChecker
 *
 * Comprueba `version.json` publicado en GitHub Releases y, si hay una
 * versión más nueva (por versionCode), descarga el APK y lanza el
 * instalador del sistema.
 *
 *   - checkUpdate(reqId)  → JS recibe __updateResult(reqId, jsonString)
 *        jsonString: {"update": true/false, "versionName": "...", "url": "..."}
 *   - downloadAndInstall(url)
 *
 * Requiere en AndroidManifest:
 *   <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />
 *   <provider> FileProvider (authorities = "${applicationId}.fileprovider")
 */
class UpdateChecker(private val ctx: Context) {

    companion object {
        // Cambia esto si mueves el repo o el nombre del archivo.
        private const val VERSION_JSON_URL =
            "https://raw.githubusercontent.com/dskmusic/dsk-lofi/main/version.json"
    }

    private val pool = Executors.newSingleThreadExecutor()
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    @JavascriptInterface
    fun checkUpdate(reqId: String) {
        pool.execute {
            try {
                val req = Request.Builder()
                    .url(VERSION_JSON_URL + "?t=" + System.currentTimeMillis()) // evitar caché
                    .build()
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) { error(reqId, "network"); return@execute }
                    val body = resp.body?.string() ?: run { error(reqId, "network"); return@execute }
                    val json = JSONObject(body)
                    val remoteCode = json.optInt("versionCode", -1)
                    val name = json.optString("versionName", "")
                    val url = json.optString("apkUrl", "")
                    val current = BuildConfig.VERSION_CODE
                    val out = JSONObject().apply {
                        put("update", remoteCode > current)
                        put("versionName", name)
                        put("url", url)
                        put("current", current)
                        put("remote", remoteCode)
                    }
                    result(reqId, out)
                }
            } catch (e: Throwable) {
                error(reqId, "network")
            }
        }
    }

    @JavascriptInterface
    fun downloadAndInstall(url: String) {
        try {
            val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            val fileName = "DSKLoFi-update.apk"
            val dest = File(ctx.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName)
            if (dest.exists()) dest.delete()

            val request = DownloadManager.Request(Uri.parse(url))
                .setTitle("DSK•LoFi — actualización")
                .setDestinationUri(Uri.fromFile(dest))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)

            val downloadId = dm.enqueue(request)

            val receiver = object : BroadcastReceiver() {
                override fun onReceive(c: Context?, intent: Intent?) {
                    val id = intent?.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) ?: -1
                    if (id == downloadId) {
                        try { ctx.unregisterReceiver(this) } catch (e: Exception) {}
                        installApk(dest)
                    }
                }
            }
            ctx.registerReceiver(
                receiver,
                IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE),
                Context.RECEIVER_EXPORTED
            )
        } catch (e: Throwable) {
            MainActivity.runJs("window.DSKUpdate&&window.DSKUpdate.__installError&&window.DSKUpdate.__installError(${JSONObject.quote(e.message ?: "error")})")
        }
    }

    private fun installApk(file: File) {
        try {
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            ctx.startActivity(intent)
        } catch (e: Throwable) {
            MainActivity.runJs("window.DSKUpdate&&window.DSKUpdate.__installError&&window.DSKUpdate.__installError(${JSONObject.quote(e.message ?: "error")})")
        }
    }

    private fun result(reqId: String, obj: JSONObject) {
        val payload = JSONObject.quote(obj.toString())
        MainActivity.runJs("window.DSKUpdate&&window.DSKUpdate.__result&&window.DSKUpdate.__result(${JSONObject.quote(reqId)},$payload)")
    }
    private fun error(reqId: String, code: String) {
        MainActivity.runJs("window.DSKUpdate&&window.DSKUpdate.__error&&window.DSKUpdate.__error(${JSONObject.quote(reqId)},${JSONObject.quote(code)})")
    }
}
