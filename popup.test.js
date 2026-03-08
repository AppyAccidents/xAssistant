const { PopupApp, normalizeUsername } = require('./src/popup/index.js');

function setupDom() {
  document.body.innerHTML = `
    <main id="popupRoot">
      <p id="statusText"></p>
      <progress id="progressBar" value="0" max="100"></progress>
      <span id="progressLabel"></span>
      <select id="platformSelect">
        <option value="x">X / Twitter</option>
        <option value="instagram">Instagram</option>
      </select>
      <select id="targetSelect"></select>
      <label id="usernameField">
        <span id="usernameLabel"></span>
        <input id="usernameInput" />
      </label>
      <select id="exportFormat">
        <option value="md">MD</option>
        <option value="csv">CSV</option>
        <option value="txt">TXT</option>
        <option value="json">JSON</option>
      </select>
      <button id="extractSelectedBtn"></button>
      <button id="extractAllBtn"></button>
      <button id="exportBtn"></button>
      <section id="guideOverlay" hidden>
        <h2 id="guideTitle"></h2>
        <p id="guideBody"></p>
        <p id="guideStepLabel"></p>
        <button id="guideBackBtn"></button>
        <button id="guideSkipBtn"></button>
        <button id="guideNextBtn"></button>
        <button id="guideDoneBtn"></button>
      </section>
    </main>
  `;
}

describe('PopupApp multi-platform flow', () => {
  beforeEach(() => {
    setupDom();

    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type === 'XA_GET_SETTINGS') {
        callback({
          success: true,
          settings: {
            onboardingSeen: true,
            guideVersion: 2,
            selectedPlatform: 'x',
            selectedTarget: 'all',
            settingsByPlatform: { x: { username: 'user' }, instagram: { username: '' } }
          }
        });
        return;
      }

      if (message.type === 'DATA_QUERY') {
        callback({ success: true, records: [], total: 2 });
        return;
      }

      if (message.type === 'XA_SAVE_SETTINGS') {
        callback({
          success: true,
          settings: {
            onboardingSeen: true,
            guideVersion: 2,
            selectedPlatform: message.payload.selectedPlatform || 'x',
            selectedTarget: message.payload.selectedTarget || 'all',
            settingsByPlatform: message.payload.settingsByPlatform || { x: { username: 'user' }, instagram: { username: '' } }
          }
        });
        return;
      }

      if (message.type === 'XA_START_EXTRACTION') {
        callback({ success: true, totalCount: 42, runId: 'run-1', durationMs: 1000 });
        return;
      }

      callback({ success: true });
    });
  });

  test('loads settings and sets ready status', async () => {
    new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById('platformSelect').value).toBe('x');
    expect(document.getElementById('usernameInput').value).toBe('@user');
    expect(document.getElementById('statusText').textContent).toContain('Ready');
  });

  test('renders required multi-platform controls in popup contract', async () => {
    new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    [
      'platformSelect',
      'targetSelect',
      'usernameInput',
      'extractSelectedBtn',
      'extractAllBtn',
      'exportFormat',
      'exportBtn',
      'guideOverlay',
      'statusText',
      'progressBar',
      'progressLabel'
    ].forEach((id) => {
      expect(document.getElementById(id)).toBeTruthy();
    });
  });

  test('rejects x likes extraction without username', async () => {
    const app = new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.getElementById('targetSelect').value = 'like';
    document.getElementById('usernameInput').value = '';
    chrome.runtime.sendMessage.mockImplementationOnce((message, callback) => {
      if (message.type === 'XA_SAVE_SETTINGS') {
        callback({
          success: true,
          settings: {
            onboardingSeen: true,
            guideVersion: 2,
            selectedPlatform: 'x',
            selectedTarget: 'like',
            settingsByPlatform: { x: { username: '' }, instagram: { username: '' } }
          }
        });
        return;
      }
      callback({ success: false, error: 'Enter @username for X likes extraction' });
    });

    await app.startExtraction('like');

    expect(document.getElementById('statusText').textContent).toContain('Enter @username');
  });

  test('sends extraction request with platform target and input', async () => {
    const app = new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    chrome.runtime.sendMessage.mockClear();
    document.getElementById('platformSelect').value = 'x';
    app.handlePlatformChange();
    document.getElementById('targetSelect').value = 'like';
    app.handleTargetChange();
    document.getElementById('usernameInput').value = '@tester';

    await app.startExtraction('like');

    const startCall = chrome.runtime.sendMessage.mock.calls.find(
      ([message]) => message.type === 'XA_START_EXTRACTION'
    );

    expect(startCall).toBeTruthy();
    expect(startCall[0].payload).toEqual({
      platform: 'x',
      target: 'like',
      mode: 'full',
      input: {
        username: 'tester'
      }
    });
  });

  test('shows instagram username field for saved extraction', async () => {
    const app = new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.getElementById('platformSelect').value = 'instagram';
    app.handlePlatformChange();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById('usernameField').hidden).toBe(false);
    expect(document.getElementById('usernameLabel').textContent).toContain('Instagram username');
  });

  test('shows onboarding wizard when onboarding is not seen', async () => {
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type === 'XA_GET_SETTINGS') {
        callback({
          success: true,
          settings: {
            onboardingSeen: false,
            guideVersion: 2,
            selectedPlatform: 'instagram',
            selectedTarget: 'all',
            settingsByPlatform: { x: { username: '' }, instagram: { username: '' } }
          }
        });
        return;
      }
      if (message.type === 'DATA_QUERY') {
        callback({ success: true, records: [], total: 0 });
        return;
      }
      callback({ success: true, settings: {} });
    });

    new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.getElementById('guideOverlay').hidden).toBe(false);
    expect(document.getElementById('guideTitle').textContent).toContain('Choose a platform');
  });

  test('handles extraction progress relay', async () => {
    const app = new PopupApp();
    await new Promise((resolve) => setTimeout(resolve, 0));

    app.handleRuntimeEvent({
      type: 'EXTRACTION_PROGRESS',
      capturedCount: 20,
      scannedCount: 40,
      status: 'Scanning Instagram saved...'
    });

    expect(document.getElementById('statusText').textContent).toContain('Scanning Instagram');
    expect(document.getElementById('progressBar').value).toBeGreaterThan(0);
  });
});

describe('normalizeUsername', () => {
  test('strips @ and trims input', () => {
    expect(normalizeUsername('  @@test  ')).toBe('test');
  });
});
