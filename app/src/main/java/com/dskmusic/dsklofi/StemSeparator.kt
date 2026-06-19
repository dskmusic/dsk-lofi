package com.dskmusic.dsklofi

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import org.jtransforms.fft.FloatFFT_1D
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.ShortBuffer
import kotlin.math.cos
import kotlin.math.min

/**
 * Separación voz / instrumental con un modelo ONNX **MDX-Net** (UVR).
 *
 * Tubería idéntica a la de UVR/MDX (Conv-TDF):
 *  - PCM estéreo a 44100.
 *  - Troceado con borde (trim) y solape: gen = chunk - 2*trim.
 *  - STFT compleja centrada (n_fft, hop) por canal → recorte a dim_f bins.
 *  - Tensor de entrada [1, 4, dim_f, dim_t] con canales [L_re, L_im, R_re, R_im].
 *  - El modelo devuelve el **instrumental** (misma forma).
 *  - ISTFT → instrumental; **voz = mezcla − instrumental** (fase exacta).
 *
 * Modelo recomendado: UVR-MDX-NET-Inst_HQ_2.onnx  (n_fft=6144, dim_f=3072, dim_t=256).
 * Para HQ_3 / Kim_Vocal usa n_fft=7680 (cambia N_FFT abajo).
 */
class StemSeparator(
    private val ctx: Context,
    private val nFft: Int,
    private val onProgress: (pct: Int, stage: String) -> Unit,
    private val isCancelled: () -> Boolean
) {

    data class Result(val instrumental: File?, val vocals: File?)

    companion object {
        const val SR = 44100

        // dim_f y dim_t se LEEN del propio modelo; n_fft lo decide el bridge (6144 / 7680).
        const val HOP = 1024
        const val DIM_C = 4           // 2 canales x (re, im)
    }

    private val window: FloatArray = hannPeriodic(nFft)
    private val fft = FloatFFT_1D(nFft.toLong())

    // se ajustan al abrir el modelo (autodetección de forma)
    private var dimF = 3072
    private var dimT = 256
    private val nBins = nFft / 2 + 1
    private val trim = nFft / 2
    private var chunk = HOP * (dimT - 1)
    private var gen = chunk - 2 * trim

    @Throws(Exception::class)
    fun separate(
        sourceUri: Uri?,
        sourcePath: String?,
        outDir: File,
        modelFile: File,
        wantInstrumental: Boolean,
        wantVocals: Boolean,
        swap: Boolean = false
    ): Result {
        onProgress(2, "decode")
        val stereo = decodePcm(sourceUri, sourcePath) ?: throw IllegalStateException("decode")
        var left = stereo[0]; var right = stereo[1]
        val n = min(left.size, right.size)
        if (n < HOP) throw IllegalStateException("decode")
        if (isCancelled()) throw InterruptedException("cancel")

        val env = OrtEnvironment.getEnvironment()
        // ORT lee el modelo DIRECTAMENTE del fichero (sin cargar ~66 MB en un
        // array de Java), así dejamos RAM libre para el audio y los buffers.
        makeSession(env, modelFile.absolutePath).use { session ->
            val inName = session.inputNames.iterator().next()
            // autodetectar dim_f / dim_t de la forma de entrada [1, 4, dim_f, dim_t]
            try {
                val ti = session.inputInfo[inName]!!.info as ai.onnxruntime.TensorInfo
                val shp = ti.shape
                if (shp.size >= 4) {
                    if (shp[2] > 0) dimF = shp[2].toInt()
                    if (shp[3] > 0) dimT = shp[3].toInt()
                    chunk = HOP * (dimT - 1); gen = chunk - 2 * trim
                }
            } catch (e: Throwable) {}

            // padding como en UVR demix (con gen ya definitivo)
            var pad = gen - (n % gen); if (n % gen == 0) pad = gen
            val total = trim + n + pad + trim
            val mpL = FloatArray(total); val mpR = FloatArray(total)
            System.arraycopy(left, 0, mpL, trim, n)
            System.arraycopy(right, 0, mpR, trim, n)
            // liberar los originales: la mezcla ya está en mpL/mpR (región [trim, trim+n])
            left = FloatArray(0); right = FloatArray(0); stereo[0] = left; stereo[1] = right
            val numChunks = (n + pad) / gen
            val instL = FloatArray(n + pad); val instR = FloatArray(n + pad)

            for (c in 0 until numChunks) {
                if (isCancelled()) throw InterruptedException("cancel")
                val off = c * gen
                // STFT de cada canal del bloque [chunk]
                val (reL, imL) = stftChunk(mpL, off)
                val (reR, imR) = stftChunk(mpR, off)

                // tensor [1,4,dim_f,dim_t] = [L_re, L_im, R_re, R_im]
                val inFloats = FloatArray(DIM_C * dimF * dimT)
                packInput(inFloats, reL, imL, reR, imR)

                val outFloats: FloatArray
                val buf = ByteBuffer.allocateDirect(inFloats.size * 4).order(ByteOrder.nativeOrder())
                buf.asFloatBuffer().put(inFloats)
                OnnxTensor.createTensor(env, buf.asFloatBuffer(), longArrayOf(1, DIM_C.toLong(), dimF.toLong(), dimT.toLong())).use { input ->
                    val res = session.run(mapOf(inName to input))
                    outFloats = flatten(res[0].value, DIM_C * dimF * dimT)
                    res.close()
                }

                // reconstruir espectros del instrumental (n_bins, rellenando con 0 los bins > dim_f)
                val oReL = FloatArray(dimT * nBins); val oImL = FloatArray(dimT * nBins)
                val oReR = FloatArray(dimT * nBins); val oImR = FloatArray(dimT * nBins)
                unpackOutput(outFloats, oReL, oImL, oReR, oImR)

                val chL = istftChunk(oReL, oImL)   // chunk muestras
                val chR = istftChunk(oReR, oImR)

                // quitar trim de cada borde -> gen muestras válidas
                for (k in 0 until gen) { instL[off + k] = chL[trim + k]; instR[off + k] = chR[trim + k] }

                onProgress(10 + (80 * (c + 1) / numChunks), "infer")
            }

            onProgress(92, "recon")
            var instFile: File? = null
            var voxFile: File? = null
            val baseNm = outDir.name   // = título saneado (la carpeta lleva el nombre de la canción)
            onProgress(95, "save")
            // "directo" = salida del modelo; "residual" = mezcla − salida.
            // Sin swap: instrumental=directo, voz=residual. Con swap: al revés
            // (para modelos que dan las pistas invertidas).
            val instFileT = File(outDir, "$baseNm (voz).wav")
            val voxFileT = File(outDir, "$baseNm (instrumental).wav")
            val residual = {
                val vL = FloatArray(n); val vR = FloatArray(n)
                for (s in 0 until n) { vL[s] = mpL[trim + s] - instL[s]; vR[s] = mpR[trim + s] - instR[s] }
                Pair(vL, vR)
            }
            if (wantInstrumental) {
                instFile = instFileT
                if (!swap) writeWavStereo(instFile, instL, instR, n)
                else { val (vL, vR) = residual(); writeWavStereo(instFile, vL, vR, n) }
            }
            if (wantVocals) {
                voxFile = voxFileT
                if (!swap) { val (vL, vR) = residual(); writeWavStereo(voxFile, vL, vR, n) }
                else writeWavStereo(voxFile, instL, instR, n)
            }
            onProgress(100, "save")
            return Result(instFile, voxFile)
        }
    }

    // ---------------------------------------------------------------- empaquetado

    private fun packInput(dst: FloatArray, reL: FloatArray, imL: FloatArray, reR: FloatArray, imR: FloatArray) {
        // dst[((c*dimF + bin)*dimT) + t]; re/im son frame-major [t*nBins + bin]
        for (bin in 0 until dimF) {
            val baseL0 = ((0 * dimF + bin) * dimT)
            val baseL1 = ((1 * dimF + bin) * dimT)
            val baseR0 = ((2 * dimF + bin) * dimT)
            val baseR1 = ((3 * dimF + bin) * dimT)
            for (t in 0 until dimT) {
                val sidx = t * nBins + bin
                dst[baseL0 + t] = reL[sidx]
                dst[baseL1 + t] = imL[sidx]
                dst[baseR0 + t] = reR[sidx]
                dst[baseR1 + t] = imR[sidx]
            }
        }
    }

    private fun unpackOutput(src: FloatArray, reL: FloatArray, imL: FloatArray, reR: FloatArray, imR: FloatArray) {
        for (bin in 0 until dimF) {
            val baseL0 = ((0 * dimF + bin) * dimT)
            val baseL1 = ((1 * dimF + bin) * dimT)
            val baseR0 = ((2 * dimF + bin) * dimT)
            val baseR1 = ((3 * dimF + bin) * dimT)
            for (t in 0 until dimT) {
                val didx = t * nBins + bin
                reL[didx] = src[baseL0 + t]
                imL[didx] = src[baseL1 + t]
                reR[didx] = src[baseR0 + t]
                imR[didx] = src[baseR1 + t]
            }
        }
        // bins dim_f..n_bins-1 quedan a 0 (ya inicializados)
    }

    private fun flatten(v: Any?, size: Int): FloatArray {
        val res = FloatArray(size)
        var k = 0
        fun rec(o: Any?) {
            when (o) {
                is FloatArray -> for (x in o) { if (k < size) res[k++] = x }
                is Array<*> -> for (e in o) rec(e)
            }
        }
        rec(v)
        return res
    }

    // ---------------------------------------------------------------- STFT/ISTFT centradas

    private fun hannPeriodic(n: Int): FloatArray {
        val w = FloatArray(n)
        for (i in 0 until n) w[i] = (0.5 - 0.5 * cos(2.0 * Math.PI * i / n)).toFloat()
        return w
    }

    /** STFT centrada (pad n_fft/2 con ceros) sobre el bloque de chunk muestras desde off. Devuelve re/im frame-major. */
    private fun stftChunk(src: FloatArray, off: Int): Pair<FloatArray, FloatArray> {
        val pad = nFft / 2
        val padded = FloatArray(chunk + 2 * pad)
        System.arraycopy(src, off, padded, pad, chunk)
        val re = FloatArray(dimT * nBins); val im = FloatArray(dimT * nBins)
        val buf = FloatArray(nFft)
        for (f in 0 until dimT) {
            val start = f * HOP
            for (i in 0 until nFft) buf[i] = padded[start + i] * window[i]
            fft.realForward(buf)
            re[f * nBins + 0] = buf[0]; im[f * nBins + 0] = 0f
            var b = 1
            while (b < nBins - 1) { re[f * nBins + b] = buf[2 * b]; im[f * nBins + b] = buf[2 * b + 1]; b++ }
            re[f * nBins + (nBins - 1)] = buf[1]; im[f * nBins + (nBins - 1)] = 0f
        }
        return Pair(re, im)
    }

    /** ISTFT centrada inversa de la anterior. Devuelve chunk muestras. */
    private fun istftChunk(re: FloatArray, im: FloatArray): FloatArray {
        val pad = nFft / 2
        val full = FloatArray(chunk + 2 * pad)
        val wsum = FloatArray(chunk + 2 * pad)
        val buf = FloatArray(nFft)
        for (f in 0 until dimT) {
            buf[0] = re[f * nBins + 0]
            buf[1] = re[f * nBins + (nBins - 1)]
            var b = 1
            while (b < nBins - 1) { buf[2 * b] = re[f * nBins + b]; buf[2 * b + 1] = im[f * nBins + b]; b++ }
            fft.realInverse(buf, true)
            val start = f * HOP
            for (i in 0 until nFft) { full[start + i] += buf[i] * window[i]; wsum[start + i] += window[i] * window[i] }
        }
        val out = FloatArray(chunk)
        for (i in 0 until chunk) { val j = i + pad; out[i] = if (wsum[j] > 1e-8f) full[j] / wsum[j] else 0f }
        return out
    }

    // ---------------------------------------------------------------- ONNX session

    /**
     * Acelera la inferencia. Para los modelos conv de MDX-Net, **XNNPACK suele ser
     * lo más rápido en móvil** (NNAPI a menudo parte el grafo y va más lento), así
     * que se prueba primero XNNPACK y, si falla, CPU normal. Todo multihilo.
     */
    private fun makeSession(env: OrtEnvironment, path: String): OrtSession {
        val cores = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
        // 1) XNNPACK (acelerador de CPU) + multihilo
        try {
            val o = OrtSession.SessionOptions()
            o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
            try { o.setMemoryPatternOptimization(true) } catch (e: Throwable) {}
            o.setIntraOpNumThreads(cores)
            o.addXnnpack(mapOf("intra_op_num_threads" to cores.toString()))
            return env.createSession(path, o)
        } catch (e: Throwable) {}
        // 2) CPU normal + multihilo (siempre funciona)
        val o = OrtSession.SessionOptions()
        try { o.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT) } catch (e: Throwable) {}
        try { o.setMemoryPatternOptimization(true) } catch (e: Throwable) {}
        try { o.setIntraOpNumThreads(cores) } catch (e: Throwable) {}
        return env.createSession(path, o)
    }


    // ---------------------------------------------------------------- decode

    private fun decodePcm(uri: Uri?, path: String?): Array<FloatArray>? {
        val extractor = MediaExtractor()
        var codec: MediaCodec? = null
        try {
            if (uri != null) extractor.setDataSource(ctx, uri, null)
            else if (path != null) extractor.setDataSource(path)
            else return null

            var track = -1; var format: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val fmt = extractor.getTrackFormat(i)
                if (fmt.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) { track = i; format = fmt; break }
            }
            if (track < 0 || format == null) return null
            extractor.selectTrack(track)

            val srcSr = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) format.getInteger(MediaFormat.KEY_SAMPLE_RATE) else SR
            val srcCh = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) format.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
            val mime = format.getString(MediaFormat.KEY_MIME)!!

            // pre-dimensionar con la duración (evita realojos y picos de memoria)
            val durUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
            val est = if (durUs > 0) ((durUs / 1_000_000.0) * srcSr).toInt() + srcSr else (1 shl 20)
            var bufL = FloatArray(est.coerceAtLeast(1024)); var lenL = 0
            var bufR = FloatArray(bufL.size); var lenR = 0

            codec = MediaCodec.createDecoderByType(mime)
            codec.configure(format, null, null, 0)
            codec.start()

            val info = MediaCodec.BufferInfo()
            var sawIn = false; var sawOut = false
            while (!sawOut) {
                if (isCancelled()) throw InterruptedException("cancel")
                if (!sawIn) {
                    val inIx = codec.dequeueInputBuffer(10000)
                    if (inIx >= 0) {
                        val inBuf = codec.getInputBuffer(inIx)!!
                        val sz = extractor.readSampleData(inBuf, 0)
                        if (sz < 0) { codec.queueInputBuffer(inIx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); sawIn = true }
                        else { codec.queueInputBuffer(inIx, 0, sz, extractor.sampleTime, 0); extractor.advance() }
                    }
                }
                val outIx = codec.dequeueOutputBuffer(info, 10000)
                if (outIx >= 0) {
                    val outBuf = codec.getOutputBuffer(outIx)!!
                    val sb: ShortBuffer = outBuf.order(ByteOrder.nativeOrder()).asShortBuffer()
                    val count = info.size / 2
                    var i = 0
                    while (i < count) {
                        if (srcCh >= 2) {
                            if (lenL >= bufL.size) bufL = bufL.copyOf(bufL.size + bufL.size / 2)
                            bufL[lenL++] = sb.get(i) / 32768f
                            if (lenR >= bufR.size) bufR = bufR.copyOf(bufR.size + bufR.size / 2)
                            bufR[lenR++] = sb.get(i + 1) / 32768f
                            i += 2
                        } else {
                            val s = sb.get(i) / 32768f
                            if (lenL >= bufL.size) bufL = bufL.copyOf(bufL.size + bufL.size / 2)
                            bufL[lenL++] = s
                            if (lenR >= bufR.size) bufR = bufR.copyOf(bufR.size + bufR.size / 2)
                            bufR[lenR++] = s
                            i += 1
                        }
                    }
                    codec.releaseOutputBuffer(outIx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOut = true
                }
            }

            var l = if (lenL == bufL.size) bufL else bufL.copyOf(lenL); bufL = FloatArray(0)
            var r = if (lenR == bufR.size) bufR else bufR.copyOf(lenR); bufR = FloatArray(0)
            if (srcSr != SR) { l = resampleLinear(l, srcSr, SR); r = resampleLinear(r, srcSr, SR) }
            return arrayOf(l, r)
        } catch (e: InterruptedException) {
            throw e
        } catch (e: Exception) {
            return null
        } finally {
            try { codec?.stop() } catch (_: Exception) {}
            try { codec?.release() } catch (_: Exception) {}
            try { extractor.release() } catch (_: Exception) {}
        }
    }


    private fun resampleLinear(x: FloatArray, from: Int, to: Int): FloatArray {
        if (from == to || x.isEmpty()) return x
        val ratio = to.toDouble() / from
        val outLen = (x.size * ratio).toInt()
        val out = FloatArray(outLen)
        for (i in 0 until outLen) {
            val src = i / ratio; val i0 = src.toInt(); val frac = (src - i0).toFloat()
            val a = x[i0.coerceIn(0, x.size - 1)]; val b = x[(i0 + 1).coerceIn(0, x.size - 1)]
            out[i] = a + (b - a) * frac
        }
        return out
    }

    // ---------------------------------------------------------------- WAV

    private fun writeWavStereo(file: File, l: FloatArray, r: FloatArray, count: Int = -1) {
        file.parentFile?.mkdirs()
        val n = if (count >= 0) min(count, min(l.size, r.size)) else min(l.size, r.size)
        val dataLen = n * 2 * 2
        FileOutputStream(file).use { fos ->
            fos.write(wavHeader(dataLen, SR, 2, 16))
            val buf = ByteBuffer.allocate(4096).order(ByteOrder.LITTLE_ENDIAN)
            var i = 0
            while (i < n) {
                buf.clear(); var j = 0
                while (j < 1024 && i < n) {
                    buf.putShort((l[i].coerceIn(-1f, 1f) * 32767f).toInt().toShort())
                    buf.putShort((r[i].coerceIn(-1f, 1f) * 32767f).toInt().toShort())
                    i++; j++
                }
                fos.write(buf.array(), 0, buf.position())
            }
        }
    }

    private fun wavHeader(dataLen: Int, sr: Int, ch: Int, bits: Int): ByteArray {
        val byteRate = sr * ch * bits / 8; val blockAlign = ch * bits / 8; val totalLen = dataLen + 36
        val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        h.put("RIFF".toByteArray()); h.putInt(totalLen); h.put("WAVE".toByteArray())
        h.put("fmt ".toByteArray()); h.putInt(16); h.putShort(1); h.putShort(ch.toShort())
        h.putInt(sr); h.putInt(byteRate); h.putShort(blockAlign.toShort()); h.putShort(bits.toShort())
        h.put("data".toByteArray()); h.putInt(dataLen)
        return h.array()
    }
}
