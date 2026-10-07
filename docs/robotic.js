(() => {
  /* ---------- 二进制数字雨（克制版：低密度、低亮度、仅字符，不抢内容） ---------- */
  const canvas = document.getElementById("rain");
  if (canvas && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const ctx = canvas.getContext("2d");
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);
    const FONT = 12;
    const chars = "01010101011001101010";
    const cols = Math.max(1, Math.floor(w / FONT));
    const drops = new Array(cols).fill(1).map(() => Math.random() * -50);

    const draw = () => {
      ctx.fillStyle = "rgba(5, 7, 11, 0.08)";
      ctx.fillRect(0, 0, w, h);
      ctx.font = FONT + "px 'JetBrains Mono', Consolas, monospace";
      for (let i = 0; i < cols; i += 1) {
        const ch = chars[Math.floor(Math.random() * chars.length)];
        const x = i * FONT;
        const y = drops[i] * FONT;
        // 头部亮青，尾部暗绿——数字雨经典渐隐
        ctx.fillStyle = i % 7 === 0 ? "rgba(0, 229, 255, 0.55)" : "rgba(0, 255, 159, 0.28)";
        ctx.fillText(ch, x, y);
        if (y > h && Math.random() > 0.975) drops[i] = 0;
        drops[i] += 1;
      }
    };
    let timer = setInterval(draw, 42);
    window.addEventListener("resize", () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    });
    // 页面隐藏时暂停，省电
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { clearInterval(timer); timer = null; }
      else if (!timer) timer = setInterval(draw, 42);
    });
  }
})();

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
