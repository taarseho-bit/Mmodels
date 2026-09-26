(() => {
  const canvas = document.getElementById("math-field");
  const ctx = canvas?.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let frame = 0;
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
    ctx.strokeStyle = "rgba(122, 153, 211, .08)";
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
      ctx.fillStyle = index % 5 === 0 ? "rgba(156, 140, 255, .32)" : "rgba(112, 230, 209, .27)";
      ctx.arc(x, y, point.radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function animate(time) {
    drawField(time);
    if (!reduceMotion) frame = requestAnimationFrame(animate);
  }

  if (canvas && ctx) {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas, { passive: true });
    animate(0);
  }

  const navItems = [...document.querySelectorAll("[data-view]")];
  const panels = [...document.querySelectorAll("[data-panel]")];
  const title = document.getElementById("view-title");
  const titles = {
    overview: "总览",
    workflow: "建模工作流",
    agents: "多智能体协作",
    data: "数据与图表",
    paper: "论文交付",
    calendar: "赛事节奏"
  };

  function setView(name, updateHash = true) {
    const target = titles[name] ? name : "overview";
    navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === target));
    panels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === target));
    if (title) title.textContent = titles[target];
    if (updateHash) history.replaceState(null, "", "#" + target);
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    document.querySelectorAll(".view.is-active .reveal").forEach((el, index) => {
      el.classList.remove("is-visible");
      window.setTimeout(() => el.classList.add("is-visible"), Math.min(index * 55, 260));
    });
  }

  navItems.forEach((item) => item.addEventListener("click", () => setView(item.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.go));
  });

  const initial = window.location.hash.replace("#", "");
  setView(initial || "overview", false);

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

  document.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const current = navItems.findIndex((item) => item.classList.contains("active"));
    const next = event.key === "ArrowRight" ? current + 1 : current - 1;
    if (next >= 0 && next < navItems.length) setView(navItems[next].dataset.view);
  });
})();
