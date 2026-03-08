const {
  generateJSONExport,
  generateCSVExport,
  generateMarkdownExport,
  generateTextExport
} = require('./src/export/index.js');

const fixtures = [
  {
    id: 'x:1',
    platform: 'x',
    target: 'bookmark',
    postedAt: '2024-01-01T00:00:00.000Z',
    capturedAt: '2024-01-02T00:00:00.000Z',
    author: { username: 'a', displayName: 'Author A' },
    text: 'bookmark text',
    media: [{ type: 'photo', url: 'https://img.test/1.jpg' }],
    metrics: { likes: 1, replies: 3, views: 4, platform: { retweets: 2 } },
    url: 'https://x.com/a/status/1'
  },
  {
    id: 'instagram:abc',
    platform: 'instagram',
    target: 'saved',
    postedAt: null,
    capturedAt: '2024-01-03T00:00:00.000Z',
    author: { username: 'b', displayName: 'Author B' },
    text: 'saved post',
    media: [],
    metrics: { likes: null, replies: null, views: null, platform: {} },
    url: 'https://www.instagram.com/p/abc/'
  }
];

describe('exporters', () => {
  test('generateJSONExport includes metadata and records', () => {
    const out = generateJSONExport(fixtures, { platform: 'all', target: 'all' });
    expect(out.metadata.totalRecords).toBe(2);
    expect(out.records).toHaveLength(2);
  });

  test('generateCSVExport includes canonical multi-platform columns', () => {
    const out = generateCSVExport(fixtures, { platform: 'all', target: 'all' });
    expect(out).toContain('platform');
    expect(out).toContain('target');
    expect(out).toContain('postedAt');
    expect(out).toContain('saved post');
  });

  test('generateMarkdownExport includes neutral labels', () => {
    const out = generateMarkdownExport(fixtures, { platform: 'all', target: 'all' });
    expect(out).toContain('Social Export Report');
    expect(out).toContain('Posted At');
    expect(out).toContain('Platform: instagram');
  });

  test('generateTextExport handles missing values safely', () => {
    const out = generateTextExport(fixtures, { platform: 'instagram', target: 'saved' });
    expect(out).toContain('Posted At: N/A');
    expect(out).toContain('Author: Author B (@b)');
    expect(out).toContain('URL: https://www.instagram.com/p/abc/');
  });
});
