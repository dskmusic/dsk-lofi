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
    get mp3Ready() { return mp3Ready; }
  };
})();