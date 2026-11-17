// What the maximize/restore button shows for the window state Rust reports (event "window-state").
// Fullscreen wins over maximized: there the button exits fullscreen (Rust: layout::button_act).
export function maxButton(s) {
  if (s?.fullscreen) return { label: "Exit full screen", icon: "exitfs" };
  if (s?.maximized) return { label: "Restore window", icon: "restore" };
  return { label: "Maximize window", icon: "max" };
}
