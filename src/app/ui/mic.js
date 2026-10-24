// Hold-to-talk recorder. start() opens the mic, stop() gives back a 16 kHz mono 16-bit WAV.
// Plain browser JS (no imports) so it works under our strict CSP.
(() => {
  const TARGET_RATE = 16000;
  const MAX_SECONDS = 20;

  let rec = null; // { stream, ctx, source, proc, analyser, chunks, samples, rate, timer }
  let levelFn = null;
  let level = 0;

  function plainError(e) {
    const name = e && e.name;
    if (name === "NotAllowedError" || name === "SecurityError") {
      return new Error("CalHack isn't allowed to use the microphone. Turn it on in System Settings → Privacy & Security → Microphone.");
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return new Error("No microphone was found. Plug one in or check your sound settings.");
    }
    if (name === "NotReadableError" || name === "AbortError") {
      return new Error("The microphone is busy or not working. Close other apps using it and try again.");
    }
    return new Error("The microphone couldn't start. Please try again.");
  }

  function teardown() {
    if (!rec) return;
    const r = rec;
    rec = null;
    clearInterval(r.timer);
    try { r.proc.disconnect(); } catch {}
    try { r.source.disconnect(); } catch {}
    r.proc.onaudioprocess = null;
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
    level = 0;
    if (levelFn) levelFn(0);
    return r;
  }

  async function start() {
    if (rec) teardown();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("This window can't use the microphone.");
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      });
    } catch (e) {
      throw plainError(e);
    }
    const ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    // ScriptProcessorNode is old but needs no extra module file, so the CSP stays simple.
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const r = { stream, ctx, source, proc, analyser, chunks: [], samples: 0, rate: ctx.sampleRate, timer: 0 };
    const maxSamples = Math.ceil(MAX_SECONDS * ctx.sampleRate);
    proc.onaudioprocess = (ev) => {
      if (rec !== r || r.samples >= maxSamples) return;
      const data = ev.inputBuffer.getChannelData(0);
      const take = Math.min(data.length, maxSamples - r.samples);
      r.chunks.push(new Float32Array(data.subarray(0, take)));
      r.samples += take;
    };
    source.connect(analyser);
    source.connect(proc);
    proc.connect(ctx.destination); // must be connected to run; it outputs silence

    const buf = new Float32Array(analyser.fftSize);
    r.timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      // Speech RMS is roughly 0.01–0.3; map that onto 0..1 and smooth it.
      const target = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-8) + 50) / 40));
      level = target > level ? level * 0.4 + target * 0.6 : level * 0.8 + target * 0.2;
      if (levelFn) levelFn(level);
    }, 50);

    // If the mic is unplugged mid-recording, stop cleanly.
    stream.getAudioTracks().forEach((t) => (t.onended = () => { if (rec === r) clearInterval(r.timer); }));
    rec = r;
  }

  function joinChunks(chunks, total) {
    const out = new Float32Array(total);
    let at = 0;
    for (const c of chunks) { out.set(c, at); at += c.length; }
    return out;
  }

  // Average samples into 16 kHz bins (a simple low-pass so it doesn't alias).
  function downsample(input, fromRate) {
    if (fromRate === TARGET_RATE) return input;
    const ratio = fromRate / TARGET_RATE;
    const outLen = Math.floor(input.length / ratio);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(input.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = a; j < b; j++) sum += input[j];
      out[i] = b > a ? sum / (b - a) : input[a] || 0;
    }
    return out;
  }

  function encodeWav(samples) {
    const bytes = samples.length * 2;
    const buf = new ArrayBuffer(44 + bytes);
    const v = new DataView(buf);
    const str = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
    str(0, "RIFF");
    v.setUint32(4, 36 + bytes, true);
    str(8, "WAVE");
    str(12, "fmt ");
    v.setUint32(16, 16, true); // fmt chunk size
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, TARGET_RATE, true);
    v.setUint32(28, TARGET_RATE * 2, true); // byte rate
    v.setUint16(32, 2, true); // block align
    v.setUint16(34, 16, true); // bits per sample
    str(36, "data");
    v.setUint32(40, bytes, true);
    let at = 44;
    for (let i = 0; i < samples.length; i++, at += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  async function stop() {
    const r = teardown();
    if (!r) throw new Error("The microphone wasn't recording.");
    if (r.samples < r.rate * 0.3) throw new Error("That was too short. Hold the button while you talk.");
    const pcm = downsample(joinChunks(r.chunks, r.samples), r.rate);
    return encodeWav(pcm);
  }

  function cancel() {
    teardown();
  }

  function onLevel(fn) {
    levelFn = typeof fn === "function" ? fn : null;
  }

  window.CalhackMic = { start, stop, cancel, onLevel };
})();
