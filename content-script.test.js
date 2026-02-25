const { parseNetworkPayload } = require('./src/extraction/parser-network.js');
const { ExtractionEngine } = require('./src/extraction/engine.js');
const { parseVisibleArticles } = require('./src/extraction/parser-dom.js');

describe('Extraction modules', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('parseNetworkPayload extracts tweet, metrics, and high bitrate media', () => {
    const payload = {
      data: {
        entries: [
          {
            content: {
              itemContent: {
                tweet_results: {
                  result: {
                    legacy: {
                      id_str: '12345',
                      full_text: 'Hello from network',
                      created_at: 'Wed Oct 10 20:19:24 +0000 2018',
                      favorite_count: 100,
                      retweet_count: 10,
                      reply_count: 2,
                      extended_entities: {
                        media: [
                          {
                            type: 'video',
                            media_url_https: 'https://img.test/preview.jpg',
                            video_info: {
                              variants: [
                                { content_type: 'video/mp4', bitrate: 320000, url: 'https://video-low.mp4' },
                                { content_type: 'video/mp4', bitrate: 1500000, url: 'https://video-high.mp4' }
                              ]
                            }
                          }
                        ]
                      }
                    },
                    core: {
                      user_results: {
                        result: {
                          legacy: {
                            screen_name: 'tester',
                            name: 'Tester'
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        ]
      }
    };

    const records = parseNetworkPayload(payload, 'https://x.com/i/api/graphql/Likes');
    expect(records).toHaveLength(1);
    expect(records[0].url).toBe('https://x.com/tester/status/12345');
    expect(records[0].scope).toBe('like');
    expect(records[0].media[0].url).toBe('https://video-high.mp4');
  });

  test('parseVisibleArticles extracts record data from DOM', () => {
    document.body.innerHTML = `
      <article>
        <a href="https://x.com/tester/status/987">tweet</a>
        <span>Tester</span>
        <span>@tester</span>
        <div data-testid="tweetText">DOM text</div>
        <time datetime="2024-01-01T00:00:00.000Z">Jan 1</time>
        <div data-testid="like">1.2K</div>
        <div data-testid="retweet">23</div>
        <div data-testid="reply">8</div>
      </article>
    `;

    const result = parseVisibleArticles('bookmarks', '/i/bookmarks');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].metrics.likes).toBe(1200);
    expect(result.records[0].author.username).toBe('tester');
  });

  test('ExtractionEngine throws route mismatch', async () => {
    window.history.pushState({}, '', '/i/bookmarks');
    const engine = new ExtractionEngine({ maxLoops: 1, stableLoops: 1, scrollDelay: 1 });

    await expect(
      engine.extract({
        scope: 'likes',
        mode: 'full',
        runId: 'run-1',
        getNetworkRecords: () => [],
        isCancelled: () => false,
        onProgress: jest.fn()
      })
    ).rejects.toThrow('Route mismatch');
  });
});
