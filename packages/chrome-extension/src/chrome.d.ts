declare type RuntimePort = {
  name: string;
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
};

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    getURL(path: string): string;
    connect(connectInfo: { name: string }): RuntimePort;
    onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void;
    };
    onConnect: {
      addListener(listener: (port: RuntimePort) => void): void;
    };
  };
  tabs: {
    query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number; url?: string }>>;
    create(createProperties: { url: string; active?: boolean }): Promise<{ id?: number }>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
    onRemoved: {
      addListener(listener: (tabId: number) => void): void;
    };
  };
  devtools: {
    inspectedWindow: { tabId: number };
    network: {
      onNavigated: { addListener(listener: (url: string) => void): void };
    };
    panels: {
      create(title: string, iconPath: string, pagePath: string): void;
    };
  };
  storage: {
    session: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};
