// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { jsPDF, GState } from 'jspdf';
import { svgIntoPdf } from '../src/engine/design/pdfLook';

/*
 * Ataques a pdfLook.ts por estructura (sin lector de PDF): qué recibe svg2pdf y qué estados escribe jsPDF.
 * svg2pdf se sustituye por una función que anota el árbol que le llega.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const parse = (s: string) => new DOMParser().parseFromString(`<svg xmlns="${SVG_NS}" width="200" height="120" viewBox="0 0 200 120">${s}</svg>`, 'image/svg+xml').documentElement;
const box = { x: 0, y: 0, width: 200, height: 120 };

async function run(markup: string) {
  const calls: string[] = [];
  const pdf = new jsPDF({ unit: 'px', format: [200, 120] });
  const svg2pdf = async (el: Element) => { calls.push(new XMLSerializer().serializeToString(el)); };
  // svgIntoPdf inserts its working copy next to the root, so the root sits inside a host element (as in svgToPdf).
  const host = document.createElement('div');
  document.body.append(host);
  host.append(document.importNode(parse(markup), true));
  await svgIntoPdf(pdf, GState as never, svg2pdf as never, host.firstElementChild!, box);
  host.remove();
  const text = new TextDecoder('latin1').decode(pdf.output('arraybuffer'));
  return { calls, text };
}
const GRADIENT = '<linearGradient id="g"><stop offset="0" stop-color="#f00" stop-opacity="0.2"/><stop offset="1" stop-color="#00f"/></linearGradient>';

describe('pdfLook: lo que se dibuja fuera de su grupo', () => {
  it.fails('un <defs> dentro de un grupo con opacidad sigue valiendo para formas fuera del grupo (SVG: los id son globales); pdfLook.ts paint() quita los defs al cerrar el grupo', async () => {
    // Causa: paint() mueve los hijos de <defs> a un ámbito y los borra al terminar el grupo.
    const { calls } = await run(`<g opacity="0.5"><defs><linearGradient id="gr"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect x="0" y="0" width="10" height="10" fill="#000"/></g><rect x="20" y="20" width="50" height="50" fill="url(#gr)"/>`);
    const outside = calls.find((c) => c.includes('x="20"')) ?? '';
    expect(outside).toContain('id="gr"');
  });

  it('un <defs> en la raíz sigue disponible para todo el documento (regresión)', async () => {
    const { calls } = await run(`<defs><linearGradient id="gr"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><g opacity="0.5"><rect x="0" y="0" width="10" height="10" fill="#000"/></g><rect x="20" y="20" width="50" height="50" fill="url(#gr)"/>`);
    expect(calls.find((c) => c.includes('x="20"')) ?? '').toContain('id="gr"');
  });
});

describe('pdfLook: entradas raras de opacidad y mezcla', () => {
  it.fails('opacidad en el atributo y en style= distintas: gana style (CSS), que es lo que se ve (pdfLook.ts lookOf lee primero el atributo)', async () => {
    // Causa: lookOf usa el atributo opacity antes que style="opacity:"; con opacity="1" el 0.3 se pierde.
    const { text } = await run(`<g opacity="1" style="opacity:0.3"><rect x="0" y="0" width="10" height="10" fill="#000"/></g>`);
    expect(text).toContain('/ca 0.3');
  });

  it.fails('opacidad en porcentaje ("50%") se lee como 50 y se recorta a 1: el grupo no se hace (pdfLook.ts lookOf)', async () => {
    // Causa: parseFloat("50%") = 50, que se limita a 1; el porcentaje válido de SVG 2 se pierde.
    const { text } = await run(`<g opacity="50%"><rect x="0" y="0" width="10" height="10" fill="#000"/></g>`);
    expect(text).toContain('/ca 0.5');
  });

  it('opacidad 0 deja el grupo en /ca 0 (sin dibujar), y una opacidad no numérica no crea grupo', async () => {
    expect((await run(`<g opacity="0"><rect x="0" y="0" width="10" height="10" fill="#000"/></g>`)).text).toContain('/ca 0 /CA 0');
    expect((await run(`<g opacity="abc"><rect x="0" y="0" width="10" height="10" fill="#000"/></g>`)).text).not.toContain('/OGs0');
  });

  it('un modo de mezcla desconocido no crea grupo; uno conocido sí', async () => {
    expect((await run(`<rect x="0" y="0" width="10" height="10" fill="#000" style="mix-blend-mode:xor"/>`)).text).not.toContain('/BM');
    expect((await run(`<rect x="0" y="0" width="10" height="10" fill="#000" style="mix-blend-mode:multiply"/>`)).text).toContain('/BM /Multiply');
  });

  it('lo que está dentro de <clipPath> o <marker> no abre grupos de transparencia', async () => {
    const { text } = await run(`<defs><clipPath id="c"><rect x="0" y="0" width="10" height="10" opacity="0.5"/></clipPath></defs><rect x="0" y="0" width="10" height="10" fill="#000" clip-path="url(#c)"/>`);
    expect(text).not.toContain('/ca 0.5');
  });

  it('muchos grupos anidados (30 niveles) no revientan la recursión y cada nivel es un grupo', async () => {
    let body = '<rect x="0" y="0" width="10" height="10" fill="#000"/>';
    for (let i = 0; i < 30; i++) body = `<g opacity="0.9">${body}</g>`;
    const { calls, text } = await run(body);
    expect(calls.length).toBeGreaterThan(0);
    expect(text.match(/\/S \/Transparency/g)?.length ?? 0).toBeGreaterThanOrEqual(30);
  });
});

describe('pdfLook: degradados con alfa', () => {
  it.fails('un degradado con alfa usado desde style="fill:url(#g)" conserva su alfa (pdfLook.ts alphaGradients solo mira el atributo fill)', async () => {
    // Causa: alphaGradients quita stop-opacity de los degradados aunque la forma lo use por style; sale opaco.
    const { text } = await run(`<defs>${GRADIENT}</defs><rect x="0" y="0" width="50" height="50" style="fill:url(#g)"/>`);
    expect(text).toContain('/SMask');
  });

  it('un degradado con alfa usado por atributo fill se convierte en máscara de luminosidad (/SMask en el PDF)', async () => {
    const { text } = await run(`<defs>${GRADIENT}</defs><rect x="0" y="0" width="50" height="50" fill="url(#g)"/>`);
    expect(text).toContain('/SMask');
  });

  it('un degradado opaco no cambia el dibujo: ninguna forma recibe máscara', async () => {
    const opaque = GRADIENT.replace('stop-opacity="0.2"', '');
    const { text } = await run(`<defs>${opaque}</defs><rect x="0" y="0" width="50" height="50" fill="url(#g)"/>`);
    expect(text).not.toContain('/SMask');
  });
});
