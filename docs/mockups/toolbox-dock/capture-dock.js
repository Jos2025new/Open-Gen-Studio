(async () => {
  const W = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};
  const popOf = async (b) => { const before = new Set(document.querySelectorAll('.popover,[role=dialog],[role=menu]')); b.click(); await W(350); const p = [...document.querySelectorAll('.popover,[role=dialog],[role=menu]')].find((x) => !before.has(x)); const h = p ? p.outerHTML : ''; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await W(250); return h; };
  document.querySelector('[data-design-tool="brush"]').click(); await W(350);
  const pal = document.querySelector('.designer-palette'); out.palette = pal ? pal.outerHTML : '';
  out.paletteClass = pal ? pal.className + ' :: ' + pal.parentElement.className : '';
  const plus = document.querySelector('.composer-options-trigger'); out.plusBtn = plus.outerHTML; out.composerBar = plus.closest('.composer-bar').className; out.plusPop = await popOf(plus);
  const cs = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Canvas size')); out.sizeBtn = cs.outerHTML; out.sizePop = await popOf(cs);
  out.layerActions = document.querySelector('.layer-actions').outerHTML;
  return JSON.stringify(out);
})()
