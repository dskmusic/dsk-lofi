package com.dskmusic.dsklofi

import android.content.Context
import android.webkit.JavascriptInterface
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import org.schabi.newpipe.extractor.NewPipe
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.InfoItem
import org.schabi.newpipe.extractor.stream.StreamInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Datos resueltos para descargar un audio de YouTube. */
data class DlInfo(val url: String, val title: String, val ext: String, val uploader: String)

/**
 * DSK•LoFi — YoutubeBridge
 *
 * Búsqueda y obtención de audio de YouTube EN EL DISPOSITIVO con
 * NewPipeExtractor. Sin servidor intermedio, sin API key.
 *
 *   - search(query, reqId)        → lista de vídeos (id, título, autor, duración, miniatura)
 *   - resolveAudio(videoId, reqId)→ URL de SOLO-AUDIO lista para reproducir
 *
 * La URL de audio CADUCA (unas horas) → en las listas guarda solo el videoId y
 * vuelve a llamar a resolveAudio al reproducir.
 *
 * Requiere NewPipe.init(YtDownloader.getInstance()) una sola vez (MainActivity).
 *
 * Respuestas a JS:
 *   window.DSKYoutube.__result(reqId, jsonString)
 *   window.DSKYoutube.__error(reqId, code)   // "notfound" | "network" | "unavailable"
 *
 * NOTA DE MANTENIMIENTO: si tras subir la versión de NewPipeExtractor algún
 * método aquí no compila (la API cambia de vez en cuando), ver UPDATE_NEWPIPE.md.
 */
class YoutubeBridge(private val ctx: Context) {

    private val pool = Executors.newCachedThreadPool()
    private val yt = ServiceList.YouTube

    companion object {
        private const val UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        /** (url, título, ext, uploader) del mejor audio para descarga. Prefiere m4a. */
        fun resolveForDownload(videoId: String): DlInfo? {
            return try {
                val info = StreamInfo.getInfo(ServiceList.YouTube, "https://www.youtube.com/watch?v=$videoId")
                val up = info.uploaderName ?: ""
                val audios = info.audioStreams
                val m4a = audios?.filter { !it.content.isNullOrBlank() && (it.format?.suffix == "m4a") }
                    ?.maxByOrNull { it.averageBitrate }
                val best = audios?.filter { !it.content.isNullOrBlank() }?.maxByOrNull { it.averageBitrate }
                val chosen = m4a ?: best
                if (chosen != null && !chosen.content.isNullOrBlank()) {
                    val ext = try { chosen.format?.suffix ?: "m4a" } catch (e: Exception) { "m4a" }
                    return DlInfo(chosen.content!!, info.name ?: videoId, ext, up)
                }
                val muxed = info.videoStreams?.firstOrNull { !it.content.isNullOrBlank() } ?: return null
                val ext = try { muxed.format?.suffix ?: "mp4" } catch (e: Exception) { "mp4" }
                DlInfo(muxed.content!!, info.name ?: videoId, ext, up)
            } catch (e: Throwable) { null }
        }
    }

    /** Búsqueda de vídeos. */
    // Versión real de NewPipeExtractor (viene del version catalog vía BuildConfig).
    @JavascriptInterface
    fun libVersion(): String = BuildConfig.NEWPIPE_VERSION

    @JavascriptInterface
    fun search(query: String, reqId: String) {
        pool.execute {
            try {
                val handler = yt.searchQHFactory.fromQuery(
                    query,
                    listOf(YoutubeSearchQueryHandlerFactory.VIDEOS),
                    ""
                )
                val extractor = yt.getSearchExtractor(handler)
                extractor.fetchPage()

                val out = JSONArray()
                val seen = HashSet<String>()
                val target = 50
                var page: org.schabi.newpipe.extractor.ListExtractor.InfoItemsPage<InfoItem>? = extractor.initialPage
                var guard = 0
                while (out.length() < target && guard < 6) {
                    val cur = page ?: break
                    for (item in cur.items) {
                        if (out.length() >= target) break
                        if (item.infoType != InfoItem.InfoType.STREAM) continue
                        val s = item as? StreamInfoItem ?: continue
                        val vurl = s.url ?: continue
                        val vid = try { yt.streamLHFactory.getId(vurl) } catch (e: Exception) { "" }
                        if (vid.isNullOrBlank() || !seen.add(vid)) continue
                        out.put(JSONObject().apply {
                            put("videoId", vid)
                            put("title", s.name ?: "")
                            put("uploader", s.uploaderName ?: "")
                            put("duration", s.duration)
                            put("thumb", bestThumb(s))
                        })
                    }
                    if (out.length() >= target) break
                    val np = cur.nextPage ?: break
                    page = try { extractor.getPage(np) } catch (e: Exception) { null }
                    guard++
                }
                if (out.length() == 0) callback("__error", reqId, "notfound")
                else result(reqId, out)
            } catch (e: Exception) {
                callback("__error", reqId, "network")
            }
        }
    }

    /** Resuelve la URL de SOLO-AUDIO de un vídeo (caduca: re-llamar al reproducir). */
    @JavascriptInterface
    fun resolveAudio(videoId: String, reqId: String) {
        pool.execute {
            try {
                val url = "https://www.youtube.com/watch?v=$videoId"
                val info = StreamInfo.getInfo(yt, url)

                // 1) preferir SOLO-AUDIO (mayor bitrate con URL directa)
                var contentUrl: String? = null
                var mime = "audio/mp4"
                var bitrate = 0
                val audios = info.audioStreams
                if (!audios.isNullOrEmpty()) {
                    val best = audios.filter { !it.content.isNullOrBlank() }
                        .maxByOrNull { it.averageBitrate }
                    if (best != null) {
                        contentUrl = best.content
                        bitrate = best.averageBitrate
                        mime = try { best.format?.mimeType ?: "audio/mp4" } catch (e: Exception) { "audio/mp4" }
                    }
                }

                // 2) respaldo: stream MIXTO (vídeo+audio); el <audio> reproduce solo el audio
                if (contentUrl.isNullOrBlank()) {
                    val muxed = info.videoStreams?.firstOrNull { !it.content.isNullOrBlank() }
                    if (muxed != null) {
                        contentUrl = muxed.content
                        mime = try { muxed.format?.mimeType ?: "video/mp4" } catch (e: Exception) { "video/mp4" }
                    }
                }

                if (contentUrl.isNullOrBlank()) { callback("__error", reqId, "sin streams de audio"); return@execute }

                val obj = JSONObject().apply {
                    put("videoId", videoId)
                    put("url", contentUrl)
                    put("mime", mime)
                    put("bitrate", bitrate)
                    put("title", info.name ?: "")
                    put("uploader", info.uploaderName ?: "")
                    put("duration", info.duration)
                    put("thumb", bestThumbInfo(info))
                }
                result(reqId, JSONArray().put(obj))
            } catch (e: Throwable) {
                callback("__error", reqId, shortErr(e))
            }
        }
    }

    private fun shortErr(e: Throwable): String {
        val name = e.javaClass.simpleName
        val msg = (e.message ?: "").replace("\n", " ").trim()
        val full = if (msg.isEmpty()) name else "$name: $msg"
        return if (full.length > 140) full.substring(0, 140) else full
    }

    // ---- descarga de audio a /DSKlofi con el nombre original del vídeo ----
    @JavascriptInterface
    fun downloadAudio(videoId: String, reqId: String) {
        pool.execute {
            try {
                val url = "https://www.youtube.com/watch?v=$videoId"
                val info = StreamInfo.getInfo(yt, url)

                var streamUrl: String? = null
                var ext = "m4a"
                val audios = info.audioStreams
                if (!audios.isNullOrEmpty()) {
                    val best = audios.filter { !it.content.isNullOrBlank() }.maxByOrNull { it.averageBitrate }
                    if (best != null) {
                        streamUrl = best.content
                        ext = try { best.format?.suffix ?: "m4a" } catch (e: Exception) { "m4a" }
                    }
                }
                if (streamUrl.isNullOrBlank()) {
                    val muxed = info.videoStreams?.firstOrNull { !it.content.isNullOrBlank() }
                    if (muxed != null) {
                        streamUrl = muxed.content
                        ext = try { muxed.format?.suffix ?: "mp4" } catch (e: Exception) { "mp4" }
                    }
                }
                if (streamUrl.isNullOrBlank()) { callback("__error", reqId, "sin streams de audio"); return@execute }

                val title = DskStorage.sanitize(info.name ?: videoId)
                val fileName = "$title.$ext"
                val mime = mimeForExt(ext)

                val client = OkHttpClient.Builder()
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .readTimeout(60, TimeUnit.SECONDS)
                    .build()
                val req = okhttp3.Request.Builder().url(streamUrl).header("User-Agent", UA).build()
                client.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) { callback("__error", reqId, "HTTP ${resp.code}"); return@execute }
                    val body = resp.body ?: run { callback("__error", reqId, "respuesta vacía"); return@execute }
                    val saved = DskStorage.saveFromStream(ctx, fileName, mime, body.byteStream())
                    if (saved == null) callback("__error", reqId, "no se pudo guardar")
                    else { result(reqId, JSONArray().put(JSONObject().apply { put("saved", saved) })) }
                }
            } catch (e: Throwable) {
                callback("__error", reqId, shortErr(e))
            }
        }
    }

    /** URL del mejor stream de audio (audio-only; respaldo mixto). Síncrono. */
    fun resolveStreamUrl(videoId: String): String? {
        return try {
            val info = StreamInfo.getInfo(yt, "https://www.youtube.com/watch?v=$videoId")
            var u = info.audioStreams?.filter { !it.content.isNullOrBlank() }
                ?.maxByOrNull { it.averageBitrate }?.content
            if (u.isNullOrBlank()) {
                u = info.videoStreams?.firstOrNull { !it.content.isNullOrBlank() }?.content
            }
            u
        } catch (e: Throwable) { null }
    }

    /** Túnel de un stream ya resuelto (la extracción se hace antes en JS). */
    fun openUrlStream(streamUrl: String): okhttp3.Response? {
        return try {
            val client = OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build()
            val req = okhttp3.Request.Builder().url(streamUrl).header("User-Agent", UA).build()
            val resp = client.newCall(req).execute()
            if (resp.isSuccessful) resp else { resp.close(); null }
        } catch (e: Throwable) { null }
    }

    // ---- descarga paralela a temporal (rápida) para convertir a MP3 en JS ----
    private val tempReg = ConcurrentHashMap<String, File>()

    @JavascriptInterface
    fun fetchToTemp(videoId: String, reqId: String) {
        pool.execute {
            try {
                val info = resolveForDownload(videoId)
                    ?: run { callback("__error", reqId, "sin streams"); return@execute }
                val url = info.url; val title = info.title; val ext = info.ext
                val tmp = File(ctx.cacheDir, "ytdl_" + System.nanoTime() + "." + ext)
                val ok = ParallelDownloader.download(url, UA, tmp) { f -> dlprog(reqId, (f * 100).toInt()) }
                if (!ok || !tmp.exists() || tmp.length() <= 0L) {
                    try { tmp.delete() } catch (e: Exception) {}
                    callback("__error", reqId, "descarga fallida"); return@execute
                }
                val token = "t" + System.nanoTime()
                tempReg[token] = tmp
                result(reqId, JSONArray().put(JSONObject().apply {
                    put("token", token); put("title", title); put("ext", ext)
                }))
            } catch (e: Throwable) {
                callback("__error", reqId, shortErr(e))
            }
        }
    }

    @JavascriptInterface
    fun cleanupTemp(token: String) {
        tempReg.remove(token)?.let { try { it.delete() } catch (e: Exception) {} }
    }

    /** Usado por el proxy interno /ytlocal?id=token para servir el archivo local. */
    fun tempFile(token: String): File? = tempReg[token]

    private fun dlprog(reqId: String, pct: Int) =
        MainActivity.runJs("window.DSKYoutube&&window.DSKYoutube.__dlprog&&window.DSKYoutube.__dlprog(${JSONObject.quote(reqId)},$pct)")

    private fun mimeForExt(ext: String): String = when (ext.lowercase()) {
        "m4a", "mp4" -> "audio/mp4"
        "webm" -> "audio/webm"
        "opus" -> "audio/opus"
        "ogg" -> "audio/ogg"
        "mp3" -> "audio/mpeg"
        else -> "audio/*"
    }

    // ---- miniaturas (la API moderna devuelve List<Image>) ----
    private fun bestThumb(s: StreamInfoItem): String = try {
        val list = s.thumbnails
        if (!list.isNullOrEmpty()) list.last().url ?: "" else ""
    } catch (e: Throwable) { "" }

    private fun bestThumbInfo(info: StreamInfo): String = try {
        val list = info.thumbnails
        if (!list.isNullOrEmpty()) list.last().url ?: "" else ""
    } catch (e: Throwable) { "" }

    // ---- callbacks a JS ----
    private fun result(reqId: String, arr: JSONArray) {
        val payload = JSONObject.quote(arr.toString())
        MainActivity.runJs("window.DSKYoutube&&window.DSKYoutube.__result(${JSONObject.quote(reqId)},$payload)")
    }
    private fun callback(fn: String, reqId: String, code: String) {
        MainActivity.runJs("window.DSKYoutube&&window.DSKYoutube.$fn(${JSONObject.quote(reqId)},${JSONObject.quote(code)})")
    }
}