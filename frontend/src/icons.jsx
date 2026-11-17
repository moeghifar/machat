// Lucide-style inline SVG icons (stroke = currentColor). Decorative: aria-hidden.
const P = {
  search: () => <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  sliders: () => <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />,
  x: () => <path d="M18 6 6 18M6 6l12 12" />,
  send: () => <path d="m22 2-7 20-4-9-9-4ZM22 2 11 13" />,
  clip: () => <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  info: () => <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></>,
  back: () => <path d="m12 19-7-7 7-7M19 12H5" />,
  reply: () => <path d="M9 17 4 12l5-5M20 18v-2a4 4 0 0 0-4-4H4" />,
  smile: () => <><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" /></>,
  check: () => <path d="M20 6 9 17l-5-5" />,
  check2: () => <><path d="M18 6 7 17l-5-5" /><path d="m22 10-7.5 7.5L13 16" /></>,
  clock: () => <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  pin: () => <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />,
  bellOff: () => <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7M10.3 21a1.94 1.94 0 0 0 3.4 0M2 2l20 20" />,
  file: () => <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5zM14 2v6h6" />,
  play: () => <path d="M6 3l14 9-14 9z" />,
  download: () => <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  down: () => <path d="m6 9 6 6 6-6" />,
  users: () => <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  logout: () => <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  alert: () => <><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></>,
  chat: () => <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  mic: () => <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" /></>,
  sun: () => <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>,
  moon: () => <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />,
  image: () => <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></>,
  copy: () => <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  archive: () => <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" />,
};

export function Icon(props) {
  const s = () => props.size ?? 20;
  return (
    <svg class={"ic " + (props.class ?? "")} width={s()} height={s()} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {P[props.n]()}
    </svg>
  );
}

// Eye that morphs: the slash draws in when `off` (blur active).
export function Eye(props) {
  return (
    <svg class="ic eye" classList={{ off: props.off }} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      <path class="slash" d="M3 3l18 18" pathLength="1" />
    </svg>
  );
}

// Original geometric "m" speech mark.
export function Logo(props) {
  return (
    <svg class="logo" width={props.size ?? 28} height={props.size ?? 28} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="10" fill="var(--accent)" />
      <path d="M8.5 22V13.5a3.5 3.5 0 0 1 7 0V22M15.5 14.5a3.5 3.5 0 0 1 7 0V22" fill="none" stroke="var(--on-accent)" stroke-width="2.6" stroke-linecap="round" />
    </svg>
  );
}
