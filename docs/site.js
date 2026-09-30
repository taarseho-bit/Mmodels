(() => {
  const tabs = [...document.querySelectorAll('[data-case-tab]')];
  const panels = [...document.querySelectorAll('[data-case-panel]')];
  tabs.forEach(tab => tab.addEventListener('click', () => {
    const name = tab.dataset.caseTab;
    tabs.forEach(item => item.classList.toggle('active', item === tab));
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset.casePanel === name));
  }));
  const reveal = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); reveal.unobserve(entry.target); }
  }), { threshold: .08 });
  document.querySelectorAll('.cap-grid article,.feature-band,.vip,.trust-grid>div').forEach(el => {
    el.style.transition = 'opacity .55s ease, transform .55s ease'; el.style.opacity = '0'; el.style.transform = 'translateY(16px)';
    reveal.observe(el);
  });
  document.addEventListener('DOMContentLoaded', () => document.querySelectorAll('.is-visible').forEach(el => { el.style.opacity = '1'; el.style.transform = 'none'; }));
  const style = document.createElement('style'); style.textContent = '.is-visible{opacity:1!important;transform:none!important}'; document.head.append(style);
})();
