(() => {
  /* ---------- 点击放大（lightbox） ---------- */
  const lightbox = document.getElementById("lightbox");
  if (lightbox) {
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
  }
})();

(() => {
  /* ---------- 左侧导航：滚动高亮当前章节 ---------- */
  const links = [...document.querySelectorAll(".lsb-nav a")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const map = new Map();
  links.forEach((link) => {
    const id = (link.getAttribute("href") || "").replace("#", "");
    const section = document.getElementById(id);
    if (section) map.set(section, link);
  });
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = map.get(entry.target);
        if (!link) return;
        if (entry.isIntersecting) {
          links.forEach((l) => l.classList.remove("is-current"));
          link.classList.add("is-current");
        }
      });
    },
    { rootMargin: "-15% 0px -70% 0px" }
  );
  map.forEach((_, section) => observer.observe(section));
})();
