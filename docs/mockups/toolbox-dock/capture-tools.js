(async () => {
  const W = (ms) => new Promise((r) => setTimeout(r, ms));
  const P = () => document.querySelector('.sidebar-tool-settings');
  const tab = document.querySelector('[role=tab][aria-label^="All the settings"]');
  if (tab) { tab.click(); await W(300); }
  const paint = [...document.querySelectorAll('*')].filter((x) => x.children.length === 0 && x.textContent.trim() === 'Paint 1').map((x) => x.closest('[role=option],li,[class*=layer-row],[class*=layer]')).filter(Boolean).pop();
  const names = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', sector: 'Sector', arc: 'Arc', chord: 'Chord', line: 'Straight line', curve: 'Curve', arrow: 'Arrow', fill: 'Fill', gradient: 'Gradient' };
  async function sel(id) {
    const d = document.querySelector(`[data-design-tool="${id}"]`);
    if (d) { if (d.disabled && paint) { paint.click(); await W(300); } if (d.getAttribute('aria-pressed') !== 'true') d.click(); await W(350); return; }
    const fill = id === 'fill' || id === 'gradient';
    const gb = [...document.querySelectorAll('.tool-group-btn')].find((b) => (fill ? /^Fill/ : /^Shapes/).test(b.getAttribute('aria-label')));
    gb.click(); await W(200);
    [...document.querySelectorAll('[role=menuitem],.menu-item')].find((m) => m.textContent.trim().startsWith(names[id])).click();
    await W(350);
  }
  async function pick(label, val) {
    const b = [...P().querySelectorAll('.opt-pick')].find((x) => x.querySelector('.opt-label')?.textContent.trim() === label);
    if (!b) return; b.click(); await W(250);
    const o = [...document.querySelectorAll('[role=option],[role=menuitemradio],[role=menuitem],.menu-item')].find((m) => m.textContent.trim().startsWith(val));
    if (o) o.click(); await W(300);
  }
  async function on(sel, txt) {
    const b = [...P().querySelectorAll(sel)].find((x) => (x.getAttribute('aria-label') || x.textContent).trim().startsWith(txt));
    if (b && b.getAttribute('aria-checked') !== 'true' && !b.classList.contains('is-on')) { b.click(); await W(300); }
  }
  function grab(el) {
    const c = el.cloneNode(true);
    const src = [...el.querySelectorAll('canvas')];
    [...c.querySelectorAll('canvas')].forEach((cv, i) => { const img = document.createElement('img'); img.className = cv.className; img.width = src[i].width; img.height = src[i].height; img.src = src[i].toDataURL('image/webp', 0.8); cv.replaceWith(img); });
    return c.outerHTML;
  }
  const out = {};
  for (const id of ['move', 'hand', 'fill', 'gradient', 'text', 'ruler', 'ellipse', 'polygon', 'star', 'sector', 'arc', 'chord', 'line', 'curve', 'arrow']) { await sel(id); out[id] = grab(P()); }
  await sel('select'); out.select = grab(P()); await pick('Shape', 'Magic wand'); out.selectWand = grab(P()); await pick('Shape', 'Rectangle');
  await sel('lineart'); out.lineart = grab(P()); await pick('Texture', 'Pencil grain'); out.lineartTex = grab(P()); await pick('Texture', 'Solid ink');
  await sel('rect'); await on('.opt-choices button', 'Miter join'); await pick('Dashes', 'Dashes'); out.rect = grab(P()); await on('.opt-choices button', 'Round join'); await pick('Dashes', 'Solid');
  for (const id of ['brush', 'eraser']) { await sel(id); await on('.opt-toggle', 'Simulate pressure'); await on('.opt-toggle', 'Advanced settings'); out[id] = grab(P()); }
  await sel('move');
  for (const name of ['Snap', 'Transform']) {
    const b = [...P().querySelectorAll('button')].find((x) => x.textContent.trim() === name || (x.getAttribute('aria-label') || '').startsWith(name));
    const before = new Set(document.querySelectorAll('.popover,[role=dialog],[role=menu]'));
    b.click(); await W(300);
    const pop = [...document.querySelectorAll('.popover,[role=dialog],[role=menu]')].find((x) => !before.has(x));
    out[name.toLowerCase() + 'Pop'] = pop ? pop.outerHTML : '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await W(200);
  }
  return JSON.stringify(out);
})()
