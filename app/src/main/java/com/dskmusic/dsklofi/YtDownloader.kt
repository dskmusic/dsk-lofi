package com.dskmusic.dsklofi

import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import java.util.concurrent.TimeUnit

/**
 * DSK•LoFi — YtDownloader
 *
 * Implementación de Downloader para NewPipeExtractor basada en OkHttp.
 * Es prácticamente la misma que usa la app NewPipe (DownloaderImpl) reducida a
 * lo imprescindible. NewPipe la necesita para hacer las peticiones HTTP.
 *
 * Inicialización (una sola vez, en MainActivity.onCreate):
 *     NewPipe.init(YtDownloader.getInstance())
 */
class YtDownloader private constructor() : Downloader() {

    private val client: OkHttpClient = OkHttpClient.Builder()
        .readTimeout(30, TimeUnit.SECONDS)
        .connectTimeout(30, TimeUnit.SECONDS)
        .build()

    companion object {
        // UA de navegador: ayuda a que YouTube responda como al cliente web.
        private const val USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        @Volatile
        private var instance: YtDownloader? = null

        fun getInstance(): YtDownloader =
            instance ?: synchronized(this) {
                instance ?: YtDownloader().also { instance = it }
            }
    }

    override fun execute(request: Request): Response {
        val httpMethod = request.httpMethod()
        val url = request.url()
        val headers = request.headers()
        val dataToSend = request.dataToSend()

        val requestBody = dataToSend?.toRequestBody(null, 0, dataToSend.size)

        val builder = okhttp3.Request.Builder()
            .method(httpMethod, requestBody)
            .url(url)
            .addHeader("User-Agent", USER_AGENT)

        for ((headerName, headerValueList) in headers) {
            if (headerValueList.size > 1) {
                builder.removeHeader(headerName)
                for (value in headerValueList) builder.addHeader(headerName, value)
            } else if (headerValueList.size == 1) {
                builder.header(headerName, headerValueList[0])
            }
        }

        val response = client.newCall(builder.build()).execute()

        if (response.code == 429) {
            response.close()
            throw ReCaptchaException("reCaptcha Challenge requested", url)
        }

        val body = response.body?.string()
        val latestUrl = response.request.url.toString()

        return Response(
            response.code,
            response.message,
            response.headers.toMultimap(),
            body,
            latestUrl
        )
    }
}
