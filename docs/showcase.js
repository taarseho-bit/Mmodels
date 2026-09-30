(() => {
  document.querySelectorAll('.mm-showcase').forEach(section => {
    const buttons = section.querySelectorAll('[data-mm-category]');
    buttons.forEach(button => button.addEventListener('click', () => {
      buttons.forEach(item => item.classList.toggle('is-active', item === button));
      section.querySelectorAll('[data-mm-group]').forEach(card => {
        card.hidden = button.dataset.mmCategory !== '全部' && card.dataset.mmGroup !== button.dataset.mmCategory;
      });
    }));
  });
})();
