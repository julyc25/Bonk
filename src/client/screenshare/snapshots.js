let intervalId = null;

/**
 * Starts capturing frames from a video and sends them as JPEG snapshots through POST.
 * If bonkTabActive is true, sends an "on bonk" frame.
 *
 * @param {MediaStreamTrack} videoTrack is the screen capture video track
 * @param {string} userId is the current user's id
 * @param {() => boolean} isBonkActive is true when the bonk tab is open
 * @param {number} [interval=5000] is the time between snapshots in ms
 */
export function startSnapshotWorker(videoTrack, userId, isBonkActive, interval = 5000) {
  stopSnapshotWorker();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // "on bonk" frame that is pre-rendered once
  const bonkCanvas = document.createElement('canvas');
  bonkCanvas.width = 640;
  bonkCanvas.height = 360;
  const bCtx = bonkCanvas.getContext('2d');
  bCtx.fillStyle = '#000';
  bCtx.fillRect(0, 0, 640, 360);
  bCtx.font = 'bold 36px monospace';
  bCtx.fillStyle = '#ff2e97';
  bCtx.textAlign = 'center';
  bCtx.textBaseline = 'middle';
  bCtx.fillText('on bonk', 320, 180);

  const video = document.createElement('video');
  video.srcObject = new MediaStream([videoTrack]);
  video.muted = true;
  // consuming errors
  video.play().catch(() => {});

  const capture = async () => {
    try {
      let source;
      if (isBonkActive()) {
        source = bonkCanvas;
        canvas.width = bonkCanvas.width;
        canvas.height = bonkCanvas.height;
      } else {
        // Resize canvas to match video dimensions
        const w = video.videoWidth || 640;
        const h = video.videoHeight || 360;
        canvas.width = Math.min(w, 640); // cap for bandwidth
        canvas.height = Math.round((canvas.width / w) * h);
        source = video;
      }

      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.6)
      );
      if (!blob) return;

      const form = new FormData();
      form.append('userId', userId);
      form.append('frame', blob, 'frame.jpg');

      await fetch('/api/snapshot', { method: 'POST', body: form });
    } catch (err) {
      console.warn('[snapshots] capture failed:', err);
    }
  };

  // Send first snapshot immediately, then at once every interval ms
  capture();
  intervalId = setInterval(capture, interval);
}

export function stopSnapshotWorker() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
