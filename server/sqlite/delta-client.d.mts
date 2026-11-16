export interface OrderMove {
  after: string | null;
  before: string | null;
  ids: string[];
}

export interface GlobalsDelta {
  full?: boolean;
  small?: string;
  up: {
    generations: Record<string, string>;
    assets: Record<string, string>;
    library: Record<string, string>;
  };
  del: {
    generations: string[];
    assets: string[];
    library: string[];
  };
  order?: {
    generations?: OrderMove[];
    assets?: OrderMove[];
    library?: OrderMove[];
  };
  spend: {
    append: string[];
    len: number;
  };
}

export function createDeltaClient(): {
  diff(g: Record<string, unknown>): GlobalsDelta;
  ack(): void;
};
