const { MESSAGE_TYPES } = require('../core/contracts/messages.js');
const {
  generateJSONExport,
  generateCSVExport,
  generateMarkdownExport,
  generateTextExport
} = require('../export/index.js');
const { downloadTextFile } = require('../ui/dom-safe.js');

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response || {});
    });
  });
}

function normalizeUsername(rawValue) {
  return String(rawValue || '').trim().replace(/^@+/, '');
}

class PopupApp {
  constructor() {
    this.state = {
      settings: {
        username: ''
      },
      progress: 0,
      running: false,
      recordCount: 0
    };

    this.elements = {
      appRoot: document.getElementById('popupRoot'),
      statusText: document.getElementById('statusText'),
      progressBar: document.getElementById('progressBar'),
      progressLabel: document.getElementById('progressLabel'),
      extractBookmarksBtn: document.getElementById('extractBookmarksBtn'),
      extractLikesBtn: document.getElementById('extractLikesBtn'),
      extractBothBtn: document.getElementById('extractBothBtn'),
      usernameInput: document.getElementById('usernameInput'),
      exportFormat: document.getElementById('exportFormat'),
      exportBtn: document.getElementById('exportBtn')
    };

    this.bindEvents();
    this.initialize();
  }

  async initialize() {
    this.setStatus('Loading...', 'idle');
    await this.loadSettings();
    await this.refreshRecordCount();
    this.setProgress(0);
    this.setStatus(`Ready (${this.state.recordCount} records)`, 'idle');
  }

  bindEvents() {
    this.elements.extractBookmarksBtn.addEventListener('click', () => this.startExtraction('bookmarks'));
    this.elements.extractLikesBtn.addEventListener('click', () => this.startExtraction('likes'));
    this.elements.extractBothBtn.addEventListener('click', () => this.startExtraction('all'));
    this.elements.exportBtn.addEventListener('click', () => this.exportData());

    this.elements.usernameInput.addEventListener('blur', () => this.saveUsername());
    this.elements.usernameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.saveUsername();
      }
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (!message || !message.__relay) return;
      this.handleRuntimeEvent(message);
    });
  }

  setStatus(text, tone = 'idle') {
    this.elements.statusText.textContent = text;
    this.setAppState(tone);
  }

  setAppState(tone) {
    if (!this.elements.appRoot) return;

    this.elements.appRoot.classList.remove('state-idle', 'state-running', 'state-success', 'state-error');

    switch (tone) {
      case 'running':
        this.elements.appRoot.classList.add('state-running');
        break;
      case 'success':
        this.elements.appRoot.classList.add('state-success');
        break;
      case 'error':
        this.elements.appRoot.classList.add('state-error');
        break;
      default:
        this.elements.appRoot.classList.add('state-idle');
        break;
    }
  }

  setProgress(value) {
    const clamped = Math.max(0, Math.min(100, value));
    this.state.progress = clamped;
    this.elements.progressBar.value = clamped;
    this.elements.progressLabel.textContent = `${clamped}%`;
  }

  setRunning(isRunning) {
    this.state.running = isRunning;
    if (isRunning) {
      this.setAppState('running');
    }

    this.elements.extractBookmarksBtn.disabled = isRunning;
    this.elements.extractLikesBtn.disabled = isRunning;
    this.elements.extractBothBtn.disabled = isRunning;
    this.elements.usernameInput.disabled = isRunning;
    this.elements.exportBtn.disabled = isRunning;
  }

  async loadSettings() {
    const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.XA_GET_SETTINGS })
      .catch(() => ({ success: false }));

    if (response.success && response.settings) {
      this.state.settings.username = normalizeUsername(response.settings.username || '');
    }

    this.elements.usernameInput.value = this.state.settings.username ? `@${this.state.settings.username}` : '';
  }

  async saveUsername(value = this.elements.usernameInput.value) {
    const username = normalizeUsername(value);

    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.XA_SAVE_SETTINGS,
      payload: { username }
    }).catch((error) => ({ success: false, error: error.message }));

    if (!response.success) {
      return false;
    }

    this.state.settings.username = username;
    this.elements.usernameInput.value = username ? `@${username}` : '';
    return true;
  }

  async refreshRecordCount() {
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.DATA_QUERY,
      payload: {
        scope: 'all',
        page: { offset: 0, limit: 1 }
      }
    }).catch(() => ({ success: false }));

    if (!response.success) {
      return;
    }

    this.state.recordCount = typeof response.total === 'number'
      ? response.total
      : (response.records || []).length;
  }

  requiresUsername(scope) {
    return scope === 'likes' || scope === 'all';
  }

  async startExtraction(scope) {
    if (this.state.running) return;

    const username = normalizeUsername(this.elements.usernameInput.value);

    if (this.requiresUsername(scope) && !username) {
      this.setStatus('Enter @username for likes extraction', 'error');
      return;
    }

    await this.saveUsername(username);

    this.setRunning(true);
    this.setProgress(2);
    this.setStatus(`Starting ${scope} extraction...`, 'running');

    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.XA_START_EXTRACTION,
      payload: {
        scope,
        mode: 'full',
        username
      }
    }).catch((error) => ({ success: false, error: error.message }));

    if (!response.success) {
      this.setStatus(response.error || 'Extraction failed', 'error');
      this.setRunning(false);
      this.setProgress(0);
      return;
    }

    this.setProgress(100);
    await this.refreshRecordCount();
    this.setStatus(`Extraction complete (${response.totalCount || 0})`, 'success');
    this.setRunning(false);
  }

  exportDataForFormat(records, format) {
    if (format === 'json') {
      return {
        content: JSON.stringify(generateJSONExport(records, { scope: 'all' }), null, 2),
        extension: 'json',
        mime: 'application/json'
      };
    }

    if (format === 'csv') {
      return {
        content: generateCSVExport(records, { scope: 'all' }),
        extension: 'csv',
        mime: 'text/csv'
      };
    }

    if (format === 'md') {
      return {
        content: generateMarkdownExport(records, { scope: 'all' }),
        extension: 'md',
        mime: 'text/markdown'
      };
    }

    if (format === 'txt') {
      return {
        content: generateTextExport(records, { scope: 'all' }),
        extension: 'txt',
        mime: 'text/plain'
      };
    }

    throw new Error(`Unsupported export format: ${format}`);
  }

  async exportData() {
    if (this.state.running) return;

    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.DATA_QUERY,
      payload: {
        scope: 'all',
        page: { offset: 0, limit: 5000 }
      }
    }).catch((error) => ({ success: false, error: error.message }));

    if (!response.success) {
      this.setStatus(response.error || 'Failed to load records for export', 'error');
      return;
    }

    const records = response.records || [];
    if (records.length === 0) {
      this.setStatus('No records to export', 'error');
      return;
    }

    const format = this.elements.exportFormat.value;
    const timestamp = Date.now();

    try {
      const output = this.exportDataForFormat(records, format);
      const filename = `x-assistant-report-${timestamp}.${output.extension}`;
      downloadTextFile(output.content, filename, output.mime);
      this.setStatus(`Exported ${records.length} records as ${format.toUpperCase()}`, 'success');
    } catch (error) {
      this.setStatus(error.message || 'Export failed', 'error');
    }
  }

  handleRuntimeEvent(message) {
    if (message.type === MESSAGE_TYPES.EXTRACTION_PROGRESS) {
      const captured = Number(message.capturedCount || 0);
      const scanned = Number(message.scannedCount || 0);
      const denominator = Math.max(scanned, captured, 1);
      const pct = Math.min(95, Math.round((captured / denominator) * 100));

      this.setProgress(pct);
      this.setStatus(message.status || 'Extraction in progress...', 'running');
      return;
    }

    if (message.type === MESSAGE_TYPES.EXTRACTION_ERROR) {
      this.setStatus(message.message || 'Extraction failed', 'error');
      this.setProgress(0);
      this.setRunning(false);
      return;
    }

    if (message.type === MESSAGE_TYPES.EXTRACTION_COMPLETE) {
      this.setProgress(100);
      this.setStatus(`Extraction complete (${message.totalCount || 0})`, 'success');
      this.refreshRecordCount();
      this.setRunning(false);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupApp();
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PopupApp,
    sendRuntimeMessage,
    normalizeUsername
  };
}
