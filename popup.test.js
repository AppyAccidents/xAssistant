const { PopupApp, normalizeUsername } = require('./src/popup/index.js');

function setupDom() {
  document.body.innerHTML = `
    <main id="popupRoot">
      <p id="statusText"></p>
      <progress id="progressBar" value="0" max="100"></progress>
      <span id="progressLabel"></span>
      <button id="extractBookmarksBtn"></button>
      <button id="extractLikesBtn"></button>
      <button id="extractBothBtn"></button>
      <input id="usernameInput" />
      <select id="exportFormat">
        <option value="md">MD</option>
        <option value="csv">CSV</option>
        <option value="txt">TXT</option>
        <option value="json">JSON</option>
      </select>
      <button id="exportBtn"></button>
    </main>
  `;
}

describe('PopupApp minimal flow', () => {
  beforeEach(() => {
    setupDom();

    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type === 'XA_GET_SETTINGS') {
        callback({ success: true, settings: { username: 'user' } });
        return;
      }

      if (message.type === 'DATA_QUERY') {
        callback({ success: true, records: [], total: 2 });
        return;
      }

      if (message.type === 'XA_SAVE_SETTINGS') {
        callback({ success: true, settings: { username: message.payload.username } });
        return;
      }

      if (message.type === 'XA_START_EXTRACTION') {
        callback({ success: true, totalCount: 42, runId: 'run-1', durationMs: 1000 });
        return;
      }

      callback({ success: true });
    });
  });

  test('loads username and sets ready status', async () => {
    new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById('usernameInput').value).toBe('@user');
    expect(document.getElementById('statusText').textContent).toContain('Ready');
  });

  test('keeps only required controls in popup contract', async () => {
    new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const requiredIds = [
      'extractBookmarksBtn',
      'extractLikesBtn',
      'extractBothBtn',
      'usernameInput',
      'exportFormat',
      'exportBtn',
      'statusText',
      'progressBar',
      'progressLabel'
    ];

    requiredIds.forEach((id) => {
      expect(document.getElementById(id)).toBeTruthy();
    });

    expect(document.getElementById('scopeFilter')).toBeNull();
    expect(document.getElementById('searchInput')).toBeNull();
    expect(document.getElementById('analyzeBtn')).toBeNull();
    expect(document.getElementById('providerSelect')).toBeNull();
    expect(document.getElementById('saveSettingsBtn')).toBeNull();
  });

  test('rejects likes extraction without username', async () => {
    const app = new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    chrome.runtime.sendMessage.mockClear();
    document.getElementById('usernameInput').value = '';

    await app.startExtraction('likes');

    const startCalls = chrome.runtime.sendMessage.mock.calls.filter(
      ([message]) => message.type === 'XA_START_EXTRACTION'
    );

    expect(startCalls).toHaveLength(0);
    expect(document.getElementById('statusText').textContent).toContain('Enter @username');
  });

  test('sends extraction request with normalized username', async () => {
    const app = new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    chrome.runtime.sendMessage.mockClear();
    document.getElementById('usernameInput').value = '@tester';

    await app.startExtraction('all');

    const startCall = chrome.runtime.sendMessage.mock.calls.find(
      ([message]) => message.type === 'XA_START_EXTRACTION'
    );

    expect(startCall).toBeTruthy();
    expect(startCall[0].payload).toEqual({
      scope: 'all',
      mode: 'full',
      username: 'tester'
    });
  });

  test('handles extraction progress relay', async () => {
    const app = new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    app.handleRuntimeEvent({
      type: 'EXTRACTION_PROGRESS',
      capturedCount: 20,
      scannedCount: 40,
      status: 'Scanning...'
    });

    expect(document.getElementById('statusText').textContent).toContain('Scanning');
    expect(document.getElementById('progressBar').value).toBeGreaterThan(0);
    expect(document.getElementById('progressLabel').textContent).toContain('%');
  });
});

describe('normalizeUsername', () => {
  test('strips @ and trims input', () => {
    expect(normalizeUsername('  @hello  ')).toBe('hello');
  });
});
