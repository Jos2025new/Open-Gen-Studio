/** An actionable error whose message is safe to show in the export panel. */
export class ExportError extends Error {}

export function exportError(error: unknown, message: string): ExportError {
  if (error instanceof ExportError) return error;
  console.error('[Designer export]', error);
  return new ExportError(message);
}
