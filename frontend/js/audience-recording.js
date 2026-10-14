(() => {
  "use strict";

  const dialog = document.querySelector("#audienceRecordingDialog");
  if (!dialog) return;

  const status = dialog.querySelector("[data-audience-record-status]");
  const startButton = dialog.querySelector("[data-audience-record-start]");
  const pauseButton = dialog.querySelector("[data-audience-record-pause]");
  const stopButton = dialog.querySelector("[data-audience-record-stop]");
  let recorder = null;
  let stream = null;
  let chunks = [];
  let finishing = false;

  const supportedMimeType = () => [
    "video/mp4;codecs=avc1.424028,mp4a.40.2",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm"
  ].find(type => window.MediaRecorder?.isTypeSupported?.(type)) || "";

  const setStatus = message => { status.textContent = message; };

  function setRecording(active, paused = false) {
    startButton.disabled = active;
    pauseButton.disabled = !active;
    stopButton.disabled = !active;
    pauseButton.textContent = paused ? "Resume" : "Pause";
    pauseButton.setAttribute("aria-label", paused ? "Resume recording" : "Pause recording");
    dialog.toggleAttribute("data-recording", active);
  }

  function finish(download = true) {
    if (!recorder || recorder.state === "inactive" || finishing) return;
    finishing = true;
    stopButton.disabled = true;
    recorder.addEventListener("stop", () => {
      stream?.getTracks().forEach(track => track.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
      if (download && blob.size) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        const extension = blob.type.includes("mp4") ? "mp4" : "webm";
        link.href = url;
        link.download = `snapkey-audience-recording-${new Date().toISOString().replace(/[:.]/g, "-")}.${extension}`;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setStatus("Recording downloaded to this device.");
      } else {
        setStatus("Recording stopped.");
      }
      recorder = null;
      stream = null;
      chunks = [];
      finishing = false;
      setRecording(false);
    }, { once: true });
    recorder.stop();
  }

  document.querySelector("[data-audience-record-open]")?.addEventListener("click", () => {
    document.querySelector("[data-live-more-toggle]")?.setAttribute("aria-expanded", "false");
    document.querySelector("[data-live-more-menu]")?.setAttribute("hidden", "");
    if (!recorder) setStatus("Ready. Recording starts after you choose what to share.");
    dialog.showModal();
  });
  dialog.querySelector("[data-audience-record-close]")?.addEventListener("click", () => {
    if (!recorder) dialog.close();
    else setStatus("Stop the recording before closing this dialog.");
  });
  dialog.addEventListener("cancel", event => { if (recorder) event.preventDefault(); });

  startButton.addEventListener("click", async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) {
      setStatus("Tab recording is not supported in this browser. Try the latest desktop Chrome or Edge.");
      return;
    }
    startButton.disabled = true;
    setStatus("Choose this meeting tab in the browser picker. Enable tab audio to record sound.");
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "browser", frameRate: { ideal: 30, max: 30 } },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
        systemAudio: "include"
      });
      const mimeType = supportedMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks = [];
      finishing = false;
      recorder.addEventListener("dataavailable", event => { if (event.data?.size) chunks.push(event.data); });
      recorder.addEventListener("error", event => {
        setStatus(event.error?.message || "The browser stopped recording because of an error.");
        finish(false);
      }, { once: true });
      stream.getVideoTracks()[0]?.addEventListener("ended", () => finish(true), { once: true });
      recorder.start(1000);
      setRecording(true);
      setStatus(stream.getAudioTracks().length
        ? "Recording this tab with audio. The file stays on this device."
        : "Recording this tab without audio. Enable tab audio in the browser picker next time.");
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      startButton.disabled = false;
      if (error?.name === "NotAllowedError" || error?.name === "AbortError") setStatus("Recording was cancelled.");
      else setStatus(error?.message || "The browser could not start tab recording.");
    }
  });

  pauseButton.addEventListener("click", () => {
    if (!recorder || finishing) return;
    if (recorder.state === "recording") {
      recorder.pause();
      pauseButton.textContent = "Resume";
      pauseButton.setAttribute("aria-label", "Resume recording");
      setStatus("Recording paused.");
    } else if (recorder.state === "paused") {
      recorder.resume();
      pauseButton.textContent = "Pause";
      pauseButton.setAttribute("aria-label", "Pause recording");
      setStatus("Recording this tab with audio if enabled.");
    }
  });
  stopButton.addEventListener("click", () => finish(true));
  window.addEventListener("pagehide", () => finish(false));
})();
