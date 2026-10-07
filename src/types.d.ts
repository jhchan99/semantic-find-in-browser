declare const chrome: {
  runtime: {
    getURL(path: string): string;
    onMessage: {
      addListener(callback: (message: { type?: string }) => void): void;
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
};
