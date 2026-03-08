const { migrateLegacyStorage } = require('./src/storage/migration.js');

describe('storage migration', () => {
  test('migrates legacy bookmarks into v3 state', () => {
    const migrated = migrateLegacyStorage({
      lastExtraction: {
        bookmarks: [
          {
            url: 'https://x.com/user/status/11',
            username: 'user',
            displayName: 'User',
            text: 'hello'
          }
        ]
      }
    });

    expect(migrated.storageVersion).toBe(3);
    expect(Object.values(migrated.recordsById)).toHaveLength(1);
    expect(Object.values(migrated.recordsById)[0].platform).toBe('x');
    expect(Object.values(migrated.recordsById)[0].target).toBe('bookmark');
  });

  test('migrates existing v2 settings into platform settings', () => {
    const migrated = migrateLegacyStorage({
      xAssistantState: {
        storageVersion: 2,
        recordsById: {
          '22': {
            id: '22',
            url: 'https://x.com/user/status/22',
            scope: 'bookmark',
            tweetPostedAt: '2024-01-01T00:00:00.000Z',
            capturedAt: '2024-01-02T00:00:00.000Z',
            author: { username: 'user', displayName: 'User' },
            text: 'migrated',
            media: [],
            metrics: { likes: 1, retweets: 2, replies: 3, views: 4 },
            source: { route: '/i/bookmarks', via: 'dom' }
          }
        },
        recordOrder: ['22'],
        settings: { username: 'tester', onboardingSeen: true, guideVersion: 1 },
        runs: []
      }
    });

    expect(migrated.settings.settingsByPlatform.x.username).toBe('tester');
    expect(migrated.settings.guideVersion).toBe(1);
    expect(Object.values(migrated.recordsById)[0].postedAt).toBe('2024-01-01T00:00:00.000Z');
  });
});
