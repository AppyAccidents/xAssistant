const {
  validateExtractionStart,
  validateDataQuery,
  normalizeTweetRecord,
  validateTweetRecordV2,
  getDefaultState,
  validateStorageStateV2
} = require('./src/core/contracts/index.js');

describe('contracts', () => {
  test('validateExtractionStart validates scope and mode', () => {
    const valid = validateExtractionStart({ scope: 'bookmarks', mode: 'full' });
    expect(valid.valid).toBe(true);

    const invalid = validateExtractionStart({ scope: 'invalid' });
    expect(invalid.valid).toBe(false);
  });

  test('validateDataQuery normalizes pagination defaults', () => {
    const result = validateDataQuery({ scope: 'all', page: {} });
    expect(result.valid).toBe(true);
    expect(result.value.page.limit).toBe(5000);
  });

  test('normalizeTweetRecord produces valid TweetRecordV2', () => {
    const normalized = normalizeTweetRecord({
      url: 'https://x.com/test/status/123',
      scope: 'bookmark',
      author: { username: 'test', displayName: 'Test' },
      text: 'hello',
      media: [{ type: 'animated_gif', url: 'https://gif.mp4' }],
      metrics: { likes: '10' },
      source: { route: '/i/bookmarks', via: 'network' }
    });

    const validation = validateTweetRecordV2(normalized);
    expect(validation.valid).toBe(true);
    expect(normalized.media[0].type).toBe('gif');
    expect(normalized.metrics.likes).toBe(10);
  });

  test('default state validates as storage v2', () => {
    const state = getDefaultState();
    const validation = validateStorageStateV2(state);
    expect(validation.valid).toBe(true);
    expect(state.settings.onboardingSeen).toBe(false);
    expect(state.settings.guideVersion).toBe(1);
  });
});
