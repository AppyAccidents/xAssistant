const { migrateLegacyStorage } = require('./src/storage/migration.js');

describe('storage migration', () => {
  test('migrates legacy bookmarks into v2 state', () => {
    const legacy = {
      lastExtraction: {
        bookmarks: [
          {
            url: 'https://x.com/user/status/11',
            text: 'legacy bookmark',
            username: 'user',
            displayName: 'User',
            dateTime: '2024-01-01T00:00:00.000Z',
            likes: '12'
          }
        ]
      },
      manualBookmarks: [
        {
          url: 'https://x.com/user/status/22',
          text: 'manual bookmark',
          username: 'user',
          displayName: 'User',
          savedAt: '2024-01-02T00:00:00.000Z',
          source: 'manual'
        }
      ]
    };

    const state = migrateLegacyStorage(legacy);

    expect(state.storageVersion).toBe(2);
    expect(state.recordOrder.length).toBe(2);
    expect(Object.keys(state.recordsById).length).toBe(2);
    expect(state.settings.username).toBe('');
  });
});
