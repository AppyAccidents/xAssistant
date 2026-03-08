const {
  validateExtractionStart,
  validateDataQuery,
  normalizeRecord,
  validateRecord,
  getDefaultState,
  validateStorageState
} = require('./src/core/contracts/index.js');

describe('contracts', () => {
  test('validateExtractionStart validates platform and target', () => {
    const valid = validateExtractionStart({ platform: 'x', target: 'bookmark', mode: 'full' });
    expect(valid.valid).toBe(true);

    const invalid = validateExtractionStart({ platform: 'instagram', target: 'like' });
    expect(invalid.valid).toBe(false);
  });

  test('instagram saved remains a valid extraction target', () => {
    const valid = validateExtractionStart({ platform: 'instagram', target: 'saved', mode: 'full' });
    expect(valid.valid).toBe(true);
  });

  test('validateDataQuery normalizes pagination defaults', () => {
    const result = validateDataQuery({ platform: 'all', target: 'all', page: {} });
    expect(result.valid).toBe(true);
    expect(result.value.page.limit).toBe(5000);
  });

  test.each([
    {
      name: 'x bookmark',
      input: {
        platform: 'x',
        target: 'bookmark',
        url: 'https://x.com/test/status/123',
        author: { username: 'test', displayName: 'Test' },
        text: 'hello',
        media: [{ type: 'animated_gif', url: 'https://gif.mp4' }],
        metrics: { likes: '10', platform: { retweets: '2' } },
        source: { route: '/i/bookmarks', via: 'network' }
      }
    },
    {
      name: 'instagram saved',
      input: {
        platform: 'instagram',
        target: 'saved',
        url: 'https://www.instagram.com/p/abc123/',
        author: { username: 'iguser', displayName: 'IG User' },
        text: 'saved post'
      }
    }
  ])('normalizeRecord produces valid canonical record for %s', ({ input }) => {
    const normalized = normalizeRecord(input);
    const validation = validateRecord(normalized);

    expect(validation.valid).toBe(true);
    expect(normalized.media?.[0]?.type || 'photo').toBeDefined();
  });

  test('default state validates as storage v3', () => {
    const state = getDefaultState();
    const validation = validateStorageState(state);
    expect(validation.valid).toBe(true);
    expect(state.settings.settingsByPlatform.x.username).toBe('');
    expect(state.settings.guideVersion).toBe(2);
  });
});
