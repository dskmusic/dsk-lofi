package com.dskmusic.dsklofi

import org.jaudiotagger.audio.AudioFileIO
import org.jaudiotagger.tag.FieldKey
import org.jaudiotagger.tag.images.AndroidArtwork
import java.io.File
import java.util.logging.Level
import java.util.logging.Logger

/**
 * DSK•LoFi — TagWriter
 *
 * Incrusta metadatos (título, artista/canal y CARÁTULA) dentro del archivo de
 * audio usando jaudiotagger. Se aplica sobre el .m4a temporal (contenedor MP4 →
 * atom "covr") ANTES de guardarlo como .mp3, porque jaudiotagger elige el
 * formato por la extensión.
 *
 * Todo es "best-effort": si algo falla, el archivo se guarda igual sin tag.
 */
object TagWriter {

    init {
        try { Logger.getLogger("org.jaudiotagger").level = Level.OFF } catch (e: Throwable) {}
    }

    fun write(file: File, title: String?, artist: String?, cover: ByteArray?) {
        try {
            val af = AudioFileIO.read(file)
            val tag = af.tagOrCreateAndSetDefault
            if (!title.isNullOrBlank()) tag.setField(FieldKey.TITLE, title)
            if (!artist.isNullOrBlank()) tag.setField(FieldKey.ARTIST, artist)
            if (cover != null && cover.isNotEmpty()) {
                val art = AndroidArtwork()
                art.binaryData = cover
                art.mimeType = "image/jpeg"
                try { tag.deleteArtworkField() } catch (e: Exception) {}
                tag.setField(art)
            }
            af.commit()
        } catch (e: Throwable) {
            // best-effort: se guarda sin tag
        }
    }
}
