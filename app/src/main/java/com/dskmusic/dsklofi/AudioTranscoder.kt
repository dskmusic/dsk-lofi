package com.dskmusic.dsklofi

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import java.io.File
import java.nio.ByteBuffer

/**
 * DSK•LoFi — AudioTranscoder
 *
 * Transcodifica un archivo de audio (p. ej. webm/opus de YouTube) a M4A (AAC-LC
 * 128 kbps) usando MediaCodec por hardware. Se usa solo cuando NO hay un stream
 * m4a directo (lo normal en música sí lo hay, y se guarda sin transcodificar).
 *
 * Devuelve true si fue OK. onProgress recibe 0..1 según la marca temporal.
 */
object AudioTranscoder {

    fun transcodeToM4a(inputPath: String, outFile: File, onProgress: (Float) -> Unit): Boolean {
        var extractor: MediaExtractor? = null
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var muxer: MediaMuxer? = null
        try {
            extractor = MediaExtractor()
            extractor.setDataSource(inputPath)

            var audioTrack = -1
            var inFormat: MediaFormat? = null
            for (i in 0 until extractor.trackCount) {
                val f = extractor.getTrackFormat(i)
                val mime = f.getString(MediaFormat.KEY_MIME) ?: ""
                if (mime.startsWith("audio/")) { audioTrack = i; inFormat = f; break }
            }
            if (audioTrack < 0 || inFormat == null) return false
            extractor.selectTrack(audioTrack)

            val inMime = inFormat.getString(MediaFormat.KEY_MIME) ?: return false
            val sampleRate = if (inFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 44100
            val channels = if (inFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 2
            val durationUs = if (inFormat.containsKey(MediaFormat.KEY_DURATION)) inFormat.getLong(MediaFormat.KEY_DURATION) else 0L

            decoder = MediaCodec.createDecoderByType(inMime)
            decoder.configure(inFormat, null, null, 0)
            decoder.start()

            val outMime = MediaFormat.MIMETYPE_AUDIO_AAC
            val outFormat = MediaFormat.createAudioFormat(outMime, sampleRate, channels).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, 128000)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 256 * 1024)
            }
            encoder = MediaCodec.createEncoderByType(outMime)
            encoder.configure(outFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()

            muxer = MediaMuxer(outFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            var muxerTrack = -1
            var muxerStarted = false

            val timeoutUs = 10000L
            val info = MediaCodec.BufferInfo()

            var extractorDone = false
            var encoderDone = false
            var pending: ByteBuffer? = null
            var pendingPts = 0L
            var pendingEos = false

            while (!encoderDone) {
                // 1) extractor → decoder
                if (!extractorDone) {
                    val inIdx = decoder.dequeueInputBuffer(timeoutUs)
                    if (inIdx >= 0) {
                        val inBuf = decoder.getInputBuffer(inIdx)!!
                        val sz = extractor.readSampleData(inBuf, 0)
                        if (sz < 0) {
                            decoder.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            extractorDone = true
                        } else {
                            decoder.queueInputBuffer(inIdx, 0, sz, extractor.sampleTime, 0)
                            extractor.advance()
                        }
                    }
                }

                // 2) decoder → (PCM) → encoder
                if (pending == null && !pendingEos) {
                    val outIdx = decoder.dequeueOutputBuffer(info, timeoutUs)
                    if (outIdx >= 0) {
                        val outBuf = decoder.getOutputBuffer(outIdx)
                        if (info.size > 0 && outBuf != null) {
                            outBuf.position(info.offset)
                            outBuf.limit(info.offset + info.size)
                            val copy = ByteBuffer.allocate(info.size)
                            copy.put(outBuf); copy.flip()
                            pending = copy; pendingPts = info.presentationTimeUs
                        }
                        if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) pendingEos = true
                        decoder.releaseOutputBuffer(outIdx, false)
                    }
                }

                if (pending != null || pendingEos) {
                    val encInIdx = encoder.dequeueInputBuffer(timeoutUs)
                    if (encInIdx >= 0) {
                        val encIn = encoder.getInputBuffer(encInIdx)!!
                        encIn.clear()
                        if (pending != null) {
                            encIn.put(pending)
                            encoder.queueInputBuffer(encInIdx, 0, pending!!.limit(), pendingPts, 0)
                            pending = null
                        } else {
                            encoder.queueInputBuffer(encInIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            pendingEos = false
                        }
                    }
                }

                // 3) encoder → muxer
                val encOutIdx = encoder.dequeueOutputBuffer(info, timeoutUs)
                if (encOutIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    muxerTrack = muxer.addTrack(encoder.outputFormat)
                    muxer.start(); muxerStarted = true
                } else if (encOutIdx >= 0) {
                    val encOut = encoder.getOutputBuffer(encOutIdx)
                    if ((info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0) info.size = 0
                    if (info.size > 0 && muxerStarted && encOut != null) {
                        encOut.position(info.offset)
                        encOut.limit(info.offset + info.size)
                        muxer.writeSampleData(muxerTrack, encOut, info)
                        if (durationUs > 0) {
                            val f = (info.presentationTimeUs.toFloat() / durationUs)
                            onProgress(if (f < 0f) 0f else if (f > 1f) 1f else f)
                        }
                    }
                    if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) encoderDone = true
                    encoder.releaseOutputBuffer(encOutIdx, false)
                }
            }
            onProgress(1f)
            return true
        } catch (e: Throwable) {
            return false
        } finally {
            try { decoder?.stop(); decoder?.release() } catch (e: Exception) {}
            try { encoder?.stop(); encoder?.release() } catch (e: Exception) {}
            try { muxer?.stop(); muxer?.release() } catch (e: Exception) {}
            try { extractor?.release() } catch (e: Exception) {}
        }
    }
}
