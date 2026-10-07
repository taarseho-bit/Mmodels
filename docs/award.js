(() => {
  const items = document.querySelectorAll('.award-reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } });
    }, {threshold: .12, rootMargin: '0px 0px -8%'});
    items.forEach((item) => io.observe(item));
  } else items.forEach((item) => item.classList.add('is-visible'));
  const links = [...document.querySelectorAll('.award-nav-links a')];
  const sections = links.map((link) => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  const navObserver = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { links.forEach((link) => link.classList.toggle('is-current', link.getAttribute('href') === `#${entry.target.id}`)); } }), {rootMargin:'-35% 0px -55%'});
  sections.forEach((section) => navObserver.observe(section));
})();
