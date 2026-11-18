import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { api } from "./ipc.js";
import { ServiceIcon, acctName } from "./TopBar.jsx";

const BACKOFF_S = 30; // matches the Rust backoff after 5 failures
const OPEN_MS = 620; // the unlock transition; 0 when still
const SEGS = 12; // "ring" style: one segment per typed character, capped here for long passwords

// Full-window lock screen (below the title bar). Rust hides `wa` while locked; the parent calls onUnlocked
// after the `lock` event or a successful unlock. `method` is "pin" (4-12 digits) or "password" (8+ characters).
// Motion (drifting aurora, pointer parallax, logo draw-in, unlock zoom) runs only with `anim` on and no
// prefers-reduced-motion; otherwise the same layout renders still. Only transform and opacity animate.
export default function Lock(props) {
  const [pin, setPin] = createSignal("");
  const [err, setErr] = createSignal("");
  const [wait, setWait] = createSignal(0);
  const [shake, setShake] = createSignal(false);
  const [bad, setBad] = createSignal(0); // dots shown in red after a wrong try
  const [open, setOpen] = createSignal(false);
  const [now, setNow] = createSignal(new Date());
  const [hidden, setHidden] = createSignal(document.hidden);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const [calm, setCalm] = createSignal(reduce.matches);
  const moving = () => props.anim && !calm();
  const pw = () => props.method === "password";
  const min = () => (pw() ? 8 : 4);
  const st = () => props.lockStyle ?? "classic"; // classic, ring, glass or split (CSS: .lock[data-style])
  const filled = () => (open() ? SEGS : Math.min(pin().length, SEGS));
  let timer, input, root, raf = 0;

  const onCalm = (e) => setCalm(e.matches);
  const onVis = () => setHidden(document.hidden);
  // Pointer parallax: at most one style write per frame, nothing read back.
  const onMove = (e) => {
    if (!moving() || raf) return;
    const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
    raf = requestAnimationFrame(() => { raf = 0; root.style.setProperty("--mx", x.toFixed(3)); root.style.setProperty("--my", y.toFixed(3)); });
  };
  const clock = setInterval(() => setNow(new Date()), 1000);
  onMount(() => {
    input.focus();
    reduce.addEventListener("change", onCalm);
    document.addEventListener("visibilitychange", onVis);
  });
  onCleanup(() => {
    clearInterval(timer); clearInterval(clock); cancelAnimationFrame(raf);
    reduce.removeEventListener("change", onCalm);
    document.removeEventListener("visibilitychange", onVis);
  });

  async function submit(e) {
    e.preventDefault();
    if (pin().length < min() || wait()) return;
    const tried = pin().length;
    try {
      if (await api.unlock(pin())) {
        setOpen(true); // the shackles lift, then the screen zooms away
        return setTimeout(() => props.onUnlocked?.(), moving() ? OPEN_MS : 0);
      }
      setErr(pw() ? "Wrong password" : "Wrong PIN");
    } catch (e) {
      if (String(e).includes("try later")) {
        setErr("Too many attempts");
        setWait(BACKOFF_S);
        clearInterval(timer);
        timer = setInterval(() => {
          setWait((w) => Math.max(0, w - 1));
          if (!wait()) { clearInterval(timer); input.focus(); }
        }, 1000);
      } else setErr(String(e));
    }
    setPin("");
    setBad(tried);
    setShake(true);
    setTimeout(() => { setShake(false); setBad(0); }, 700);
    input.focus();
  }

  // Only the digits typed so far: the dot count never hints at the PIN length (4-12).
  const dots = () => Array.from({ length: Math.max(pin().length, bad()) }, (_, i) => i);
  // "6:15" big, "PM" small (absent in 24-hour locales).
  const parts = () => new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).formatToParts(now());
  const time = () => parts().filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim();
  const period = () => parts().find((p) => p.type === "dayPeriod")?.value;
  const date = () => now().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  return (
    <div ref={root} class="lock" data-style={st()} classList={{ still: !moving(), paused: hidden(), opening: open() }} onPointerMove={onMove}
      role="dialog" aria-modal="true" aria-label="App locked" data-testid="lock-screen">
      <div class="lock-bg" aria-hidden="true">
        <div class="lock-layer l1"><i class="blob b1" /></div>
        <div class="lock-layer l2"><i class="blob b2" /></div>
        <div class="lock-layer l3"><i class="blob b3" /></div>
        <svg class="lock-grain"><filter id="lock-grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch" /><feColorMatrix values="0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 .9 0" /></filter><rect width="100%" height="100%" filter="url(#lock-grain)" /></svg>
      </div>
      <div class="lock-stage">
        <div class="lock-clock" aria-hidden="true"><div class="lock-time">{time()}<Show when={period()}><span class="lock-ampm">{period()}</span></Show></div><div class="lock-date">{date()}</div><p class="lock-calm">Your chats are resting. Unlock when you are ready.</p></div>
        <form class="lock-card" classList={{ shake: shake() }} onSubmit={submit} onPointerDown={(e) => { if (e.target !== input && e.target.tagName !== "BUTTON") { e.preventDefault(); input.focus(); } }}>
          <div class="lock-mark" classList={{ wait: !!wait() }} aria-hidden="true">
            <svg class="lock-ring" viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="46" /><circle class="left" cx="50" cy="50" r="46" pathLength="1" style={{ "stroke-dashoffset": 1 - wait() / BACKOFF_S }} /></svg>
            <svg class="lock-logo" viewBox="0 0 512 512">
              <rect class="lm-tile" width="512" height="512" rx="150" />
              <g class="lm-lift"><path class="lm-shackle" pathLength="1" d="M152 236v-40a52 52 0 0 1 104 0v40M256 236v-40a52 52 0 0 1 104 0v40" /></g>
              <g class="lm-body">
                <path class="lm-bubble" d="M150 226h212a44 44 0 0 1 44 44v92a44 44 0 0 1-44 44H230l-62 40 8-40h-26a44 44 0 0 1-44-44v-92a44 44 0 0 1 44-44Z" />
                <path class="lm-leaf" d="M256 262c34 20 34 70 0 96-34-26-34-76 0-96Z" />
              </g>
            </svg>
            <Show when={st() === "ring"}>
              <svg class="seg-ring" viewBox="0 0 100 100">
                <For each={Array.from({ length: SEGS }, (_, i) => i)}>
                  {(i) => <circle classList={{ on: i < filled() }} cx="50" cy="50" r="46" pathLength={SEGS} style={{ "stroke-dashoffset": -(i + 0.1) }} />}
                </For>
              </svg>
            </Show>
            <Show when={wait()}><span class="lock-count">{wait()}</span></Show>
          </div>
          <Show when={st() === "glass" && props.accounts?.length}>
            <ul class="lock-accts" aria-label="Accounts">
              <For each={props.accounts}>{(a) => <li><ServiceIcon service={a.service} /><span>{acctName(a)}</span></li>}</For>
            </ul>
          </Show>
          <h1 class="lock-title">Machat is locked</h1>
          <div class="pin-wrap" classList={{ pw: pw(), bad: !!bad() }}>
            <Show when={!pw()}>
              <div class="pin-dots" aria-hidden="true">
                <For each={dots()}>{() => <span class="on" />}</For>
                <Show when={!wait()}><i class="pin-caret" /></Show>
              </div>
            </Show>
            <input ref={input} class="input pin-field" classList={{ pw: pw() }} type="password" inputmode={pw() ? "text" : "numeric"} autocomplete="off"
              maxlength={pw() ? 128 : 12} placeholder={pw() ? "Password" : ""} aria-label={pw() ? "Password" : "PIN"} disabled={!!wait()} data-testid="pin-field"
              value={pin()} onInput={(e) => { setErr(""); setBad(0); setPin(pw() ? e.currentTarget.value.slice(0, 128) : e.currentTarget.value.replace(/\D/g, "").slice(0, 12)); e.currentTarget.value = pin(); }} />
          </div>
          <p class="lock-msg" classList={{ bad: !!err() }} role="alert" data-testid="lock-msg">
            <Show when={wait()} fallback={err() || (st() === "ring"
              ? (pin().length >= min() ? "Press Enter to unlock" : pw() ? "Type your password" : "Type your PIN")
              : pw() ? "Enter your password" : "Enter your PIN")}>
              {err()}. Try again in {wait()}s.
            </Show>
          </p>
          <button type="submit" class="btn primary pin-go" disabled={pin().length < min() || !!wait()} data-testid="pin-go">Unlock</button>
        </form>
      </div>
    </div>
  );
}
