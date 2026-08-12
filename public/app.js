// Mobile navigation toggle. The sidebar is a plain grid column at md and up;
// below that it collapses and this button reveals it.
(function () {
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("nav");
  if (!toggle || !nav) return;
  toggle.addEventListener("click", function () {
    var open = nav.classList.toggle("hidden") === false;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
})();

// Global progress bar for HTMX requests. Elements inside [data-quiet]
// (background row polling) don't trigger it.
(function () {
  var bar = document.getElementById("loading-bar");
  if (!bar) return;
  var active = 0;
  var timer = null;

  function isQuiet(elt) {
    return elt instanceof Element && elt.closest("[data-quiet]") !== null;
  }

  document.body.addEventListener("htmx:beforeRequest", function (evt) {
    if (isQuiet(evt.detail.elt)) return;
    active += 1;
    clearTimeout(timer);
    bar.style.opacity = "1";
    bar.style.width = "70%";
  });

  function finish(evt) {
    if (isQuiet(evt.detail.elt)) return;
    active = Math.max(0, active - 1);
    if (active === 0) {
      bar.style.width = "100%";
      timer = setTimeout(function () {
        bar.style.opacity = "0";
        bar.style.width = "0";
      }, 250);
    }
  }

  document.body.addEventListener("htmx:afterRequest", finish);
  document.body.addEventListener("htmx:sendError", finish);
  document.body.addEventListener("htmx:responseError", finish);
})();
