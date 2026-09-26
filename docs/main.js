(function () {
  const canvas = document.getElementById('math-field');
  const ctx = canvas && canvas.getContext('2d');
  if (!canvas || !ctx) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let width = 0;
  let height = 0;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let tick = 0;
  const points = Array.from({ length: 24 }, (_, i) => ({
    x: Math.random(), y: Math.random(), speed: 0.00008 + Math.random() * 0.00013,
    phase: i * 0.55, radius: 1 + Math.random() * 1.8,
  }));

  function resize() {
    width = window.innerWidth; height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = width * dpr; canvas.height = height * dpr;
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawContour(t) {
    const spacing = Math.max(36, Math.min(58, width / 26));
    ctx.save();
    ctx.translate(width * 0.52, height * 0.48);
    ctx.rotate(-0.14);
    ctx.strokeStyle = 'rgba(108, 137, 195, .11)';
    ctx.lineWidth = 0.7;
    for (let i = -16; i <= 16; i++) {
      ctx.beginPath();
      for (let x = -width * .8; x <= width * .8; x += 18) {
        const y = i * spacing + Math.sin(x * .008 + t * .00025 + i) * 20 + Math.sin(x * .0027 - t * .00016) * 30;
        if (x === -width * .8) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGrid() {
    const size = 70;
    ctx.strokeStyle = 'rgba(108, 137, 195, .055)'; ctx.lineWidth = .6;
    ctx.beginPath();
    for (let x = 0; x < width; x += size) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
    for (let y = 0; y < height; y += size) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
    ctx.stroke();
  }

  function drawParticles(t) {
    points.forEach((p, i) => {
      p.y -= p.speed * 0.35; if (p.y < -.05) p.y = 1.05;
      const x = p.x * width + Math.sin(t * .00025 + p.phase) * 40;
      const y = p.y * height + Math.cos(t * .0002 + p.phase) * 30;
      ctx.beginPath(); ctx.fillStyle = i % 4 === 0 ? 'rgba(89,229,208,.7)' : 'rgba(140,123,255,.35)';
      ctx.arc(x, y, p.radius, 0, Math.PI * 2); ctx.fill();
    });
  }

  function frame(t) {
    ctx.clearRect(0, 0, width, height); drawGrid(); drawContour(t); drawParticles(t);
    if (!reduced) requestAnimationFrame(frame);
  }
  resize(); window.addEventListener('resize', resize, { passive: true }); frame(tick);

  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }), { threshold: .13 });
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

  const header = document.querySelector('[data-header]');
  const onScroll = () => header && header.classList.toggle('is-scrolled', window.scrollY > 16);
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
})();
