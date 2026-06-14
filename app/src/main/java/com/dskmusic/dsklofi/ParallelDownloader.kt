package com.dskmusic.dsklofi

import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.RandomAccessFile
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * DSK•LoFi — ParallelDownloader
 *
 * Descarga una URL a un archivo usando varias conexiones por rangos en paralelo.
 * YouTube limita la velocidad POR conexión (≈ tiempo real); con varias conexiones
 * a la vez se multiplica el ancho de banda → descargas mucho más rápidas.
 */
object ParallelDownloader {

    fun download(url: String, ua: String, outFile: File, parts: Int = 6, onProgress: (Float) -> Unit): Boolean {
        return try {
            val client = OkHttpClient.Builder()
                .connectTimeout(30, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .build()

            // 1) tamaño total + soporte de rangos
            val probe = client.newCall(
                Request.Builder().url(url).header("User-Agent", ua).header("Range", "bytes=0-0").build()
            ).execute()
            val supportsRange = probe.code == 206
            val contentRange = probe.header("Content-Range")
            val total = when {
                contentRange != null && contentRange.contains("/") ->
                    contentRange.substringAfterLast("/").toLongOrNull() ?: -1L
                else -> probe.header("Content-Length")?.toLongOrNull() ?: -1L
            }
            probe.close()

            if (!supportsRange || total <= 0) {
                return downloadSingle(client, url, ua, outFile, onProgress)
            }

            RandomAccessFile(outFile, "rw").use { it.setLength(total) }

            val n = parts.coerceIn(1, 8)
            val chunk = total / n
            val downloaded = AtomicLong(0)
            val failed = AtomicBoolean(false)
            val pool = Executors.newFixedThreadPool(n)

            val tasks = (0 until n).map { idx ->
                val start = idx * chunk
                val end = if (idx == n - 1) total - 1 else (start + chunk - 1)
                Callable {
                    if (failed.get()) return@Callable
                    try {
                        val req = Request.Builder().url(url)
                            .header("User-Agent", ua)
                            .header("Range", "bytes=$start-$end")
                            .build()
                        client.newCall(req).execute().use { resp ->
                            if (resp.code != 206 && resp.code != 200) { failed.set(true); return@Callable }
                            val body = resp.body ?: run { failed.set(true); return@Callable }
                            RandomAccessFile(outFile, "rw").use { raf ->
                                raf.seek(start)
                                val buf = ByteArray(64 * 1024); var read: Int
                                body.byteStream().use { ins ->
                                    while (ins.read(buf).also { read = it } >= 0) {
                                        raf.write(buf, 0, read)
                                        val d = downloaded.addAndGet(read.toLong())
                                        val f = d.toFloat() / total
                                        onProgress(if (f < 0f) 0f else if (f > 1f) 1f else f)
                                    }
                                }
                            }
                        }
                    } catch (e: Exception) { failed.set(true) }
                }
            }
            pool.invokeAll(tasks)
            pool.shutdown()
            onProgress(1f)
            !failed.get() && outFile.length() == total
        } catch (e: Throwable) {
            false
        }
    }

    private fun downloadSingle(client: OkHttpClient, url: String, ua: String, outFile: File, onProgress: (Float) -> Unit): Boolean {
        return try {
            val resp = client.newCall(Request.Builder().url(url).header("User-Agent", ua).build()).execute()
            if (!resp.isSuccessful) { resp.close(); return false }
            val body = resp.body ?: run { resp.close(); return false }
            val total = body.contentLength()
            body.byteStream().use { ins ->
                outFile.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024); var read: Int; var got = 0L
                    while (ins.read(buf).also { read = it } >= 0) {
                        out.write(buf, 0, read); got += read
                        if (total > 0) onProgress((got.toFloat() / total).coerceIn(0f, 1f))
                    }
                }
            }
            resp.close()
            onProgress(1f)
            true
        } catch (e: Throwable) { false }
    }
}