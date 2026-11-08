declare module 'opentype.js' {
  export interface Path { toPathData(decimalPlaces?: number): string }
  export interface Font {
    getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean; letterSpacing?: number }): Path;
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean; letterSpacing?: number }): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
