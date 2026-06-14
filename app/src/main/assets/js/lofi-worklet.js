/* =============================================================================
   DSK•LoFi — lofi-worklet.js
   AudioWorkletProcessor: sample-rate reduction + bit-crush + tape hiss +
   vinyl crackle. Pure DSP, no allocations in the hot loop.
   Registered as "dsk-lofi" — used by both the live AudioContext and the
   OfflineAudioContext used for export, so preview === render.
   ========================================================================== */
class DskLofiProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "bits",     defaultValue: 16, minValue: 2, maxValue: 16, automationRate: "k-rate" },
      { name: "srFactor", defaultValue: 1,  minValue: 1, maxValue: 50, automationRate: "k-rate" },
      { name: "hiss",     defaultValue: 0,  minValue: 0, maxValue: 1,  automationRate: "k-rate" },
      { name: "crackle",  defaultValue: 0,  minValue: 0, maxValue: 1,  automationRate: "k-rate" }
    ];
  }

  constructor() {
    super();
    this.holdL = 0; this.holdR = 0;   // sample & hold cells
    this.phase = 0;                    // downsample counter
    this.popEnv = 0;                   // crackle pop envelope
    this.popTone = 0;                  // crackle body (filtered)
    this.hissLP = 0;                   // one-pole lowpass state for hiss
    this.dust = 0;                     // single-sample tick level
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const bits = parameters.bits[0];
    const srF = Math.max(1, parameters.srFactor[0]);
    const hiss = parameters.hiss[0];
    const crackle = parameters.crackle[0];

    const steps = Math.pow(2, bits - 1);
    const inv = 1 / steps;
    const n = output[0].length;
    const chs = output.length;

    const hasIn = input && input.length > 0;
    const inL = hasIn ? input[0] : null;
    const inR = hasIn ? (input[1] || input[0]) : null;

    const hissGain = hiss * hiss * 0.035;       // perceptual taper
    const popRate = crackle * crackle * 0.0022; // pops per sample probability
    const dustRate = crackle * 0.0009;

    for (let i = 0; i < n; i++) {
      // ---- sample-rate reduction (sample & hold) ----
      this.phase += 1;
      if (this.phase >= srF) {
        this.phase -= srF;
        let l = inL ? inL[i] : 0;
        let r = inR ? inR[i] : 0;
        // ---- bit depth quantize ----
        if (bits < 16) {
          l = Math.round(l * steps) * inv;
          r = Math.round(r * steps) * inv;
        }
        this.holdL = l; this.holdR = r;
      }

      // ---- tape hiss: lowpassed white noise ----
      let noise = 0;
      if (hissGain > 0) {
        const w = Math.random() * 2 - 1;
        this.hissLP += 0.18 * (w - this.hissLP);
        noise = this.hissLP * hissGain * 3.2;
      }

      // ---- vinyl crackle: sparse decaying pops + dust ticks ----
      let crk = 0;
      if (crackle > 0) {
        if (Math.random() < popRate) {
          this.popEnv = 0.25 + Math.random() * 0.75;
        }
        if (this.popEnv > 0.001) {
          const burst = (Math.random() * 2 - 1) * this.popEnv;
          this.popTone += 0.35 * (burst - this.popTone);
          crk += this.popTone * 0.5;
          this.popEnv *= 0.94;
        }
        if (Math.random() < dustRate) {
          this.dust = (Math.random() * 2 - 1) * 0.12;
        }
        crk += this.dust;
        this.dust *= 0.6;
        crk *= crackle;
      }

      const add = noise + crk;
      if (chs > 0) output[0][i] = this.holdL + add;
      if (chs > 1) output[1][i] = this.holdR + add;
      for (let c = 2; c < chs; c++) output[c][i] = this.holdL + add;
    }
    return true;
  }
}

registerProcessor("dsk-lofi", DskLofiProcessor);
