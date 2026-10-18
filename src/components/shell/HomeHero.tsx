import { useEffect, useState, type ReactNode } from 'react';
import { SPACES, newCanvas, newDesign } from './navModel';
import { HomeBar } from './HomeBar';

const INTERVAL_MS = 7000;

/** The mode mark of each slide, line style from the mockup: a sparkle (Studio), a node mesh (Canvas), a pen nib on a bezier (Designer). */
function HeroMark({ index }: { index: number }) {
  const common = { className: 'home-hero-mi', viewBox: '0 0 80 80', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (index === 0) return <svg {...common}><path d="M30 10c2 16 6 20 22 22-16 2-20 6-22 22-2-16-6-20-22-22 16-2 20-6 22-22z" /><path d="M58 40c1 9 3 11 12 12-9 1-11 3-12 12-1-9-3-11-12-12 9-1 11-3 12-12z" /></svg>;
  if (index === 1) return <svg {...common}>
    <path d="M14 14H40M40 14H66M14 40H40M40 40H66M14 66H40M40 66H66M14 14V40M40 14V40M66 14V40M14 40V66M40 40V66M66 40V66" />
    <path d="M14 14L40 40L66 66M66 14L40 40L14 66" opacity=".6" />
    {[14, 40, 66].flatMap((x) => [14, 40, 66].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" />))}
  </svg>;
  return <svg {...common}>
    <path d="M12 62C16 30 40 14 66 20" /><path d="M12 62h14M66 20v14" opacity=".6" />
    <rect x="8" y="58" width="8" height="8" rx="1" /><rect x="62" y="16" width="8" height="8" rx="1" />
    <path d="M40 30l12 24-12 6-12-6z" /><path d="M40 60V44" /><circle cx="40" cy="42" r="2.5" />
  </svg>;
}
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
    const on = i === index;
    return <section className={`home-hero-slide ${on ? 'is-on' : ''}`} aria-hidden={!on} aria-label={title}>
      <HeroMark index={i} />
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
