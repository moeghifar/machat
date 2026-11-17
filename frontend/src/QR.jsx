import { createEffect, For, Show } from "solid-js";
import qrcode from "qrcode-generator";
import { Logo } from "./icons.jsx";
import { status } from "./store.js";

function draw(canvas, code) {
  const qr = qrcode(0, "M");
  qr.addData(code);
  qr.make();
  const n = qr.getModuleCount(), quiet = 2;
  const scale = Math.max(3, Math.floor((264 * (window.devicePixelRatio || 1)) / (n + quiet * 2)));
  const px = (n + quiet * 2) * scale;
  canvas.width = canvas.height = px;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, px, px);
  g.fillStyle = "#141821";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
}

export function Splash() {
  return (
    <div class="splash" data-testid="splash" role="status" aria-label="Starting"><Logo size={56} /><span class="spin" /></div>
  );
}

export default function QRScreen() {
  let canvas;
  createEffect(() => { const c = status().qr; if (c && canvas) draw(canvas, c); });
  return (
    <div class="qr-screen" data-testid="qr-screen">
      <div class="qr-card">
        <div class="qr-copy">
          <div class="brand"><Logo size={32} /><span>machat</span></div>
          <h1>Scan to link your phone</h1>
          <ol>
            <li>Open WhatsApp on your phone</li>
            <li>Go to <b>Settings</b>, then <b>Linked devices</b></li>
            <li>Tap <b>Link a device</b> and <b>Scan</b> this code</li>
          </ol>
          <Show when={status().fake}><p class="tag">Demo mode, no real account</p></Show>
          <p class="tos">machat is an unofficial client. Using unofficial clients violates WhatsApp's Terms of Service and can get your account banned. Use at your own risk.</p>
        </div>
        <div class="qr-col">
          <div class="qr-box">
            <Show when={status().qr} fallback={<div class="qr-wait" data-testid="qr-waiting"><span class="spin" /><span>{status().state === "loggedOut" ? "Signed out. Preparing a new code…" : "Preparing code…"}</span></div>}>
              <canvas ref={canvas} data-testid="qr-canvas" role="img" aria-label="Pairing QR code" />
            </Show>
          </div>
          {/* Countdown sits below the frame, never over the QR modules. */}
          <Show when={status().qr}>
            <For each={[status().qr]}>{() => (
              <svg class="ring" data-testid="qr-countdown" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" /><circle class="prog" cx="20" cy="20" r="16" pathLength="1" /></svg>
            )}</For>
          </Show>
        </div>
      </div>
    </div>
  );
}
