// Runs before first paint: applies persisted theme + privacy classes so nothing flashes unblurred.
(function () {
  try {
    var s = JSON.parse(localStorage.getItem("machat.ui"));
    if (!s) return;
    var h = document.documentElement, p = s.privacy || {};
    if (s.theme === "light" || s.theme === "dark") h.setAttribute("data-theme", s.theme);
    if (p.enabled) h.classList.add("privacy-on");
    ["names", "avatars", "previews", "messages", "media"].forEach(function (k) { if (p[k] !== false) h.classList.add("pb-" + k); });
    if (p.hoverReveal !== false) h.classList.add("hover-reveal");
  } catch (e) { /* no storage */ }
})();
