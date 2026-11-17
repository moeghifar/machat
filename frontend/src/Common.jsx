import { createSignal, createEffect, For, Show } from "solid-js";
import { Icon } from "./icons.jsx";
import { hue, initials, stripBidi, parse } from "./text.js";
import { toasts } from "./store.js";
import { Browser } from "@wailsio/runtime";

export function Avatar(props) {
  const [bad, setBad] = createSignal(false);
  createEffect(() => { props.src; setBad(false); });
  const sz = () => (props.size ?? 48) + "px";
  return (
    <span class="avatar" data-pb="avatars" style={{ width: sz(), height: sz(), "font-size": (props.size ?? 48) * 0.38 + "px" }}>
      <Show when={props.src && !bad()} fallback={
        <span class="av-init" style={{ background: `hsl(${hue(props.jid || props.name)} 52% 40%)` }}>
          {props.group && !props.name ? <Icon n="users" size={(props.size ?? 48) * 0.5} /> : initials(props.name)}
        </span>
      }>
        <img src={props.src} alt="" loading="lazy" decoding="async" draggable="false" onError={() => setBad(true)} />
      </Show>
    </span>
  );
}

function openLink(e, href) {
  e.preventDefault();
  Browser.OpenURL(href).catch(() => {});
}

// Renders the parse() tree as real nodes (never HTML strings).
export function Rich(props) {
  return (
    <For each={props.nodes}>
      {(n) =>
        n.t === "text" ? n.v
        : n.t === "a" ? <a href={n.href} rel="noopener noreferrer" target="_blank" onClick={(e) => openLink(e, n.href)}>{n.v}</a>
        : n.t === "b" ? <b><Rich nodes={n.kids} /></b>
        : n.t === "i" ? <i><Rich nodes={n.kids} /></i>
        : n.t === "s" ? <s><Rich nodes={n.kids} /></s>
        : <code><Rich nodes={n.kids} /></code>
      }
    </For>
  );
}
export const Text = (props) => <Rich nodes={parse(props.text)} />;
export const Name = (props) => <>{stripBidi(props.v)}</>;

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      <For each={toasts()}>{(t) => <div class="toast" data-testid="toast">{t.msg}</div>}</For>
    </div>
  );
}

export function Switch(props) {
  return (
    <button type="button" role="switch" class="switch" aria-checked={!!props.on} aria-label={props.label}
      data-testid={props.testid} disabled={props.disabled} onClick={() => props.onChange(!props.on)}><span /></button>
  );
}
