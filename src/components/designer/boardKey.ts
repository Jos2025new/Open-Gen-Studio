/** Focus in a field or in a conversation (the side panel, the thread, the chat column): not the board's. */
export const offBoard = (e: Event): boolean =>
  e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable="true"], .node-side, .thread-peek, .thread-peek-folded, .chat-column');

/**
 * Whether a key press may act on the Designer board: not off the board (above), nor with a popover or lightbox open,
 * so a key meant for the chat never undoes, deletes or moves anything on the canvas.
 */
export function boardKey(e: Event): boolean {
  return !offBoard(e) && !document.querySelector('.popover:not(.designer-context), .lightbox');
}
