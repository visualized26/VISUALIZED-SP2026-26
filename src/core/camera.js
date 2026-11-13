// Webcam access. The browser asks the user for permission (getUserMedia).
export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
  }

  get active() {
    return !!this.stream;
  }

  async start({ width = 1280, height = 720 } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("This browser does not support camera access.");
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: width }, height: { ideal: height } },
    });
    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise((r) => this.video.addEventListener("loadedmetadata", r, { once: true }));
    }
    return { width: this.video.videoWidth, height: this.video.videoHeight };
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}

export function cameraErrorMessage(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError") return "Camera permission was denied. Allow camera access in your browser and try again.";
  if (name === "NotFoundError") return "No camera was found. Connect a webcam or try a photo instead.";
  if (name === "NotReadableError") return "The camera is being used by another app. Close it and try again.";
  return err?.message || "Could not start the camera.";
}
