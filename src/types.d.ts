declare const chrome: {
  runtime: {
    getURL(path: string): string;
    lastError?: { message?: string };
    connect(connectInfo?: { name?: string }): chrome.runtime.Port;
    sendMessage(message: unknown): Promise<unknown>;
    getContexts(filter: { contextTypes?: string[] }): Promise<unknown[]>;
    onMessage: {
      addListener(
        callback: (
          message: { type?: string },
          sender: unknown,
          sendResponse: (response?: unknown) => void,
        ) => void | boolean,
      ): void;
    };
    onConnect: {
      addListener(callback: (port: chrome.runtime.Port) => void): void;
    };
    onInstalled: {
      addListener(callback: () => void): void;
    };
    onStartup: {
      addListener(callback: () => void): void;
    };
  };
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
  tabs: {
    query(queryInfo: { active?: boolean; currentWindow?: boolean }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: { type: string }): Promise<unknown>;
    onRemoved: {
      addListener(callback: (tabId: number) => void): void;
    };
  };
  action: {
    onClicked: {
      addListener(callback: () => void): void;
    };
  };
  commands: {
    onCommand: {
      addListener(callback: (command: string) => void): void;
    };
  };
  offscreen: {
    hasDocument?: () => Promise<boolean>;
    createDocument(options: {
      url: string;
      reasons: string[];
      justification: string;
    }): Promise<void>;
    closeDocument(): Promise<void>;
  };
};

declare namespace chrome.runtime {
  interface Port {
    name: string;
    sender?: { tab?: { id?: number } };
    postMessage(message: unknown): void;
    onMessage: {
      addListener(callback: (message: any) => void): void;
      removeListener(callback: (message: any) => void): void;
    };
    onDisconnect: {
      addListener(callback: () => void): void;
      removeListener(callback: () => void): void;
    };
  }
}

interface Navigator {
  gpu?: {
    requestAdapter(): Promise<unknown>;
  };
}
