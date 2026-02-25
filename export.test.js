const {
  generateJSONExport,
  generateCSVExport,
  generateMarkdownExport,
  generateTextExport
} = require('./src/export/index.js');

const fixtures = [
  {
    id: '1',
    scope: 'bookmark',
    tweetPostedAt: '2024-01-01T00:00:00.000Z',
    capturedAt: '2024-01-02T00:00:00.000Z',
    author: { username: 'a', displayName: 'Author A' },
    text: 'bookmark text',
    media: [{ type: 'photo', url: 'https://img.test/1.jpg' }],
    metrics: { likes: 1, retweets: 2, replies: 3, views: 4 },
    url: 'https://x.com/a/status/1'
  },
  {
    id: '2',
    scope: 'like',
    tweetPostedAt: null,
    capturedAt: '2024-01-03T00:00:00.000Z',
    author: { username: 'b', displayName: 'Author B' },
    text: 'like text',
    media: [],
    metrics: { likes: null, retweets: null, replies: null, views: null },
    url: 'https://x.com/b/status/2'
  }
];

describe('exporters', () => {
  test('generateJSONExport includes metadata and records', () => {
    const out = generateJSONExport(fixtures, { scope: 'all' });
    expect(out.metadata.totalRecords).toBe(2);
    expect(out.records).toHaveLength(2);
  });

  test('generateCSVExport includes core extraction columns only', () => {
    const out = generateCSVExport(fixtures, { scope: 'all' });
    expect(out).toContain('tweetPostedAt');
    expect(out).toContain('authorUsername');
    expect(out).toContain('bookmark text');
    expect(out).not.toContain('aiCategories');
  });

  test('generateMarkdownExport includes required record details', () => {
    const out = generateMarkdownExport(fixtures, { scope: 'bookmarks' });
    expect(out).toContain('Tweet Time');
    expect(out).toContain('Author A (@a)');
    expect(out).toContain('Media');
  });

  test('generateTextExport handles missing values safely', () => {
    const out = generateTextExport(fixtures, { scope: 'likes' });
    expect(out).toContain('Tweet Time: N/A');
    expect(out).toContain('Author: Author B (@b)');
    expect(out).toContain('URL: https://x.com/b/status/2');
  });
});
