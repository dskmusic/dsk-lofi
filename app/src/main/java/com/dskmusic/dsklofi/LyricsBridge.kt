package com.dskmusic.dsklofi

import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * DSK•LoFi — LyricsBridge
 *
 * Búsqueda de letras 100% en el dispositivo, sin proxy ni servidor intermedio.
 *   - LRCLIB  → API libre oficial (JSON). Devuelve letra plana y SINCRONIZADA.
 *   - Genius  → scraping del HTML con Jsoup (sin API key).
 *
 * REGISTRO (en MainActivity, donde ya registras los demás interfaces):
 *     webView.addJavascriptInterface(LyricsBridge(), "DSKLyrics")
 *
 * CONTRATO CON JS (lo implementa lyrics.js):
 *   Kotlin llama de vuelta a:
 *     window.DSKLyrics.__result(reqId, jsonString)   // éxito (lista de resultados)
 *     window.DSKLyrics.__error(reqId, code)          // "notfound" | "network"
 *
 * FORMATO de cada resultado en el array JSON:
 *   {
 *     "source": "lrclib" | "genius",
 *     "title":  String,
 *     "artist": String,
 *     "plain":  String | "",   // letra en texto plano (saltos con \n)
 *     "synced": String | "",   // letra .lrc con timestamps [mm:ss.xx] (solo lrclib)
 *     "url":    String | ""    // página de Genius (informativo)
 *   }
 *
 * Asíncrono: cada @JavascriptInterface lanza el trabajo en un hilo y NO bloquea
 * el hilo JS. Las respuestas vuelven por MainActivity.runJs(...).
 */
class LyricsBridge {

    private val pool = Executors.newCachedThreadPool()

    companion object {
        private const val UA =
            "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36"
        private const val TIMEOUT = 12000
    }

    /**
     * Punto de entrada desde JS.
     * @param query   texto a buscar (título + artista, o lo que escriba el usuario)
     * @param source  "lrclib" | "genius"
     * @param reqId   identificador para emparejar la respuesta en JS
     */
    @JavascriptInterface
    fun search(query: String, source: String, reqId: String) {
        pool.execute {
            try {
                val results = when (source) {
                    "genius"  -> searchGenius(query)
                    "netease" -> searchNetease(query)
                    else      -> searchLrclib(query)
                }
                if (results.length() == 0) {
                    callback("__error", reqId, "notfound")
                } else {
                    callbackResult(reqId, results)
                }
            } catch (e: Exception) {
                callback("__error", reqId, "network")
            }
        }
    }

    // ───────────────────────────── LRCLIB ─────────────────────────────
    // GET https://lrclib.net/api/search?q=QUERY
    // Respuesta: array de objetos con plainLyrics y syncedLyrics.
    private fun searchLrclib(query: String): JSONArray {
        val url = "https://lrclib.net/api/search?q=" + enc(query)
        val body = Jsoup.connect(url)
            .ignoreContentType(true)
            .userAgent(UA)
            .timeout(TIMEOUT)
            .header("Accept", "application/json")
            .execute()
            .body()

        val arr = JSONArray(body)
        val out = JSONArray()
        val max = minOf(arr.length(), 15)
        for (i in 0 until max) {
            val o = arr.optJSONObject(i) ?: continue
            val plain = o.optString("plainLyrics", "")
            val synced = o.optString("syncedLyrics", "")
            if (plain.isBlank() && synced.isBlank()) continue
            out.put(JSONObject().apply {
                put("source", "lrclib")
                put("title", o.optString("trackName", ""))
                put("artist", o.optString("artistName", ""))
                put("plain", plain)
                put("synced", synced)
                put("url", "")
            })
        }
        return out
    }

    // ───────────────────────────── GENIUS ─────────────────────────────
    private fun searchGenius(query: String): JSONArray {
        val out = JSONArray()
        // A) buscador interno → URLs reales de canciones
        val searchUrl = "https://genius.com/api/search/multi?per_page=5&q=" + enc(query)
        val json = Jsoup.connect(searchUrl)
            .ignoreContentType(true)
            .userAgent(UA)
            .timeout(TIMEOUT)
            .header("Accept", "application/json")
            .execute()
            .body()

        val hits = collectSongHits(JSONObject(json))
        val max = minOf(hits.size, 5)
        for (i in 0 until max) {
            val hit = hits[i]
            val pageUrl = hit.optString("url", "")
            if (pageUrl.isBlank()) continue
            val lyrics = try { scrapeGeniusLyrics(pageUrl) } catch (e: Exception) { "" }
            if (lyrics.isBlank()) continue
            out.put(JSONObject().apply {
                put("source", "genius")
                put("title", hit.optString("title", ""))
                put("artist", hit.optJSONObject("primary_artist")?.optString("name", "") ?: "")
                put("plain", lyrics)
                put("synced", "")            // Genius no da letra sincronizada
                put("url", pageUrl)
            })
        }
        return out
    }

    /** Recorre response.sections[*].hits[*].result quedándose con tipo "song". */
    private fun collectSongHits(root: JSONObject): List<JSONObject> {
        val list = ArrayList<JSONObject>()
        val sections = root.optJSONObject("response")?.optJSONArray("sections") ?: return list
        for (s in 0 until sections.length()) {
            val sec = sections.optJSONObject(s) ?: continue
            if (sec.optString("type") != "song") continue
            val hits = sec.optJSONArray("hits") ?: continue
            for (h in 0 until hits.length()) {
                val res = hits.optJSONObject(h)?.optJSONObject("result") ?: continue
                list.add(res)
            }
        }
        return list
    }

    /**
     * B/C/D) Descarga la página y extrae la letra.
     *  - Prioriza el atributo estable  [data-lyrics-container=true]
     *  - Fallback a  div[class^=Lyrics__Container]
     *  - Sustituye <br> por \n ANTES de extraer texto, para conservar el formato.
     */
    private fun scrapeGeniusLyrics(pageUrl: String): String {
        val doc: Document = Jsoup.connect(pageUrl)
            .userAgent(UA)
            .timeout(TIMEOUT)
            .get()

        var containers = doc.select("[data-lyrics-container=true]")
        if (containers.isEmpty()) containers = doc.select("div[class^=Lyrics__Container]")
        if (containers.isEmpty()) containers = doc.select("div.lyrics")   // tema antiguo
        if (containers.isEmpty()) return ""

        val sb = StringBuilder()
        for (c in containers) {
            // <br> → \n  (Jsoup colapsaría los saltos en .text())
            c.select("br").append("\\n")
            // descripciones entre [] y bloques de anotación que a veces se cuelan
            val text = c.text()
                .replace("\\n", "\n")
                .replace(Regex("\\n{3,}"), "\n\n")
                .trim()
            if (text.isNotBlank()) {
                if (sb.isNotEmpty()) sb.append("\n\n")
                sb.append(text)
            }
        }
        return sb.toString().trim()
    }

    // ───────────────────────────── NETEASE ─────────────────────────────
    // Buscador + letra de music.163.com. Sin clave. Devuelve sincronizada (.lrc)
    // y, derivada de ella, la plana. Endpoints no oficiales: requieren Referer.
    private fun searchNetease(query: String): JSONArray {
        val out = JSONArray()
        val searchUrl = "https://music.163.com/api/search/get?type=1&limit=5&offset=0&s=" + enc(query)
        val json = Jsoup.connect(searchUrl)
            .ignoreContentType(true)
            .userAgent(UA)
            .timeout(TIMEOUT)
            .header("Accept", "application/json")
            .header("Referer", "https://music.163.com")
            .header("Cookie", "appver=2.0.2")
            .execute()
            .body()

        val songs = JSONObject(json).optJSONObject("result")?.optJSONArray("songs") ?: return out
        val max = minOf(songs.length(), 5)
        for (i in 0 until max) {
            val song = songs.optJSONObject(i) ?: continue
            val id = song.optLong("id", 0L)
            if (id == 0L) continue
            val title = song.optString("name", "")
            val artist = run {
                val arr = song.optJSONArray("artists")
                val sb = StringBuilder()
                if (arr != null) for (a in 0 until arr.length()) {
                    val nm = arr.optJSONObject(a)?.optString("name") ?: continue
                    if (nm.isBlank()) continue
                    if (sb.isNotEmpty()) sb.append(", ")
                    sb.append(nm)
                }
                sb.toString()
            }
            val pair = try { neteaseLyric(id) } catch (e: Exception) { null } ?: continue
            val (plain, synced) = pair
            if (plain.isBlank() && synced.isBlank()) continue
            out.put(JSONObject().apply {
                put("source", "netease")
                put("title", title)
                put("artist", artist)
                put("plain", plain)
                put("synced", synced)
                put("url", "")
            })
        }
        return out
    }

    private fun neteaseLyric(id: Long): Pair<String, String> {
        val url = "https://music.163.com/api/song/lyric?id=$id&lv=1&kv=1&tv=-1"
        val json = Jsoup.connect(url)
            .ignoreContentType(true)
            .userAgent(UA)
            .timeout(TIMEOUT)
            .header("Accept", "application/json")
            .header("Referer", "https://music.163.com")
            .execute()
            .body()
        val raw = JSONObject(json).optJSONObject("lrc")?.optString("lyric", "") ?: ""
        if (raw.isBlank()) return Pair("", "")
        val hasTs = Regex("\\[\\d{1,2}:\\d{2}").containsMatchIn(raw)
        return if (hasTs) Pair(stripLrc(raw), raw) else Pair(raw, "")
    }

    // Quita marcas [..] (tiempos y metadatos) para la versión en texto plano.
    private fun stripLrc(s: String): String =
        s.lineSequence()
            .map { it.replace(Regex("\\[[^\\]]*\\]"), "").trim() }
            .filter { it.isNotEmpty() }
            .joinToString("\n")

    // ───────────────────────────── helpers ─────────────────────────────
    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    private fun callbackResult(reqId: String, results: JSONArray) {
        val payload = JSONObject.quote(results.toString())   // string JSON escapado y entrecomillado
        MainActivity.runJs("window.DSKLyrics&&window.DSKLyrics.__result(${JSONObject.quote(reqId)},$payload)")
    }

    private fun callback(fn: String, reqId: String, code: String) {
        MainActivity.runJs(
            "window.DSKLyrics&&window.DSKLyrics.$fn(${JSONObject.quote(reqId)},${JSONObject.quote(code)})"
        )
    }
}