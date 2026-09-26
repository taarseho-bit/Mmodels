(() => {
  /* ---------- ambient math-field canvas ---------- */
  const canvas = document.getElementById("math-field");
  const ctx = canvas?.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 0;
  let height = 0;
  let dpr = 1;
  const particles = Array.from({ length: 34 }, (_, index) => ({
    x: Math.random(),
    y: Math.random(),
    phase: index * .47,
    speed: .00005 + Math.random() * .00009,
    radius: .6 + Math.random() * 1.5
  }));

  function resizeCanvas() {
    if (!canvas || !ctx) return;
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawField(time = 0) {
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(width * .64, height * .44);
    ctx.rotate(-.18);
    ctx.strokeStyle = "rgba(122, 153, 211, .07)";
    ctx.lineWidth = .7;
    const spacing = Math.max(34, Math.min(58, width / 27));
    for (let row = -18; row <= 18; row += 1) {
      ctx.beginPath();
      for (let x = -width * .78; x <= width * .78; x += 18) {
        const y = row * spacing
          + Math.sin(x * .008 + time * .00022 + row) * 18
          + Math.sin(x * .0025 - time * .00012) * 28;
        if (x === -width * .78) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    particles.forEach((point, index) => {
      const x = point.x * width + Math.sin(time * point.speed + point.phase) * 20;
      const y = point.y * height + Math.cos(time * point.speed * 1.2 + point.phase) * 16;
      ctx.beginPath();
      ctx.fillStyle = index % 5 === 0 ? "rgba(167, 139, 250, .3)" : "rgba(110, 231, 213, .26)";
      ctx.arc(x, y, point.radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function animate(time) {
    drawField(time);
    if (!reduceMotion) requestAnimationFrame(animate);
  }

  if (canvas && ctx) {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas, { passive: true });
    animate(0);
  }

  /* ---------- browser-chrome bars for screenshot figures ---------- */
  const CHROME_LABEL = "MModels — 真实软件界面";
  document.querySelectorAll("[data-lightbox]").forEach((figure) => {
    if (figure.querySelector(".shot-chrome")) return;
    const bar = document.createElement("div");
    bar.className = "shot-chrome";
    bar.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i += 1) bar.appendChild(document.createElement("i"));
    const label = document.createElement("em");
    label.textContent = CHROME_LABEL;
    bar.appendChild(label);
    figure.insertBefore(bar, figure.firstChild);
  });

  /* ---------- view switching ---------- */
  const navItems = [...document.querySelectorAll("[data-view]")];
  const panels = [...document.querySelectorAll("[data-panel]")];
  const title = document.getElementById("view-title");
  const counter = document.getElementById("view-counter");
  const titles = {
    overview: "总览",
    workflow: "建模工作流",
    agents: "多智能体协作",
    data: "数据与图表",
    paper: "论文交付",
    calendar: "赛事节奏"
  };
  const order = Object.keys(titles);

  function setView(name, updateHash = true) {
    const target = titles[name] ? name : "overview";
    navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === target));
    panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === target));
    if (title) title.textContent = titles[target];
    if (counter) {
      const index = order.indexOf(target);
      counter.textContent = String(index + 1).padStart(2, "0") + " / " + String(order.length).padStart(2, "0");
    }
    if (updateHash) history.replaceState(null, "", "#" + target);
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    document.querySelectorAll(".view.is-active .reveal").forEach((el, index) => {
      el.classList.remove("is-visible");
      window.setTimeout(() => el.classList.add("is-visible"), Math.min(index * 50, 240));
    });
  }

  navItems.forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.go));
  });

  /* bottom pager: prev / next */
  function stepView(delta) {
    const current = order.indexOf(navItems.find((item) => item.classList.contains("active"))?.dataset.view || "overview");
    const next = Math.max(0, Math.min(order.length - 1, current + delta));
    if (next !== current) setView(order[next]);
  }
  document.querySelectorAll("[data-pager]").forEach((button) => {
    button.addEventListener("click", () => stepView(Number(button.dataset.pager)));
  });
  document.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) stepView(event.key === "ArrowRight" ? 1 : -1);
  });

  const initial = window.location.hash.replace("#", "");
  setView(initial || "overview", false);

  /* ---------- scroll reveal ---------- */
  const revealObserver = "IntersectionObserver" in window
    ? new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: .13 })
    : null;

  if (revealObserver) {
    document.querySelectorAll(".reveal").forEach((el) => revealObserver.observe(el));
  } else {
    document.querySelectorAll(".reveal").forEach((el) => el.classList.add("is-visible"));
  }
})();

(() => {
  /* ---------- lightbox ---------- */
  const lightbox = document.getElementById("lightbox");
  if (!lightbox) return;
  const image = lightbox.querySelector("img");
  const caption = lightbox.querySelector("p");
  const close = () => {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    image.removeAttribute("src");
  };
  document.querySelectorAll("[data-lightbox]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const source = trigger.dataset.lightbox;
      image.src = source;
      image.alt = trigger.querySelector("img")?.alt || trigger.alt || "";
      caption.textContent = image.alt;
      lightbox.classList.add("is-open");
      lightbox.setAttribute("aria-hidden", "false");
    });
  });
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox || event.target === close) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
})();
