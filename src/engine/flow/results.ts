// Result ports and the «no result» marker: kept apart from graph.ts so the history can use them without importing the whole graph layer.
/** A node with several results has one output port per result (`out-2` = the second), like Houdini/Nuke outputs. */
export const resultHandle = (index: number) => `out-${index + 1}`;
/**
 * A link whose image was deleted: it keeps `outputIndex: NO_RESULT`, an index no result can ever have, so it delivers
 * nothing (the input shows «no output») until the user connects it again. Never a position past the last result: when the
 * node regenerates, that position would become valid and the link would silently deliver another image.
 */
export const NO_RESULT = -1;
export const GONE_HANDLE = 'out-gone';
