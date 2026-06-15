/* =============================================================================
   DSK•LoFi — engine.js
   Web Audio engine. One chain-builder used for BOTH live preview and the
   OfflineAudioContext export render, so what you hear is what you save.

   Chain:  source → [LOFI] → [CHORUS] → [DELAY] → [REVERB] → volume → analyser
   Each FX section has a dry/wet structure so it can be toggled without
   rebuilding the graph.
   ========================================================================== */
(function () {
  "use strict";

  const WORKLET_URL = "js/lofi-worklet.js";

  // Karaoke: cancelación del canal central SOLO en la banda de la voz
  // (~150 Hz–7 kHz). Así el grave (bombo/bajo, centrados) y los agudos se
  // conservan → suena con cuerpo y la voz se va mucho mejor que restando el
  // centro a banda completa. amount=1 cancela del todo dentro de la banda.
  const KARAOKE_AMOUNT = 1.0;

  /* =========================================================================
     buildKaraoke(ctx) → reductor de voz por cancelación de centro band-limited.
       center = 0.5·(L+R)  →  paso-banda (HP 150 / LP 7000)  →  se resta a L y R.
       Fuera de esa banda L y R pasan intactos. a=0 → passthrough.
     ====================================================================== */
  function buildKaraoke(ctx) {
    const input  = ctx.createGain();
    const output = ctx.createGain();
    const split  = ctx.createChannelSplitter(2);
    const merge  = ctx.createChannelMerger(2);

    // center = (L+R) · 0.5  → paso-banda vocal
    const center = ctx.createGain(); center.gain.value = 0.5;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 150; hp.Q.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass";  lp.frequency.value = 7000; lp.Q.value = 0.5;
    const sub = ctx.createGain(); sub.gain.value = 0;          // −amount (0 = off)

    input.connect(split);
    // L y R directos a la salida
    split.connect(merge, 0, 0);
    split.connect(merge, 1, 1);
    // center filtrado, restado a ambos canales
    split.connect(center, 0);
    split.connect(center, 1);
    center.connect(hp).connect(lp).connect(sub);
    sub.connect(merge, 0, 0);
    sub.connect(merge, 0, 1);
    merge.connect(output);

    function setAmount(a) {
      a = Math.max(0, Math.min(1, a));
      sub.gain.setTargetAtTime(-a, ctx.currentTime, 0.02);
    }
    setAmount(0);
    return { input, output, setAmount };
  }

  /* ---------------- defaults (normalized 0..1 unless noted) -------------- */
  const DEFAULTS = {
    lofi:   { on: true,  tone: 0.52, crush: 0.30, hiss: 0.22, crackle: 0.30, wow: 0.28 },
    reverb: { on: true,  mix: 0.22, size: 0.45, damp: 0.55 },
    delay:  { on: false, time: 0.30, fb: 0.35, mix: 0.25 },
    chorus: { on: false, rate: 0.25, depth: 0.40, mix: 0.40 },
    output: { volume: 1.0 }
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------------- mapping helpers ---------------- */
  const map = {
    toneHz:   (v) => 700 * Math.pow(20000 / 700, Math.min(v, 1)),
    bits:     (v) => 16 - v * 12,
    srFactor: (v) => 1 + v * v * 28,
    wowDepth: (v) => v * 0.0035,
    flutDepth:(v) => v * 0.0007,
    rvSecs:   (v) => 0.5 + v * 4.5,
    rvDampHz: (v) => 16000 - v * 13200,
    dlTime:   (v) => 0.06 + v * 0.84,
    dlFb:     (v) => Math.min(v * 0.85, 0.9),
    chRateHz: (v) => 0.15 + v * 4.0,
    chDepth:  (v) => v * 0.0045
  };

  function makeIR(ctx, seconds, sampleRate) {
    const rate = sampleRate || ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const ir = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * (1 - 0.3 * Math.random());
      }
    }
    return ir;
  }

  /* =========================================================================
     buildChain(ctx, workletOK) → node graph + param applicator
     ====================================================================== */
  function buildChain(ctx, workletOK) {
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v == null ? 1 : v; return n; };

    const input = g(1);

    /* ---------------- LOFI section ---------------- */
    const lf = { in: g(1), out: g(1), dry: g(0), wet: g(1) };
    lf.hp = ctx.createBiquadFilter(); lf.hp.type = "highpass"; lf.hp.frequency.value = 28;
    lf.wow = ctx.createDelay(0.1); lf.wow.delayTime.value = 0.02;
    lf.wowOsc = ctx.createOscillator(); lf.wowOsc.frequency.value = 0.45;
    lf.wowAmt = g(0);
    lf.flutOsc = ctx.createOscillator(); lf.flutOsc.frequency.value = 6.3;
    lf.flutAmt = g(0);
    lf.wowOsc.connect(lf.wowAmt).connect(lf.wow.delayTime);
    lf.flutOsc.connect(lf.flutAmt).connect(lf.wow.delayTime);
    lf.wowOsc.start(0); lf.flutOsc.start(0);

    if (workletOK) {
      lf.crush = new AudioWorkletNode(ctx, "dsk-lofi", { outputChannelCount: [2] });
    } else {
      lf.crush = null;
      lf.crushBypass = g(1);
    }
    lf.lp = ctx.createBiquadFilter(); lf.lp.type = "lowpass"; lf.lp.Q.value = 0.8;
    lf.lp.frequency.value = map.toneHz(DEFAULTS.lofi.tone);

    lf.in.connect(lf.dry).connect(lf.out);
    let head = lf.in.connect(lf.hp).connect(lf.wow);
    head = lf.crush ? head.connect(lf.crush) : head.connect(lf.crushBypass);
    head.connect(lf.lp).connect(lf.wet).connect(lf.out);

    /* ---------------- CHORUS section ---------------- */
    const ch = { in: g(1), out: g(1), dry: g(1), wet: g(0) };
    ch.v1 = ctx.createDelay(0.06); ch.v1.delayTime.value = 0.013;
    ch.v2 = ctx.createDelay(0.06); ch.v2.delayTime.value = 0.021;
    ch.lfo = ctx.createOscillator(); ch.lfo.frequency.value = map.chRateHz(DEFAULTS.chorus.rate);
    ch.amt1 = g(0); ch.amt2 = g(0);
    ch.lfo.connect(ch.amt1).connect(ch.v1.delayTime);
    ch.lfo.connect(ch.amt2).connect(ch.v2.delayTime);
    ch.lfo.start(0);
    ch.in.connect(ch.dry).connect(ch.out);
    ch.in.connect(ch.v1).connect(ch.wet);
    ch.in.connect(ch.v2).connect(ch.wet);
    ch.wet.connect(ch.out);

    /* ---------------- DELAY section ---------------- */
    const dl = { in: g(1), out: g(1), dry: g(1), wet: g(0) };
    dl.dly = ctx.createDelay(1.2); dl.dly.delayTime.value = map.dlTime(DEFAULTS.delay.time);
    dl.fb = g(0);
    dl.fbLP = ctx.createBiquadFilter(); dl.fbLP.type = "lowpass"; dl.fbLP.frequency.value = 2600;
    dl.in.connect(dl.dry).connect(dl.out);
    dl.in.connect(dl.dly);
    dl.dly.connect(dl.fbLP).connect(dl.fb).connect(dl.dly);
    dl.dly.connect(dl.wet).connect(dl.out);

    /* ---------------- REVERB section ---------------- */
    const rv = { in: g(1), out: g(1), dry: g(1), wet: g(0) };
    rv.conv = ctx.createConvolver();
    rv.conv.buffer = makeIR(ctx, map.rvSecs(DEFAULTS.reverb.size));
    rv.damp = ctx.createBiquadFilter(); rv.damp.type = "lowpass";
    rv.damp.frequency.value = map.rvDampHz(DEFAULTS.reverb.damp);
    rv.in.connect(rv.dry).connect(rv.out);
    rv.in.connect(rv.conv).connect(rv.damp).connect(rv.wet).connect(rv.out);

    /* ---------------- master / monitor ---------------- */
    const procMon = g(1);   // processed monitor (A/B)
    const dryMon = g(0);    // original monitor (A/B)
    const volume = g(DEFAULTS.output.volume);

    input.connect(lf.in);
    lf.out.connect(ch.in);
    ch.out.connect(dl.in);
    dl.out.connect(rv.in);
    rv.out.connect(procMon).connect(volume);
    input.connect(dryMon).connect(volume);

    const chain = { ctx, input, volume, procMon, dryMon, lf, ch, dl, rv, workletOK };
    chain._playGate = false;  // hiss/crackle gate (false hasta que se reproduzca)

    /* ------- param application (live: smoothed / offline: immediate) ----- */
    chain.apply = function (params, immediate) {
      const t = ctx.currentTime;
      const set = (ap, v) => {
        if (immediate) { ap.value = v; }
        else { ap.setTargetAtTime(v, t, 0.035); }
      };
      const p = params;

      /* lofi */
      set(lf.dry.gain, p.lofi.on ? 0 : 1);
      set(lf.wet.gain, p.lofi.on ? 1 : 0);
      set(lf.lp.frequency, map.toneHz(p.lofi.tone));
      set(lf.wowAmt.gain, map.wowDepth(p.lofi.wow));
      set(lf.flutAmt.gain, map.flutDepth(p.lofi.wow));
      if (lf.crush) {
        const live = chain._playGate;  // hiss/crackle solo suenan al reproducir
        lf.crush.parameters.get("bits").value = map.bits(p.lofi.crush);
        lf.crush.parameters.get("srFactor").value = map.srFactor(p.lofi.crush);
        lf.crush.parameters.get("hiss").value = (p.lofi.on && live) ? p.lofi.hiss : 0;
        lf.crush.parameters.get("crackle").value = (p.lofi.on && live) ? p.lofi.crackle : 0;
      }

      /* chorus */
      set(ch.wet.gain, p.chorus.on ? p.chorus.mix * 0.7 : 0);
      set(ch.lfo.frequency, map.chRateHz(p.chorus.rate));
      set(ch.amt1.gain, map.chDepth(p.chorus.depth));
      set(ch.amt2.gain, -map.chDepth(p.chorus.depth) * 0.8);

      /* delay */
      set(dl.wet.gain, p.delay.on ? p.delay.mix : 0);
      set(dl.dly.delayTime, map.dlTime(p.delay.time));
      set(dl.fb.gain, p.delay.on ? map.dlFb(p.delay.fb) : 0);

      /* reverb (IR regen handled by caller via chain.setIR) */
      set(rv.wet.gain, p.reverb.on ? p.reverb.mix * 1.35 : 0);
      set(rv.damp.frequency, map.rvDampHz(p.reverb.damp));

      /* output */
      set(volume.gain, p.output.volume);
    };

    chain.setIR = function (sizeV) {
      rv.conv.buffer = makeIR(ctx, map.rvSecs(sizeV));
    };

    // gate de reproducción: corta hiss/crackle (ruido propio del worklet)
    // cuando no se está reproduciendo, para que no se oiga en silencio.
    chain.setPlaying = function (on) {
      chain._playGate = !!on;
      if (lf.crush) {
        const p = Engine.params;
        lf.crush.parameters.get("hiss").value = (p.lofi.on && on) ? p.lofi.hiss : 0;
        lf.crush.parameters.get("crackle").value = (p.lofi.on && on) ? p.lofi.crackle : 0;
      }
    };

    // corta de golpe las colas de reverb y delay (al hacer Stop)
    chain.flushTails = function () {
      try {
        // reverb: reemplazar el buffer del convolver vacía su cola
        const sz = Engine.params.reverb.size;
        rv.conv.buffer = makeIR(ctx, map.rvSecs(sz));
      } catch (e) {}
      try {
        // delay: cortar el feedback un instante para vaciar el bucle
        const t = ctx.currentTime;
        const fbVal = dl.fb.gain.value;
        dl.fb.gain.cancelScheduledValues(t);
        dl.fb.gain.setValueAtTime(0, t);
        dl.fb.gain.setValueAtTime(fbVal, t + 0.06);
      } catch (e) {}
    };

    return chain;
  }

  /* =========================================================================
     Engine singleton
     ====================================================================== */
  const Engine = {
    ctx: null,
    chain: null,
    analyser: null,
    workletOK: false,
    params: clone(DEFAULTS),
    buffer: null,
    fileName: null,

    _src: null,
    _playing: false,
    _offset: 0,
    _startedAt: 0,
    _loop: false,
    _irTimer: null,
    tapeLive: false,
    speed: 1.0,

    // ---- auto-ganancia / normalización por pista ----
    normGain: null,
    normEnabled: false,
    normLevel: "normal",
    _lastRMS: 1,
    _ka: null,   // keep-alive source

    // ---- modo "solo reproductor": usa <audio> nativo (instantáneo, sin FX) ----
    nativeMode: false,
    _audio: null,        // elemento <audio>
    _audioSrc: null,     // MediaElementAudioSourceNode (para el visualizador)
    _nativeUrl: null,    // object URL actual (para revocar)

    get DEFAULTS() { return clone(DEFAULTS); },

    async init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: "interactive" });
      try {
        await this.ctx.audioWorklet.addModule(WORKLET_URL);
        this.workletOK = true;
      } catch (e) {
        console.warn("AudioWorklet unavailable — crush/hiss/crackle degrade gracefully", e);
        this.workletOK = false;
      }
      this.chain = buildChain(this.ctx, this.workletOK);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.82;
      // nodo de auto-ganancia en la salida (afecta a ambos modos)
      this.normGain = this.ctx.createGain();
      this.normGain.gain.value = 1;
      // nodo de karaoke (reduce la voz centrada) en la salida final
      this.karaoke = buildKaraoke(this.ctx);
      this.normGain.connect(this.karaoke.input);
      // nodo de fade dedicado al "fin de pista" (sleep timer): no se toca
      // desde ningún otro sitio, así no interfiere con normalización/karaoke.
      this.fadeGain = this.ctx.createGain();
      this.fadeGain.gain.value = 1;
      this.karaoke.output.connect(this.fadeGain);
      this.fadeGain.connect(this.ctx.destination);
      this.karaoke.setAmount(this.karaokeOn ? KARAOKE_AMOUNT : 0);
      this.chain.volume.connect(this.analyser).connect(this.normGain);
      this.chain.setIR(this.params.reverb.size);
      this.chain.apply(this.params, true);
      this._rampNorm();
      this._startKeepAlive();
    },

    async resume() {
      if (this.ctx && this.ctx.state !== "running") {
        try { await this.ctx.resume(); } catch (e) { /* gesture needed */ }
      }
      this._startKeepAlive();
    },

    // Karaoke: atenúa la voz (canal central). best-effort; mejor en estéreo.
    setKaraoke(on) {
      this.karaokeOn = !!on;
      if (this.karaoke) this.karaoke.setAmount(this.karaokeOn ? KARAOKE_AMOUNT : 0);
      try { document.dispatchEvent(new CustomEvent("dsk:karaoke", { detail: this.karaokeOn })); } catch (e) {}
      return this.karaokeOn;
    },

    // keep-alive: señal inaudible real conectada DIRECTAMENTE a destination
    // (no pasa por normGain). Mantiene el AudioContext y la sesión de audio del
    // proceso vivos en segundo plano SIN crear un MediaElement que secuestre la
    // sesión multimedia (eso rompía el play/pausa de la notificación).
    _startKeepAlive() {
      if (this._ka || !this.ctx) return;
      try {
        const sr = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, sr, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;  // ruido
        const src = this.ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const g = this.ctx.createGain();
        g.gain.value = 0.0001;   // ~-80 dBFS: inaudible pero señal real
        src.connect(g).connect(this.ctx.destination);
        src.start(0);
        this._ka = src;
      } catch (e) {}
    },

    /* ---- auto-ganancia: medición y aplicación ---- */
    measureRMS(buffer) {
      try {
        if (!buffer || !buffer.length) return 1;
        const ch0 = buffer.getChannelData(0);
        const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
        const n = ch0.length;
        const step = Math.max(1, Math.floor(n / 80000));  // submuestreo: ~80k muestras máx
        let sum = 0, cnt = 0;
        for (let i = 0; i < n; i += step) {
          let s = ch0[i];
          if (ch1) s = (s + ch1[i]) * 0.5;
          sum += s * s; cnt++;
        }
        const rms = Math.sqrt(sum / Math.max(1, cnt));
        return rms > 1e-5 ? rms : 1;
      } catch (e) { return 1; }
    },

    _targetRMS() {
      return this.normLevel === "soft" ? 0.06
           : this.normLevel === "loud" ? 0.14
           : 0.095;
    },

    // fija la ganancia a aplicar a la pista actual a partir de su RMS medido
    applyTrackGain(rms) {
      this._lastRMS = (rms && rms > 1e-5) ? rms : 1;
      this._rampNorm();
    },

    // enciende/apaga o cambia el nivel; reaplica con el último RMS conocido
    setNorm(enabled, level) {
      this.normEnabled = !!enabled;
      if (level) this.normLevel = level;
      this._rampNorm();
    },

    // Fade dedicado para el "fin de pista" del sleep timer (0..1). No afecta
    // a normalización ni karaoke; funciona igual en modo nativo y normal.
    // `secsLeft`: si se indica y es pequeño, programa una rampa lineal que
    // llega EXACTAMENTE a 0 en ese tiempo (evita el corte brusco final que
    // dejaría setTargetAtTime, que es asintótico y nunca llega a 0).
    setFadeFactor(k, secsLeft) {
      if (!this.fadeGain || !this.ctx) return;
      k = Math.max(0, Math.min(1, k));
      const g = this.fadeGain.gain;
      const t = this.ctx.currentTime;
      try {
        if (typeof secsLeft === "number" && secsLeft <= 1.2) {
          // tramo final: rampa lineal exacta hacia 0 (o hacia k si k>0 por algún margen)
          g.cancelScheduledValues(t);
          g.setValueAtTime(g.value, t);
          g.linearRampToValueAtTime(0, t + Math.max(0.05, secsLeft));
        } else {
          g.setTargetAtTime(k, t, 0.3);
        }
      } catch (e) { try { g.value = k; } catch (_) {} }
    },

    _rampNorm() {
      if (!this.normGain || !this.ctx) return;
      let g = 1;
      if (this.normEnabled) {
        g = this._targetRMS() / this._lastRMS;
        g = Math.max(1, Math.min(4, g));   // solo-subir: nunca baja, máx +~12 dB
      }
      const t = this.ctx.currentTime;
      try {
        this.normGain.gain.cancelScheduledValues(t);
        this.normGain.gain.setValueAtTime(this.normGain.gain.value, t);
        this.normGain.gain.linearRampToValueAtTime(g, t + 0.25);
      } catch (e) { try { this.normGain.gain.value = g; } catch (_) {} }
    },

    /* ---- modo solo reproductor (audio nativo) ---- */
    setNativeMode(on, audioEl) {
      this.nativeMode = !!on;
      if (on && audioEl) {
        this._audio = audioEl;
        // conectar el <audio> a un analyser para el visualizador (una sola vez)
        this.init().then(() => {
          try {
            if (!this._audioSrc) {
              this._audioSrc = this.ctx.createMediaElementSource(audioEl);
              if (!this.analyser) {
                this.analyser = this.ctx.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.82;
              }
              this._audioSrc.connect(this.analyser);
              this.analyser.connect(this.normGain || this.ctx.destination);
            }
          } catch (e) { /* ya conectado */ }
        });
      }
    },

    // carga una pista en el <audio> nativo desde un blob/arraybuffer (instantáneo)
    nativeLoad(blobOrBuffer, name, mime) {
      if (!this._audio) return;
      this.stop();
      this.fileName = name;
      try { if (this._nativeUrl) URL.revokeObjectURL(this._nativeUrl); } catch (e) {}
      let blob = blobOrBuffer;
      if (!(blobOrBuffer instanceof Blob)) blob = new Blob([blobOrBuffer], { type: mime || "audio/mpeg" });
      this._nativeUrl = URL.createObjectURL(blob);
      this._audio.src = this._nativeUrl;
      this._audio.playbackRate = this.speed || 1;
      this._offset = 0;
    },

    async decode(arrayBuffer) {
      await this.init();
      return await this.ctx.decodeAudioData(arrayBuffer);
    },

    setBuffer(buffer, name) {
      this.stop();
      this.buffer = buffer;
      this.fileName = name;
      this._offset = 0;
    },

    get duration() {
      if (this.nativeMode) return (this._audio && isFinite(this._audio.duration)) ? this._audio.duration : 0;
      return this.buffer ? this.buffer.duration : 0;
    },

    position() {
      if (this.nativeMode) return this._audio ? this._audio.currentTime : 0;
      if (!this.buffer) return 0;
      if (!this._playing) return this._offset;
      const rate = this.speed || 1;
      let pos = this._offset + (this.ctx.currentTime - this._startedAt) * rate;
      if (this._loop && this.duration > 0) pos = pos % this.duration;
      return Math.min(pos, this.duration);
    },

    get playing() {
      if (this.nativeMode) return this._audio ? !this._audio.paused : false;
      return this._playing;
    },

    async play(opts) {
      if (this.nativeMode) {
        if (!this._audio || !this._audio.src) return;
        await this.resume();
        try { await this._audio.play(); } catch (e) {}
        return;
      }
      if (!this.buffer) return;
      await this.resume();
      if (this._playing) return;
      if (this._offset >= this.duration - 0.05) this._offset = 0;
      const o = opts || {};
      const tape = this.tapeLive && o.tapeStart !== false;

      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.loop = this._loop;
      src.connect(this.chain.input);

      // velocidad de reproducción
      src.playbackRate.value = this.speed || 1;

      const t = this.ctx.currentTime;
      if (tape) {
        // arranque: pitch sube + volumen entra
        const RAMP = o.short ? 0.18 : 0.5;
        src.detune.cancelScheduledValues(t);
        src.detune.setValueAtTime(o.short ? -1200 : -1800, t);
        src.detune.linearRampToValueAtTime(0, t + RAMP);
        const vol = this.chain.volume.gain;
        vol.cancelScheduledValues(t);
        vol.setValueAtTime(0, t);
        vol.linearRampToValueAtTime(this.params.output.volume, t + RAMP);
      } else {
        const vol = this.chain.volume.gain;
        vol.cancelScheduledValues(t);
        vol.setValueAtTime(this.params.output.volume, t);
      }

      src.start(0, this._offset);
      this._startedAt = this.ctx.currentTime;
      this._src = src;
      this._playing = true;
      if (this.chain.setPlaying) this.chain.setPlaying(true);
      src.onended = () => {
        if (this._src === src && this._playing && !this._loop) {
          this._playing = false;
          if (this.chain.setPlaying) this.chain.setPlaying(false);
          this._offset = 0;
          document.dispatchEvent(new CustomEvent("dsk:ended"));
        }
      };
    },

    // pausa con efecto de parada de cinta si tapeLive está activo.
    // Devuelve una promesa que resuelve cuando el source ya está muerto.
    pause() {
      if (this.nativeMode) {
        if (this._audio) { try { this._audio.pause(); } catch (e) {} }
        return Promise.resolve();
      }
      if (!this._playing) return Promise.resolve();
      this._offset = this.position();
      this._playing = false;

      if (this.tapeLive && this._src && this.ctx) {
        // si ya hay un fade de parada en curso, matarlo antes de crear otro
        if (this._dying) {
          try { this._dying.stop(); } catch (e) {}
          try { this._dying.disconnect(); } catch (e) {}
          this._dying = null;
        }
        const t = this.ctx.currentTime;
        const RAMP = 0.55;
        const dying = this._src;
        this._dying = dying;
        this._src = null;           // soltar referencia YA: nada más lo tocará
        dying.onended = null;

        try {
          dying.detune.cancelScheduledValues(t);
          dying.detune.setValueAtTime(0, t);
          dying.detune.linearRampToValueAtTime(-2000, t + RAMP);
          const vol = this.chain.volume.gain;
          vol.cancelScheduledValues(t);
          vol.setValueAtTime(this.params.output.volume, t);
          vol.linearRampToValueAtTime(0, t + RAMP);
          // detener el propio nodo al acabar el fade (garantiza silencio total)
          dying.stop(t + RAMP + 0.02);
        } catch (e) {
          try { dying.stop(); } catch (e2) {}
        }

        if (this.chain.setPlaying) this.chain.setPlaying(false);

        return new Promise((resolve) => {
          setTimeout(() => {
            try { dying.disconnect(); } catch (e) {}
            if (this._dying === dying) this._dying = null;
            // el volumen sigue en 0 tras el fade: cortar AQUÍ las colas de
            // reverb/delay (que el propio glide de parada alimentó) mientras
            // la salida está muda, para que no se oiga el eco residual.
            try { if (this.chain.flushTails) this.chain.flushTails(); } catch (e) {}
            // NO restauramos el volumen aquí: dejarlo en 0 evita reabrir la
            // cola de reverb. play() lo restaura al arrancar de nuevo.
            resolve();
          }, RAMP * 1000 + 60);
        });
      }

      this._kill();
      if (this.chain.setPlaying) this.chain.setPlaying(false);
      return Promise.resolve();
    },

    stop() {
      if (this.nativeMode) {
        if (this._audio) { try { this._audio.pause(); this._audio.currentTime = 0; } catch (e) {} }
        this._offset = 0;
        document.dispatchEvent(new CustomEvent("dsk:stopped"));
        return;
      }
      this._offset = 0;
      this._kill();
      if (this.chain && this.chain.setPlaying) this.chain.setPlaying(false);
      if (this.ctx) {
        // primero cortar colas de reverb/delay, luego restaurar el volumen,
        // así no se alcanza a oír cola residual al reabrir la salida
        try { if (this.chain.flushTails) this.chain.flushTails(); } catch (e) {}
        const vol = this.chain.volume.gain;
        const t = this.ctx.currentTime;
        vol.cancelScheduledValues(t);
        vol.setValueAtTime(this.params.output.volume, t);
      }
      document.dispatchEvent(new CustomEvent("dsk:stopped"));
    },

    _kill() {
      this._playing = false;
      if (this._src) {
        this._src.onended = null;
        try { this._src.stop(); } catch (e) {}
        try { this._src.disconnect(); } catch (e) {}
        this._src = null;
      }
      // matar cualquier fade de parada de cinta en curso (evita cola/duplicado)
      if (this._dying) {
        try { this._dying.stop(); } catch (e) {}
        try { this._dying.disconnect(); } catch (e) {}
        this._dying = null;
      }
    },

    seek(frac) {
      if (this.nativeMode) {
        if (this._audio && isFinite(this._audio.duration)) {
          this._audio.currentTime = Math.max(0, Math.min(frac, 1)) * this._audio.duration;
        }
        return;
      }
      if (!this.buffer) return;
      const wasPlaying = this._playing;
      this._kill();
      this._offset = Math.max(0, Math.min(frac, 1)) * this.duration;
      // glide corto de cinta al reposicionar si tape está activo
      if (wasPlaying) this.play({ short: true });
    },

    setTapeLive(v) { this.tapeLive = !!v; },

    setSpeed(v) {
      this.speed = Math.max(0.25, Math.min(v || 1, 2));
      if (this.nativeMode && this._audio) { try { this._audio.playbackRate = this.speed; } catch (e) {} return; }
      if (this._src && this.ctx) {
        // ajustar offset para no saltar de posición al cambiar la velocidad
        this._offset = this.position();
        this._startedAt = this.ctx.currentTime;
        try { this._src.playbackRate.setTargetAtTime(this.speed, this.ctx.currentTime, 0.03); } catch (e) {}
      }
    },

    setLoop(v) {
      this._loop = !!v;
      if (this._src) this._src.loop = this._loop;
    },
    get loop() { return this._loop; },

    /* ---- params ---- */
    setParam(section, key, value) {
      this.params[section][key] = value;
      if (!this.chain) return;
      if (section === "reverb" && key === "size") {
        clearTimeout(this._irTimer);
        this._irTimer = setTimeout(() => this.chain.setIR(value), 140);
      }
      this.chain.apply(this.params, false);
    },

    setSection(section, patch) {
      Object.assign(this.params[section], patch);
      if (!this.chain) return;
      if (patch.size !== undefined) this.chain.setIR(patch.size);
      this.chain.apply(this.params, false);
    },

    resetSection(section) {
      this.setSection(section, clone(DEFAULTS[section]));
    },

    resetAll() {
      this.params = clone(DEFAULTS);
      if (this.chain) {
        this.chain.setIR(this.params.reverb.size);
        this.chain.apply(this.params, false);
      }
    },

    holdOriginal(hold) {
      if (!this.chain) return;
      const t = this.ctx.currentTime;
      this.chain.procMon.gain.setTargetAtTime(hold ? 0 : 1, t, 0.012);
      this.chain.dryMon.gain.setTargetAtTime(hold ? 1 : 0, t, 0.012);
    },

    /* ---- peaks for waveform strip ---- */
    getPeaks(n) {
      if (!this.buffer) return null;
      const d = this.buffer.getChannelData(0);
      const block = Math.max(1, Math.floor(d.length / n));
      const peaks = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let max = 0;
        const start = i * block, end = Math.min(start + block, d.length);
        for (let j = start; j < end; j += 8) {
          const v = Math.abs(d[j]);
          if (v > max) max = v;
        }
        peaks[i] = max;
      }
      return peaks;
    },

    /* ---- offline render (export) ----
       options: { selection: {start,end} (0..1 fracs), tapeEffect: bool }   */
    async render(onProgress, options, shouldAbort) {
      if (!this.buffer) throw new Error("no buffer");
      const opts = options || {};

      /* --- slice buffer if selection provided --- */
      const srcBuffer = (() => {
        if (!opts.selection) return this.buffer;
        const dur = this.buffer.duration;
        const sStart = opts.selection.start * dur;
        const sEnd   = opts.selection.end   * dur;
        const sr2 = this.buffer.sampleRate;
        const chs = this.buffer.numberOfChannels;
        const startF = Math.floor(sStart * sr2);
        const lenF   = Math.max(1, Math.floor((sEnd - sStart) * sr2));
        const sliced = new AudioBuffer({ numberOfChannels: chs, length: lenF, sampleRate: sr2 });
        for (let c = 0; c < chs; c++) {
          sliced.copyToChannel(this.buffer.getChannelData(c).slice(startF, startF + lenF), c);
        }
        return sliced;
      })();

      const p = this.params;
      const TAPE_START = opts.tapeEffect ? 0.55 : 0;
      const TAPE_END   = opts.tapeEffect ? 0.65 : 0;

      let tail = 0.25;
      if (p.reverb.on) tail += map.rvSecs(p.reverb.size) * (0.4 + p.reverb.mix);
      if (p.delay.on) tail += map.dlTime(p.delay.time) * 3 * p.delay.mix;
      tail = Math.min(tail, 6);

      const sr = srcBuffer.sampleRate;
      const contentDur = srcBuffer.duration;
      const totalDur = TAPE_START + contentDur + TAPE_END + tail;
      const len = Math.ceil(totalDur * sr);
      const oc = new OfflineAudioContext(2, len, sr);

      let workletOK = false;
      try { await oc.audioWorklet.addModule(WORKLET_URL); workletOK = true; }
      catch (e) { workletOK = false; }

      const chain = buildChain(oc, workletOK);
      chain.setIR(p.reverb.size);
      chain._playGate = true;  // en export el lofi siempre suena
      chain.apply(p, true);
      chain.dryMon.gain.value = 0;
      chain.procMon.gain.value = 1;
      chain.volume.connect(oc.destination);

      const src = oc.createBufferSource();
      src.buffer = srcBuffer;
      src.connect(chain.input);
      src.start(TAPE_START);

      if (opts.tapeEffect) {
        /* TAPE START: volume ramp up + pitch glide up */
        chain.volume.gain.cancelScheduledValues(0);
        chain.volume.gain.setValueAtTime(0, 0);
        chain.volume.gain.linearRampToValueAtTime(p.output.volume, TAPE_START);
        src.detune.setValueAtTime(-1800, TAPE_START);
        src.detune.linearRampToValueAtTime(0, TAPE_START + 0.45);

        /* TAPE STOP: pitch glide down + volume ramp down */
        const stopAt = TAPE_START + contentDur;
        src.detune.setValueAtTime(0, stopAt - 0.05);
        src.detune.linearRampToValueAtTime(-2000, stopAt + TAPE_END);
        chain.volume.gain.setValueAtTime(p.output.volume, stopAt);
        chain.volume.gain.linearRampToValueAtTime(0, stopAt + TAPE_END);
      }

      const total = totalDur;
      let aborted = false;
      if (onProgress || shouldAbort) {
        const step = Math.max(total / 60, 0.5);
        for (let t = step; t < total; t += step) {
          oc.suspend(t).then(() => {
            if (shouldAbort && shouldAbort()) {
              // cancelación: desconectar la fuente y dejar que termine vacío
              aborted = true;
              try { src.disconnect(); } catch (e) {}
              try { chain.volume.disconnect(); } catch (e) {}
            }
            if (onProgress) onProgress(Math.min(t / total, 0.99));
            oc.resume();
          }).catch(() => {});
        }
      }
      const rendered = await oc.startRendering();
      if (aborted || (shouldAbort && shouldAbort())) throw new Error("__cancel__");
      if (onProgress) onProgress(1);
      return rendered;
    }
  };

  window.Engine = Engine;
})();