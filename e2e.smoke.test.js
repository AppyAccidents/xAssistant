const { StorageRepository } = require('./src/storage/repository.js');
const { generateCSVExport, generateTextExport } = require('./src/export/index.js');

describe('e2e smoke pipeline', () => {
  test('ingest -> export', async () => {
    const memory = {
      store: {},
      async get(keys) {
        if (Array.isArray(keys)) {
          const out = {};
          keys.forEach((key) => {
            out[key] = this.store[key];
          });
          return out;
        }

        return { [keys]: this.store[keys] };
      },
      async set(payload) {
        Object.assign(this.store, payload);
      }
    };

    const repo = new StorageRepository(memory);
    await repo.ensureInitialized();

    await repo.upsertRecords([
      {
        id: '1',
        url: 'https://x.com/a/status/1',
        scope: 'bookmark',
        capturedAt: '2024-01-01T00:00:00.000Z',
        tweetPostedAt: '2024-01-01T00:00:00.000Z',
        author: { username: 'a', displayName: 'A' },
        text: 'software launch update',
        media: [{ type: 'photo', url: 'https://img.test/a.jpg' }],
        metrics: { likes: 1, retweets: 2, replies: 3, views: 4 },
        source: { route: '/i/bookmarks', via: 'dom' }
      }
    ]);

    const query = await repo.queryRecords({ scope: 'all' });
    expect(query.total).toBe(1);

    const csv = generateCSVExport(query.records, { scope: 'all' });
    expect(csv).toContain('authorUsername');
    expect(csv).toContain('software launch update');

    const text = generateTextExport(query.records, { scope: 'all' });
    expect(text).toContain('X-Assistant Report');
    expect(text).toContain('URL: https://x.com/a/status/1');
  });
});
