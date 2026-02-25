const listeners = {
  runtimeOnMessage: [],
  tabsOnUpdated: []
};

global.chrome = {
  storage: {
    local: {
      get: jest.fn(async () => ({})),
      set: jest.fn(async () => {}),
      remove: jest.fn(async () => {})
    }
  },
  runtime: {
    lastError: null,
    getURL: jest.fn((path) => path),
    sendMessage: jest.fn((message, callback) => {
      if (typeof callback === 'function') {
        callback({ success: true });
      }
      return Promise.resolve({ success: true });
    }),
    onMessage: {
      addListener: jest.fn((listener) => listeners.runtimeOnMessage.push(listener))
    },
    onInstalled: {
      addListener: jest.fn()
    }
  },
  tabs: {
    create: jest.fn(async ({ url }) => ({ id: 1, url })),
    remove: jest.fn(async () => {}),
    sendMessage: jest.fn(async () => ({ success: true })),
    createProperties: {},
    onUpdated: {
      addListener: jest.fn((listener) => listeners.tabsOnUpdated.push(listener)),
      removeListener: jest.fn((listener) => {
        const idx = listeners.tabsOnUpdated.indexOf(listener);
        if (idx >= 0) listeners.tabsOnUpdated.splice(idx, 1);
      })
    }
  }
};

global.fetch = jest.fn();

global.performance = {
  now: jest.fn(() => Date.now())
};

global.__testListeners = listeners;
