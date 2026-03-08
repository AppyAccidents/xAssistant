const { StorageRepository } = require('./src/storage/repository.js');
const { generateCSVExport, generateTextExport } = require('./src/export/index.js');

describe('mixed-platform smoke pipeline', () => {
  test('ingest -> query -> export mixed records', async () => {
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
        id: 'x:1',
        platform: 'x',
        target: 'bookmark',
        url: 'https://x.com/a/status/1',
        capturedAt: '2024-01-01T00:00:00.000Z',
        postedAt: '2024-01-01T00:00:00.000Z',
        author: { username: 'a', displayName: 'A' },
        text: 'software launch update',
        media: [{ type: 'photo', url: 'https://img.test/a.jpg' }],
        metrics: { likes: 1, replies: 3, views: 4, platform: { retweets: 2 } },
        source: { route: '/i/bookmarks', via: 'dom' }
      },
      {
        id: 'instagram:abc',
        platform: 'instagram',
        target: 'saved',
        url: 'https://www.instagram.com/p/abc/',
        capturedAt: '2024-01-02T00:00:00.000Z',
        author: { username: 'b', displayName: 'B' },
        text: 'saved travel post',
        media: [{ type: 'photo', url: 'https://img.test/b.jpg' }],
        metrics: {},
        source: { route: '/saved/all-posts', via: 'dom' }
      }
    ]);

    const query = await repo.queryRecords({ platform: 'all', target: 'all' });
    expect(query.total).toBe(2);

    const csv = generateCSVExport(query.records, { platform: 'all', target: 'all' });
    expect(csv).toContain('authorUsername');
    expect(csv).toContain('saved travel post');

    const text = generateTextExport(query.records, { platform: 'all', target: 'all' });
    expect(text).toContain('Social Export Report');
    expect(text).toContain('URL: https://www.instagram.com/p/abc/');
  });
});
