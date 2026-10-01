(() => {
  document.querySelectorAll('.mm-showcase').forEach(section => {
    const buttons = section.querySelectorAll('[data-mm-category]');
    const cards = [...section.querySelectorAll('[data-mm-group]')];
    const search = section.querySelector('[data-mm-search]');
    const result = section.querySelector('[data-mm-result]');
    const update = () => {
      const category = section.querySelector('[data-mm-category].is-active')?.dataset.mmCategory || '全部';
      const query = (search?.value || '').trim().toLowerCase();
      let shown = 0;
      cards.forEach(card => {
        const matchesCategory = category === '全部' || card.dataset.mmGroup === category;
        const matchesSearch = !query || card.textContent.toLowerCase().includes(query);
        const visible = matchesCategory && matchesSearch;
        card.hidden = !visible;
        if (visible) shown += 1;
      });
      if (result) result.textContent = query ? `找到 ${shown} 张截图` : `显示 ${shown === cards.length ? '全部' : shown} 张`;
    };
    buttons.forEach(button => button.addEventListener('click', () => {
      buttons.forEach(item => item.classList.toggle('is-active', item === button));
      update();
    }));
    search?.addEventListener('input', update);
    update();
  });
})();
