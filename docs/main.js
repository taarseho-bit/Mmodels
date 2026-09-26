(() => {
  /* ---------- 数学建模符号粒子背景 ---------- */
  const field = document.getElementById("math-field");
  if (field && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const SYMBOLS = ["∑", "∫", "π", "∂", "√", "Σ", "∏", "≈", "≠", "∞", "x²", "Δx", "μ", "σ", "θ", "λ", "ƒ(x)", "lim", "E=mc²", "dy/dx", "Σx̄", "∅"];
    for (let i = 0; i < 22; i += 1) {
      const s = document.createElement("span");
      s.textContent = SYMBOLS[i % SYMBOLS.length];
      s.style.left = (i * 37 + Math.random() * 60) % 97 + "vw";
      s.style.top = 8 + Math.random() * 80 + "vh";
      s.style.animationDuration = 16 + Math.random() * 18 + "s";
      s.style.animationDelay = -(Math.random() * 24) + "s";
      s.style.fontSize = 20 + Math.random() * 30 + "px";
      s.style.opacity = 0;
      field.appendChild(s);
    }
  }
})();

(() => {
  /* ---------- 入场动画 ---------- */
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealObserver = "IntersectionObserver" in window && !reduceMotion
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.08 })
    : null;
  if (revealObserver) {
    document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible"));
  }
})();

(() => {
  /* ---------- 点击放大（lightbox） ---------- */
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;
  const image = lightbox.querySelector("img");
  document.querySelectorAll("[data-lightbox]").forEach((figure) => {
    figure.addEventListener("click", () => {
      const src = figure.getAttribute("data-lightbox");
      if (!src) return;
      image.src = src;
      image.alt = (figure.querySelector("img") || {}).alt || "截图放大查看";
      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
    });
  });
  const close = () => {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
  };
  lightbox.addEventListener("click", close);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox.classList.contains("is-open")) close();
  });
})();

(() => {
  /* ---------- 顶栏导航高亮：滚到哪章，点亮哪章 ---------- */
  const links = [...document.querySelectorAll(".site-nav a")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const map = new Map();
  links.forEach((link) => {
    const id = (link.getAttribute("href") || "").replace("#", "");
    const section = document.getElementById(id);
    if (section) map.set(section, link);
  });
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const link = map.get(entry.target);
      if (!link) return;
      if (entry.isIntersecting) {
        links.forEach((l) => l.classList.remove("is-current"));
        link.classList.add("is-current");
      }
    });
  }, { rootMargin: "-30% 0px -60% 0px" });
  map.forEach((_, section) => observer.observe(section));
})();
