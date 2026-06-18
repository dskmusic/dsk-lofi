package com.dskmusic.dsklofi

import android.app.Activity
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * Puente JS <-> nativo para la separación de stems.
 *
 * Registro (en MainActivity.attachBridges o donde añades los demás):
 *     webView.addJavascriptInterface(StemsBridge(this, webView), "DSKStemsBridge")
 *
 * El frontend (DSKStems en app.js) usa:
 *     DSKStemsBridge.available() / cached(key) / uriFor(key,which) / separate(json) / cancel()
 * y recibe:
 *     window.DSKStemsProgress(pct, stage)
 *     window.DSKStemsDone({key, instrumental, vocals})
 *     window.DSKStemsError(code)
 */
class StemsBridge(
    private val activity: Activity,
    private val webView: WebView
) {

    @Volatile private var worker: Thread? = null
    @Volatile private var cancelFlag = false
    @Volatile private var dlWorker: Thread? = null
    @Volatile private var dlCancel = false

    companion object {
        // Modelo por defecto (se descarga solo si no hay ninguno en /DSKlofi/models ni en assets)
        const val DEFAULT_MODEL = "UVR-MDX-NET-Inst_HQ_2.onnx"
    }

    /** Carpeta /DSKlofi/models donde el usuario puede dejar varios .onnx */
    private fun modelsDir(): File {
        val d = File(DskStorage.dir(), "models")
        if (!d.exists()) d.mkdirs()
        return d
    }

    private fun stemsRoot(): File {
        val d = File(DskStorage.dir(), "stems")
        if (!d.exists()) d.mkdirs()
        return d
    }

    /** Carpeta /DSKlofi/stems/<nombre de la canción>/ */
    private fun songDir(name: String?): File {
        val safe = DskStorage.sanitize((name ?: "track")).ifBlank { "track" }
        return File(stemsRoot(), safe)
    }

    private fun baseName(name: String?) = DskStorage.sanitize((name ?: "track")).ifBlank { "track" }
    private fun instFile(name: String?) = File(songDir(name), baseName(name) + " (instrumental).wav")
    private fun voxFile(name: String?) = File(songDir(name), baseName(name) + " (voz).wav")

    /** Lista de modelos .onnx disponibles (en /DSKlofi/models + assets/models). */
    @JavascriptInterface
    fun listModels(): String {
        val names = LinkedHashSet<String>()
        try { modelsDir().listFiles()?.forEach { if (it.isFile && it.name.endsWith(".onnx", true)) names.add(it.name) } } catch (e: Exception) {}
        try { activity.assets.list("models")?.forEach { if (it.endsWith(".onnx", true)) names.add(it) } } catch (e: Exception) {}
        val arr = org.json.JSONArray()
        names.sorted().forEach { arr.put(it) }
        return arr.toString()
    }

    /** n_fft según el nombre del modelo (6144 normal; 7680 para HQ_3 / Kim / Voc_FT). */
    private fun nfftFor(name: String): Int {
        val n = name.lowercase()
        return if (n.contains("hq_3") || n.contains("kim") || n.contains("voc_ft") || n.contains("7680")) 7680 else 6144
    }

    /** Ruta del modelo elegido: /DSKlofi/models o assets (copiado a disco). NO descarga. */
    private fun resolveModelFile(chosen: String): File {
        val name = if (chosen.isNotBlank()) chosen else DEFAULT_MODEL
        val ext = File(modelsDir(), name)
        if (ext.exists() && ext.length() > 0) return ext
        // ¿empaquetado en assets? lo copiamos a filesDir/models para tener un File
        try {
            activity.assets.open("models/$name").use { input ->
                val cacheDir = File(activity.filesDir, "models"); cacheDir.mkdirs()
                val out = File(cacheDir, name)
                if (!out.exists() || out.length() == 0L) FileOutputStream(out).use { input.copyTo(it, 64 * 1024) }
                return out
            }
        } catch (e: Exception) {}
        throw IllegalStateException("nomodel")   // que el usuario lo descargue desde el panel
    }

    /** Descarga un modelo a /DSKlofi/models probando varios espejos (JSON array de URLs). */
    @JavascriptInterface
    fun downloadModel(urlsJson: String, filename: String) {
        if (dlWorker != null) return
        dlCancel = false
        dlWorker = Thread {
            try {
                val urls = ArrayList<String>()
                try {
                    val a = org.json.JSONArray(urlsJson)
                    for (i in 0 until a.length()) urls.add(a.getString(i))
                } catch (e: Exception) { urls.add(urlsJson) }   // compat: una sola URL

                val dest = File(modelsDir(), filename)
                var ok = false; var lastErr: Exception? = null
                for (u in urls) {
                    if (dlCancel) throw InterruptedException("cancel")
                    try { downloadModelTo(u, dest); ok = true; break }
                    catch (ie: InterruptedException) { throw ie }
                    catch (e: Exception) { lastErr = e }   // falló este espejo -> probar el siguiente
                }
                if (!ok) throw (lastErr ?: IllegalStateException("fail"))

                try { android.media.MediaScannerConnection.scanFile(activity, arrayOf(dest.absolutePath), null, null) } catch (e: Exception) {}
                post("DSKModelDLDone", quote(filename))
            } catch (e: InterruptedException) {
                post("DSKModelDLError", "'cancel'")
            } catch (e: Exception) {
                post("DSKModelDLError", "'${(e.message ?: "fail").replace("'", " ")}'")
            } finally { dlWorker = null }
        }.also { it.start() }
    }

    @JavascriptInterface
    fun cancelDownload() { dlCancel = true; dlWorker?.interrupt() }

    /** Borra un modelo de /DSKlofi/models (y la copia en filesDir si existe). */
    @JavascriptInterface
    fun deleteModel(filename: String?): Boolean {
        if (filename.isNullOrBlank()) return false
        var ok = false
        try { val f = File(modelsDir(), filename); if (f.exists()) ok = f.delete() } catch (e: Exception) {}
        try { val f2 = File(File(activity.filesDir, "models"), filename); if (f2.exists()) f2.delete() } catch (e: Exception) {}
        return ok
    }

    /** Libera memoria: no mantenemos el modelo residente entre pasadas; solo una pista al GC. */
    @JavascriptInterface
    fun freeModel() { System.gc() }

    private fun downloadModelTo(url: String, dest: File) {
        dest.parentFile?.mkdirs()
        val tmp = File(dest.parentFile, dest.name + ".part")
        var conn: java.net.HttpURLConnection? = null
        try {
            post("DSKModelDLProgress", "0")
            conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 20000; conn.readTimeout = 30000
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", "DSKLoFi")
            conn.connect()
            if (conn.responseCode !in 200..299) throw IllegalStateException("http")
            val total = conn.contentLengthLong
            conn.inputStream.use { input ->
                FileOutputStream(tmp).use { fos ->
                    val buf = ByteArray(64 * 1024); var read: Int; var done = 0L; var last = -1
                    while (input.read(buf).also { read = it } >= 0) {
                        if (dlCancel) throw InterruptedException("cancel")
                        fos.write(buf, 0, read); done += read
                        if (total > 0) { val p = (done * 100 / total).toInt(); if (p != last) { last = p; post("DSKModelDLProgress", "$p") } }
                    }
                }
            }
            if (!tmp.renameTo(dest)) { tmp.copyTo(dest, overwrite = true); tmp.delete() }
            post("DSKModelDLProgress", "100")
        } catch (e: Exception) { tmp.delete(); throw e }
        finally { try { conn?.disconnect() } catch (_: Exception) {} }
    }


    @JavascriptInterface
    fun available(): Boolean = true

    /** "none" | "instrumental" | "vocals" | "both" — por nombre de canción */
    @JavascriptInterface
    fun cached(name: String?): String {
        if (name.isNullOrEmpty()) return "none"
        val hasI = instFile(name).exists()
        val hasV = voxFile(name).exists()
        return when {
            hasI && hasV -> "both"
            hasI -> "instrumental"
            hasV -> "vocals"
            else -> "none"
        }
    }

    /** Devuelve file:// del stem ya guardado en /DSKlofi/stems/<nombre>/ */
    @JavascriptInterface
    fun uriFor(name: String?, which: String?): String? {
        if (name.isNullOrEmpty()) return null
        val f = if (which == "vocals") voxFile(name) else instFile(name)
        return if (f.exists()) Uri.fromFile(f).toString() else null
    }

    @JavascriptInterface
    fun cancel() {
        cancelFlag = true
        worker?.interrupt()
        StemsService.stop(activity)
    }

    @JavascriptInterface
    fun separate(optsJson: String) {
        if (worker != null) return
        cancelFlag = false
        val opts = try { JSONObject(optsJson) } catch (e: Exception) { post("DSKStemsError", "'badopts'"); return }

        val key = opts.optString("key", "")
        val name = opts.optString("name", "track")
        val uriStr = opts.optString("uri", "")
        val nativeIndex = if (opts.isNull("nativeIndex")) -1 else opts.optInt("nativeIndex", -1)
        val save = opts.optJSONObject("save")
        val wantInst = save?.optBoolean("instrumental", true) ?: true
        val wantVox = save?.optBoolean("vocals", true) ?: true
        val modelName = opts.optString("model", "")
        val swap = opts.optBoolean("swap", false)

        StemsService.start(activity)

        worker = Thread {
            try {
                val modelFile = resolveModelFile(modelName)   // descarga el por defecto si hace falta
                if (cancelFlag) { post("DSKStemsError", "'cancel'"); return@Thread }
                val sep = StemSeparator(
                    activity,
                    nfftFor(if (modelName.isNotBlank()) modelName else DEFAULT_MODEL),
                    onProgress = { pct, stage -> post("DSKStemsProgress", "$pct, '${stage}'") },
                    isCancelled = { cancelFlag || Thread.currentThread().isInterrupted }
                )
                // Resolver origen: uri directa, o índice nativo via tu resolutor existente.
                val srcUri: Uri? = if (uriStr.isNotEmpty()) Uri.parse(uriStr) else resolveNativeIndexUri(nativeIndex)
                val srcPath: String? = null

                val outDir = songDir(name)
                if (!outDir.exists()) outDir.mkdirs()
                val res = sep.separate(
                    sourceUri = srcUri,
                    sourcePath = srcPath,
                    outDir = outDir,
                    modelFile = modelFile,
                    wantInstrumental = wantInst,
                    wantVocals = wantVox,
                    swap = swap
                )

                if (cancelFlag) { post("DSKStemsError", "'cancel'"); return@Thread }

                // que aparezcan en el explorador / reproductores
                val paths = listOfNotNull(res.instrumental?.absolutePath, res.vocals?.absolutePath).toTypedArray()
                if (paths.isNotEmpty()) {
                    try { android.media.MediaScannerConnection.scanFile(activity, paths, arrayOf("audio/wav", "audio/wav"), null) } catch (e: Exception) {}
                }

                val out = JSONObject()
                out.put("key", key)
                out.put("instrumental", res.instrumental?.let { Uri.fromFile(it).toString() } ?: JSONObject.NULL)
                out.put("vocals", res.vocals?.let { Uri.fromFile(it).toString() } ?: JSONObject.NULL)
                post("DSKStemsDone", quote(out.toString()))
            } catch (e: InterruptedException) {
                post("DSKStemsError", "'cancel'")
            } catch (e: OutOfMemoryError) {
                post("DSKStemsError", "'oom'")
            } catch (e: IllegalStateException) {
                post("DSKStemsError", "'${e.message ?: "fail"}'")
            } catch (e: Exception) {
                post("DSKStemsError", "'${(e.message ?: "fail").replace("'", " ")}'")
            } finally {
                worker = null
                StemsService.stop(activity)
                System.gc()   // sugerir liberación tras una pasada pesada
            }
        }.also { it.priority = Thread.NORM_PRIORITY - 1; it.start() }
    }

    /**
     * TODO: conéctalo con tu resolutor de índices nativos (el mismo que usa
     * DSKBridge.readAudioAt). Si tu app mantiene una lista de Uris cargada,
     * devuelve aquí la Uri del índice. Por defecto null: se usa la `uri` directa
     * que ya envía el frontend para las pistas SAF (la mayoría de casos).
     */
    private fun resolveNativeIndexUri(index: Int): Uri? {
        if (index < 0) return null
        // return DskStorage.uriForIndex(activity, index)   // <-- descomenta y ajusta a tu API
        return null
    }

    private fun quote(s: String): String {
        val esc = s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")
        return "'$esc'"
    }

    private fun post(fn: String, args: String) {
        activity.runOnUiThread {
            try { webView.evaluateJavascript("window.$fn && window.$fn($args);", null) } catch (e: Exception) {}
        }
    }
}
