/* =============================================================================
   DSK•LoFi — encoder.js
   Local audio encoders. WAV (16-bit PCM) is built in — zero dependencies.
   MP3 is OPTIONAL: drop a local copy of lamejs as  libs/lame.min.js  and the
   app detects it automatically (no CDN is ever used). If absent, the format
   selector hides MP3 and exports fall back to WAV.
   ========================================================================== */
(function () {
  "use strict";

  function interleave(buffer) {
    const chs = Math.min(buffer.numberOfChannels, 2);
    const len = buffer.length;
    if (chs === 1) return [buffer.getChannelData(0), null];
    return [buffer.getChannelData(0), buffer.getChannelData(1)];
  }

  function to16(v) {
    const s = Math.max(-1, Math.min(1, v));
    return s < 0 ? s * 0x8000 : s * 0x7FFF;
  }

  /* ---------------- WAV ---------------- */
  function encodeWav(buffer) {
    const chs = Math.min(buffer.numberOfChannels, 2);
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const bytes = 44 + len * chs * 2;
    const ab = new ArrayBuffer(bytes);
    const dv = new DataView(ab);
    let o = 0;
    const wStr = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
    const w32 = (v) => { dv.setUint32(o, v, true); o += 4; };
    const w16 = (v) => { dv.setUint16(o, v, true); o += 2; };

    wStr("RIFF"); w32(bytes - 8); wStr("WAVE");
    wStr("fmt "); w32(16); w16(1); w16(chs); w32(sr);
    w32(sr * chs * 2); w16(chs * 2); w16(16);
    wStr("data"); w32(len * chs * 2);

    const [L, R] = interleave(buffer);
    for (let i = 0; i < len; i++) {
      dv.setInt16(o, to16(L[i]), true); o += 2;
      if (chs === 2) { dv.setInt16(o, to16(R ? R[i] : L[i]), true); o += 2; }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  /* ---------------- optional MP3 (lamejs drop-in) ---------------- */
  let mp3Ready = false;

  async function probeMp3() {
    if (window.lamejs) { mp3Ready = true; return true; }
    try {
      const res = await fetch("libs/lame.min.js", { method: "HEAD" });
      if (!res.ok) return false;
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "libs/lame.min.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      mp3Ready = !!window.lamejs;
      return mp3Ready;
    } catch (e) {
      return false;
    }
  }

  async function encodeMp3(buffer, kbps, onProgress, shouldAbort) {
    if (!window.lamejs) throw new Error("lamejs not loaded");
    const chs = Math.min(buffer.numberOfChannels, 2);
    const sr = buffer.sampleRate;
    const enc = new lamejs.Mp3Encoder(chs, sr, kbps || 128);
    const [Lf, Rf] = interleave(buffer);
    const len = buffer.length;
    const block = 1152 * 8;
    const L = new Int16Array(block), R = new Int16Array(block);
    const out = [];
    // procesar en lotes y ceder el hilo cada ~40ms para que la UI repinte
    let lastYield = performance.now();
    for (let i = 0; i < len; i += block) {
      const n = Math.min(block, len - i);
      for (let j = 0; j < n; j++) {
        L[j] = to16(Lf[i + j]);
        if (chs === 2) R[j] = to16(Rf ? Rf[i + j] : Lf[i + j]);
      }
      const chunk = chs === 2
        ? enc.encodeBuffer(L.subarray(0, n), R.subarray(0, n))
        : enc.encodeBuffer(L.subarray(0, n));
      if (chunk.length) out.push(new Uint8Array(chunk));
      if (onProgress) onProgress(i / len);
      // ceder el hilo solo lo justo para repintar la barra (sin frenar el encode)
      const now = performance.now();
      if (now - lastYield > 120) {
        lastYield = now;
        await new Promise((r) => setTimeout(r, 0));
        if (shouldAbort && shouldAbort()) throw new Error("__cancel__");
      }
    }
    const end = enc.flush();
    if (end.length) out.push(new Uint8Array(end));
    if (onProgress) onProgress(1);
    return new Blob(out, { type: "audio/mpeg" });
  }

  window.Encoder = {
    wav: encodeWav,
    mp3: encodeMp3,
    probeMp3,
    get mp3Ready() { return mp3Ready; },
    id3v2: buildId3v2,
    wrapMp3WithTag: wrapMp3WithTag
  };

  /* ---------------- ID3v2.3 tag con carátula (APIC) ---------------- */
  // Codifica un entero de 32 bits como "synchsafe" (7 bits por byte) — tamaño del tag.
  function synchsafe(n) {
    return [(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f];
  }
  // Texto ISO-8859-1 (Latin-1); fuera de rango → '?'. Suficiente para TIT2/TPE1.
  function latin1Bytes(str) {
    const s = String(str == null ? "" : str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[i] = c < 256 ? c : 0x3f; }
    return out;
  }
  // Frame de texto (TIT2, TPE1...): encoding byte 0x00 (Latin-1) + texto.
  function textFrame(id, text) {
    const body = latin1Bytes(text);
    const frame = new Uint8Array(10 + 1 + body.length);
    for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i);
    const size = 1 + body.length;                 // ID3v2.3: tamaño NO synchsafe
    frame[4] = (size >> 24) & 0xff; frame[5] = (size >> 16) & 0xff;
    frame[6] = (size >> 8) & 0xff;  frame[7] = size & 0xff;
    frame[8] = 0; frame[9] = 0;                    // flags
    frame[10] = 0x00;                              // encoding Latin-1
    frame.set(body, 11);
    return frame;
  }
  // Frame APIC con la imagen (jpeg/png). picBytes: Uint8Array.
  function apicFrame(picBytes, mime) {
    const mimeB = latin1Bytes(mime || "image/jpeg");
    // body: enc(1) + mime + 0x00 + picType(1) + desc(0x00) + data
    const bodyLen = 1 + mimeB.length + 1 + 1 + 1 + picBytes.length;
    const body = new Uint8Array(bodyLen);
    let p = 0;
    body[p++] = 0x00;                              // text encoding Latin-1
    body.set(mimeB, p); p += mimeB.length;
    body[p++] = 0x00;                              // fin de mime
    body[p++] = 0x03;                              // picture type: 3 = cover (front)
    body[p++] = 0x00;                              // descripción vacía
    body.set(picBytes, p);

    const frame = new Uint8Array(10 + body.length);
    const id = "APIC";
    for (let i = 0; i < 4; i++) frame[i] = id.charCodeAt(i);
    const size = body.length;
    frame[4] = (size >> 24) & 0xff; frame[5] = (size >> 16) & 0xff;
    frame[6] = (size >> 8) & 0xff;  frame[7] = size & 0xff;
    frame[8] = 0; frame[9] = 0;
    frame.set(body, 10);
    return frame;
  }
  // Construye un tag ID3v2.3 completo. meta: { title, artist, coverBytes, coverMime }
  function buildId3v2(meta) {
    const m = meta || {};
    const frames = [];
    if (m.title)  frames.push(textFrame("TIT2", m.title));
    if (m.artist) frames.push(textFrame("TPE1", m.artist));
    if (m.coverBytes && m.coverBytes.length) frames.push(apicFrame(m.coverBytes, m.coverMime));
    if (!frames.length) return null;

    let total = 0; frames.forEach((f) => total += f.length);
    const header = new Uint8Array(10);
    header[0] = 0x49; header[1] = 0x44; header[2] = 0x33; // "ID3"
    header[3] = 0x03; header[4] = 0x00;                   // versión 2.3.0
    header[5] = 0x00;                                     // flags
    const ss = synchsafe(total);
    header[6] = ss[0]; header[7] = ss[1]; header[8] = ss[2]; header[9] = ss[3];

    const tag = new Uint8Array(10 + total);
    tag.set(header, 0);
    let off = 10;
    frames.forEach((f) => { tag.set(f, off); off += f.length; });
    return tag;
  }
  // Antepone el tag ID3v2 al blob MP3. coverB64: base64 SIN prefijo (o "").
  function wrapMp3WithTag(mp3Blob, meta) {
    return mp3Blob.arrayBuffer().then((ab) => {
      const tag = buildId3v2(meta);
      if (!tag) return mp3Blob;
      return new Blob([tag, ab], { type: "audio/mpeg" });
    });
  }
})();