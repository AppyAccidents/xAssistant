const { parseNetworkPayload } = require('./src/extraction/parser-network.js');
const { ExtractionEngine } = require('./src/extraction/engine.js');
const { parseVisibleArticles } = require('./src/extraction/parser-dom.js');
const {
  instagramAdapter,
  normalizeSavedHref,
  isCollectionIndexPage,
  isAllPostsGridPath,
  findAllPostsCollectionLink
} = require('./src/platforms/instagram.js');

describe('Extraction modules', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/');
  });

  test('parseNetworkPayload extracts x metrics and high bitrate media', () => {
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
    expect(records[0].target).toBe('like');
    expect(records[0].metrics.platform.retweets).toBe(10);
    expect(records[0].media[0].url).toBe('https://video-high.mp4');
  });

  test('parseVisibleArticles extracts x DOM data into canonical shape', () => {
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

    const result = parseVisibleArticles('x', 'bookmark', '/i/bookmarks');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].metrics.likes).toBe(1200);
    expect(result.records[0].author.username).toBe('tester');
    expect(result.records[0].target).toBe('bookmark');
  });

  test('normalizeSavedHref strips saved prefixes to canonical content URLs', () => {
    expect(normalizeSavedHref('/saved/reel/xyz987/?foo=1')).toBe('https://www.instagram.com/reel/xyz987/');
  });

  test('instagram collection index is detected from saved landing page', () => {
    window.history.pushState({}, '', '/berker.ceylan/saved/');
    document.body.innerHTML = `
      <main>
        <a href="/berker.ceylan/saved/">Saved</a>
        <a href="/berker.ceylan/saved/all-posts/" aria-label="All posts">All posts</a>
        <a href="/berker.ceylan/saved/japan/18152475295350143/" aria-label="Japan">Japan</a>
      </main>
    `;

    expect(isCollectionIndexPage(window.location.pathname, document)).toBe(true);
    const link = findAllPostsCollectionLink('berker.ceylan', document);
    expect(link.getAttribute('href')).toBe('/berker.ceylan/saved/all-posts/');
  });

  test('instagram waitForReady on collection index waits for all-posts link, not just any collection', async () => {
    window.history.pushState({}, '', '/berker.ceylan/saved/');
    document.body.innerHTML = `
      <main>
        <a href="/berker.ceylan/saved/">Saved</a>
      </main>
    `;

    setTimeout(() => {
      document.querySelector('main').insertAdjacentHTML(
        'beforeend',
        '<a href="/berker.ceylan/saved/all-posts/" aria-label="All posts">All posts</a>'
      );
    }, 50);

    await expect(
      instagramAdapter.waitForReady('saved', {
        input: { username: 'berker.ceylan' },
        onProgress: jest.fn(),
        timeoutMs: 500
      })
    ).resolves.toBeUndefined();
  });

  test('instagram all-posts grid path is recognized', () => {
    expect(isAllPostsGridPath('/berker.ceylan/saved/all-posts/')).toBe(true);
    expect(isAllPostsGridPath('/berker.ceylan/saved/')).toBe(false);
  });

  test('instagram adapter parses real all-posts article anchors', () => {
    document.body.innerHTML = `
      <main>
        <article>
          <div>
            <div>
              <div class="_ac7v x1ty9z65 xzboxd6">
                <div class="x1lliihq x1n2onr6 xh8yej3 x4gyw5p">
                  <a href="/p/DAWqrlKAm6v/" aria-label="Video">
                    <div class="_aagu">
                      <div class="_aagv">
                        <img src="https://img.test/one.jpg" />
                      </div>
                    </div>
                  </a>
                </div>
              </div>
            </div>
          </div>
        </article>
      </main>
    `;

    const result = instagramAdapter.parseDom('saved', '/berker.ceylan/saved/all-posts/');
    expect(result.records).toHaveLength(1);
    expect(result.records[0].url).toBe('https://www.instagram.com/p/DAWqrlKAm6v/');
    expect(result.records[0].media[0].url).toBe('https://img.test/one.jpg');
  });

  test('instagram adapter preparePage navigates to all-posts route', async () => {
    document.body.innerHTML = `
      <main>
        <a href="/berker.ceylan/saved/all-posts/" aria-label="All posts">All posts</a>
      </main>
    `;

    const assigned = [];
    window.history.pushState({}, '', '/berker.ceylan/saved/');
    const navigate = (value) => {
      assigned.push(value);
      window.history.pushState({}, '', '/berker.ceylan/saved/all-posts/');
    };

    await instagramAdapter.preparePage('saved', {
      input: { username: 'berker.ceylan' },
      onProgress: jest.fn(),
      navigate
    });

    expect(assigned[0]).toBe('https://www.instagram.com/berker.ceylan/saved/all-posts/');
  });

  test('instagram waitForReady fails with grid-empty error on all-posts route without items', async () => {
    window.history.pushState({}, '', '/berker.ceylan/saved/all-posts/');
    await expect(
      instagramAdapter.waitForReady('saved', {
        input: { username: 'berker.ceylan' },
        onProgress: jest.fn(),
        timeoutMs: 20
      })
    ).rejects.toMatchObject({ code: 'INSTAGRAM_GRID_EMPTY' });
  });

  test('ExtractionEngine throws route mismatch', async () => {
    window.history.pushState({}, '', '/i/bookmarks');
    const engine = new ExtractionEngine({ maxLoops: 1, stableLoops: 1, scrollDelay: 1 });

    await expect(
      engine.extract({
        platform: 'x',
        target: 'like',
        mode: 'full',
        runId: 'run-1',
        getNetworkRecords: () => [],
        isCancelled: () => false,
        onProgress: jest.fn()
      })
    ).rejects.toThrow('Route mismatch');
  });
});
