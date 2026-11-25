import { fontStack } from '../../engine/design/doc';
import type { KitFont } from '../../engine/libraryTypes';

/** An attached font, shown in itself. */
export function FontThumb({ font }: { font: KitFont }) {
  return <span className="attach-font" role="img" aria-label={font.name} data-tip={font.name} style={{ fontFamily: fontStack(font.family), fontWeight: font.weight }}>Aa</span>;
}
