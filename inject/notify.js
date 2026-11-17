(function () {
const MC = (globalThis.__machatLib ||= {});
const N = window.Notification;
if (N) {
  const redact = (title, opts) =>
    MC.censoring(MC.state) ? ['Machat', { ...opts, body: 'New message', icon: undefined, image: undefined }] : [title, opts];
  function MN(title, opts) {
    const [t, o] = redact(title, opts);
    return new N(t, o);
  }
  MN.prototype = N.prototype;
  Object.defineProperty(MN, 'permission', { get: () => N.permission });
  MN.requestPermission = N.requestPermission ? N.requestPermission.bind(N) : undefined;
  window.Notification = MN;
  const SWR = window.ServiceWorkerRegistration;
  if (SWR && SWR.prototype.showNotification) {
    const orig = SWR.prototype.showNotification;
    SWR.prototype.showNotification = function (title, opts) {
      const [t, o] = redact(title, opts);
      return orig.call(this, t, o);
    };
  }
}
})();

// WebKitGTK publishes the document title ("(13) WhatsApp") in its MPRIS media card whenever the page plays
// audio, and WebKit has no switch for that. The title is always empty (the shell window has its own), so the card
// never shows the unread count or chat names. ponytail: covers document.title writes only, not <title> mutations.
(function () {
  const D = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
  if (!D || !D.set) return;
  Object.defineProperty(Document.prototype, 'title', {
    configurable: true,
    enumerable: D.enumerable,
    get: D.get,
    set(v) {
      D.set.call(this, '');
    },
  });
})();

// Notification pings are silent: WebKitGTK publishes every playing <audio> as a desktop "now playing"
// card (MPRIS), so each ping looked like a music player. A ping is a short sound played from an element
// that is not in the page; voice notes, videos and in-chat players are untouched.
(function () {
  const P = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (!P || !P.play) return;
  const play = P.play;
  const PING_MAX_S = 4;
  P.play = function () {
    const el = this;
    if (el.isConnected || el.tagName !== 'AUDIO') return play.call(el);
    const decide = () => (el.duration > PING_MAX_S ? play.call(el) : undefined);
    if (el.readyState >= 1) return Promise.resolve(decide());
    return new Promise((ok) => {
      el.addEventListener('loadedmetadata', () => ok(decide()), { once: true });
      el.addEventListener('error', () => ok(), { once: true });
      el.preload = 'metadata';
      el.load();
    });
  };
})();
