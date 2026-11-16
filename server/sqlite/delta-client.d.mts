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
    sessions?: string[];
  };
  order?: {
    generations?: OrderMove[];
    assets?: OrderMove[];
    library?: OrderMove[];
    sessions?: OrderMove[];
  };
  spend: {
    append: string[];
    len: number;
    from?: number;
  };
}

export function createDeltaClient(): {
  diff(g: Record<string, unknown>, sessionOrder?: string[], sessionUpKeys?: string[]): GlobalsDelta;
  ack(): void;
  markUnconfirmed(): void;
};
