export function statistics(values: unknown[], duration?: boolean): {
  conocidas: number; desconocidas: number; mediana: number | string; p90: number | string; porcentajeMayor30s?: number | string;
};
export function extractBaseline(saved: unknown): {
  sesiones: number; muestras: number; suficiente: boolean; limites: string[];
  peticiones: Array<Record<string, string | number>>;
  grupos: Array<{ modelo: string; tipo: string; muestras: number; metricas: Record<string, ReturnType<typeof statistics>> }>;
};
export function readSandboxBaseline(root: string, input?: string): Promise<ReturnType<typeof extractBaseline>>;
