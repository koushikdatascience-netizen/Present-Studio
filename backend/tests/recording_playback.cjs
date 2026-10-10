const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const source = fs.readFileSync('frontend/js/controller.js', 'utf8');
    const start = source.indexOf('  function recordingMimeType(');
    const end = source.indexOf('\n  function ', start + 1);
    await page.addScriptTag({ content: source.slice(start, end) });
    for (const fallback of [false, true]) {
      const result = await page.evaluate(async forceWebM => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 360;
        document.body.append(canvas);
        const context = canvas.getContext('2d');
        let frame = 0;
        const animation = setInterval(() => {
          context.fillStyle = frame++ % 2 ? '#ffd54a' : '#247a64';
          context.fillRect(0, 0, canvas.width, canvas.height);
        }, 33);
        const stream = canvas.captureStream(30);
        const audio = new AudioContext();
        const oscillator = audio.createOscillator();
        const destination = audio.createMediaStreamDestination();
        oscillator.connect(destination); oscillator.start();
        stream.addTrack(destination.stream.getAudioTracks()[0]);
        const mime = forceWebM ? 'video/webm;codecs=vp8,opus' : recordingMimeType(true);
        const recorder = new MediaRecorder(stream, { mimeType: mime });
        const chunks = [];
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
        const stopped = new Promise(resolve => { recorder.onstop = resolve; });
        recorder.start(500);
        await new Promise(resolve => setTimeout(resolve, 1800));
        recorder.stop(); await stopped;
        clearInterval(animation); stream.getTracks().forEach(track => track.stop());
        oscillator.stop(); await audio.close();
        const blob = new Blob(chunks, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);
        const video = document.createElement('video');
        video.muted = true; video.src = url;
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Recording cannot decode')), 10000);
          video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
          video.onerror = () => { clearTimeout(timeout); reject(new Error('Invalid recorded container')); };
          video.load();
        });
        const header = Array.from(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
        const result = { type: recorder.mimeType, size: blob.size, width: video.videoWidth, duration: String(video.duration), header };
        URL.revokeObjectURL(url);
        return result;
      }, fallback);
      assert(result.size > 1000 && result.width === 640, 'Recording could not be decoded');
      if (result.type.includes('mp4')) assert.equal(String.fromCharCode(...result.header.slice(4, 8)), 'ftyp');
      else assert.deepEqual(result.header.slice(0, 4), [0x1a, 0x45, 0xdf, 0xa3]);
      console.log(`${fallback ? 'Fallback' : 'Preferred'} recording playback passed: ${result.type}, ${result.size} bytes, duration ${result.duration}`);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
