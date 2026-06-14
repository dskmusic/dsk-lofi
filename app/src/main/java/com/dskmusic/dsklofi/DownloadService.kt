package com.dskmusic.dsklofi

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * DSK•LoFi — DownloadService
 *
 * Servicio en primer plano que descarga y guarda audio de YouTube en /DSKlofi
 * 100% NATIVO (sin el WebView). Prefiere el stream m4a/AAC y lo guarda directo
 * (rapidísimo); si solo hay opus/webm, transcodifica a M4A con MediaCodec.
 *
 * Tiene su PROPIA notificación con progreso y posición en la cola ("1/3"), y al
 * ser nativo y en primer plano, sigue aunque la app pase a segundo plano o se
 * cierre.
 *
 * Si el WebView sigue vivo, informa el progreso a la fila vía window.DSKDownloads.
 */
class DownloadService : Service() {

    companion object {
        const val CH = "dsk_downloads"
        const val NID = 0xD5C0

        private val queue = ConcurrentLinkedQueue<Array<String>>()  // [videoId, title, thumb]
        private val total = AtomicInteger(0)
        private val done = AtomicInteger(0)

        fun enqueue(ctx: Context, videoId: String, title: String, thumb: String) {
            queue.add(arrayOf(videoId, title, thumb)); total.incrementAndGet()
            val i = Intent(ctx, DownloadService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }
    }

    @Volatile private var running = false
    private val ua =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NID, build("…", 0, true))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startWorker()
        return START_NOT_STICKY
    }

    private fun startWorker() {
        if (running) return
        running = true
        Thread {
            try {
                while (true) {
                    val job = queue.poll() ?: break
                    try { processJob(job[0], job[1], if (job.size > 2) job[2] else "") } catch (e: Throwable) { jsErr(job[0], "fallo") }
                    done.incrementAndGet()
                }
            } finally {
                running = false
                if (queue.isNotEmpty()) startWorker()
                else { total.set(0); done.set(0); stopSelfSafe() }
            }
        }.start()
    }

    private fun pos(): Int = (done.get() + 1).coerceAtMost(total.get().coerceAtLeast(1))

    private fun processJob(videoId: String, titleHint: String, thumbUrl: String) {
        val tmp = File(cacheDir, "yt_" + System.nanoTime() + ".dat")
        val tmpM4a = File(cacheDir, "yt_" + System.nanoTime() + ".m4a")
        try {
            notify("Descargando " + pos() + "/" + total.get(), 0, true)

            val info = YoutubeBridge.resolveForDownload(videoId)
                ?: run { jsErr(videoId, "sin streams"); notify("Error de descarga", 0, false); return }
            val url = info.url
            val ext = info.ext
            val uploader = info.uploader
            val title = DskStorage.sanitize(if (titleHint.isNotBlank()) titleHint else info.title).take(120)

            // 1) descargar a temporal con VARIAS conexiones (rápido) → 0..80%
            val ok = ParallelDownloader.download(url, ua, tmp) { f ->
                val pct = (f * 80).toInt()
                notify("Descargando " + pos() + "/" + total.get(), pct, false)
                jsProg(videoId, pct)
            }
            if (!ok || !tmp.exists() || tmp.length() <= 0L) {
                jsErr(videoId, "descarga fallida"); notify("Error de descarga", 0, false); return
            }

            // archivo m4a/aac a etiquetar (si hay que transcodificar opus, se hace antes)
            val taggable: File
            if (ext == "m4a" || ext == "mp4" || ext == "aac") {
                taggable = tmp
            } else {
                notify("Convirtiendo " + pos() + "/" + total.get(), 84, false)
                val okc = AudioTranscoder.transcodeToM4a(tmp.absolutePath, tmpM4a) { f ->
                    val pct = 80 + (f * 10).toInt()
                    notify("Convirtiendo " + pos() + "/" + total.get(), pct, false); jsProg(videoId, pct)
                }
                if (!okc) { jsErr(videoId, "no se pudo convertir"); notify("Error al convertir", 0, false); return }
                taggable = tmpM4a
            }

            // 2) incrustar TAG: título, artista (canal) y carátula (miniatura de YouTube)
            notify("Etiquetando " + pos() + "/" + total.get(), 92, false)
            try { TagWriter.write(taggable, info.title, uploader, downloadThumb(thumbUrl)) } catch (e: Throwable) {}

            // 3) guardar como .mp3 (compatible con casi todos los reproductores)
            notify("Guardando " + pos() + "/" + total.get(), 96, false)
            val outName = "$title.mp3"
            val saved = DskStorage.saveFromStream(applicationContext, outName, "audio/mpeg", FileInputStream(taggable))
            if (saved == null) { jsErr(videoId, "no se pudo guardar"); notify("Error al guardar", 0, false); return }

            jsProg(videoId, 100)
            jsDone(videoId, outName)
        } finally {
            try { tmp.delete() } catch (e: Exception) {}
            try { tmpM4a.delete() } catch (e: Exception) {}
        }
    }

    private fun downloadThumb(url: String): ByteArray? {
        if (url.isBlank()) return null
        return try {
            val client = OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).build()
            client.newCall(Request.Builder().url(url).header("User-Agent", ua).build()).execute().use { r ->
                if (!r.isSuccessful) null else r.body?.bytes()
            }
        } catch (e: Throwable) { null }
    }

    private fun stopSelfSafe() {
        try { @Suppress("DEPRECATION") stopForeground(true) } catch (e: Exception) {}
        stopSelf()
    }

    // ---- notificación ----
    private var lastPct = -1
    private var lastText = ""
    private fun notify(text: String, progress: Int, indet: Boolean) {
        if (!indet && progress == lastPct && text == lastText) return
        lastPct = progress; lastText = text
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NID, build(text, progress, indet))
    }

    private fun build(text: String, progress: Int, indet: Boolean): Notification =
        NotificationCompat.Builder(this, CH)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("DSK•LoFi")
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setProgress(100, progress, indet)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(CH) == null) {
                val ch = NotificationChannel(CH, "Descargas", NotificationManager.IMPORTANCE_LOW)
                ch.setShowBadge(false)
                nm.createNotificationChannel(ch)
            }
        }
    }

    // ---- callbacks a JS (si el WebView sigue vivo) ----
    private fun q(s: String) = org.json.JSONObject.quote(s)
    private fun jsProg(vid: String, pct: Int) =
        MainActivity.runJs("window.DSKDownloads&&window.DSKDownloads.__p&&window.DSKDownloads.__p(${q(vid)},$pct)")
    private fun jsDone(vid: String, name: String) =
        MainActivity.runJs("window.DSKDownloads&&window.DSKDownloads.__done&&window.DSKDownloads.__done(${q(vid)},${q(name)})")
    private fun jsErr(vid: String, msg: String) =
        MainActivity.runJs("window.DSKDownloads&&window.DSKDownloads.__err&&window.DSKDownloads.__err(${q(vid)},${q(msg)})")
}
