(() => {
  const tabs = [...document.querySelectorAll('[data-case-tab]')];
  const panels = [...document.querySelectorAll('[data-case-panel]')];
  const selectCase = (tab) => {
    const name = tab.dataset.caseTab;
    tabs.forEach(item => {
      const active = item === tab;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach(panel => {
      const active = panel.dataset.casePanel === name;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectCase(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault(); selectCase(tabs[next]); tabs[next].focus();
    });
  });
  if (tabs[0]) selectCase(tabs.find(tab => tab.classList.contains('active')) || tabs[0]);

  const journeyCards = [...document.querySelectorAll('.journey-rail article')];
  journeyCards.forEach((card, index) => card.addEventListener('click', () => {
    journeyCards.forEach(item => item.classList.toggle('is-selected', item === card));
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
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
