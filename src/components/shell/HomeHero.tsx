import { useEffect, useState, type ReactNode } from 'react';
import { SPACES, newCanvas, newDesign } from './navModel';
import { HomeBar } from './HomeBar';

const INTERVAL_MS = 7000;
const reducedMotion = (): boolean => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

/** Three slides (Studio, Canvas, Designer) that rotate every 7 s. Paused by hover or focus, never under reduced motion. */
export function HomeHero() {
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [reduced] = useState(reducedMotion);
  const playing = !hover && !focus && !reduced;

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % SPACES.length), INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [playing, index]);

  const slide = (i: number, title: string, body: ReactNode) => {
    const Icon = SPACES[i].icon;
    const on = i === index;
    return <section className={`home-hero-slide ${on ? 'is-on' : ''}`} aria-hidden={!on} aria-label={title}>
      <Icon className="home-hero-mi" size={76} strokeWidth={1.5} aria-hidden />
      <h2 className="home-hero-word">{title}</h2>
      {body}
    </section>;
  };

  return <div className="home-hero" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    onFocus={() => setFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }}>
    <div className="home-hero-dots" role="tablist" aria-label="Home hero">
      {SPACES.map((s, i) => <button key={s.id} type="button" role="tab" className={`home-hero-dot ${i === index ? 'is-on' : ''}`} aria-selected={i === index} aria-label={s.label} onClick={() => setIndex(i)} />)}
    </div>
    <div className="home-hero-slides">
      {slide(0, 'Studio', <HomeBar />)}
      {slide(1, 'Canvas', <button type="button" className="home-newbox" onClick={newCanvas}>+ New canvas</button>)}
      {slide(2, 'Designer', <button type="button" className="home-newbox" onClick={newDesign}>+ New design</button>)}
    </div>
  </div>;
}
