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

const GUIDE_VERSION = 1;
const GUIDE_STEPS = [
  {
    title: 'Choose extraction scope',
    body: 'Pick what to collect: Bookmarks, Likes, or Both.'
  },
  {
    title: 'Set username for likes',
    body: 'Likes and Both need a username. Enter it once and we will reuse it.'
  },
  {
    title: 'Extract, then export',
    body: 'Run extraction first, then click Export Report to download your data.'
  }
];

class PopupApp {
  constructor() {
    this.state = {
      settings: {
        username: '',
        onboardingSeen: false,
        guideVersion: GUIDE_VERSION
      },
      progress: 0,
      running: false,
      recordCount: 0,
      guideStep: 0
    };

    this.exportCtaTimer = null;

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
      exportBtn: document.getElementById('exportBtn'),
      guideOverlay: document.getElementById('guideOverlay'),
      guideTitle: document.getElementById('guideTitle'),
      guideBody: document.getElementById('guideBody'),
      guideStepLabel: document.getElementById('guideStepLabel'),
      guideBackBtn: document.getElementById('guideBackBtn'),
      guideSkipBtn: document.getElementById('guideSkipBtn'),
      guideNextBtn: document.getElementById('guideNextBtn'),
      guideDoneBtn: document.getElementById('guideDoneBtn')
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
    if (this.shouldShowOnboardingGuide()) {
      this.openGuide();
    }
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

    if (this.elements.guideNextBtn) {
      this.elements.guideNextBtn.addEventListener('click', () => this.nextGuideStep());
    }
    if (this.elements.guideBackBtn) {
      this.elements.guideBackBtn.addEventListener('click', () => this.previousGuideStep());
    }
    if (this.elements.guideSkipBtn) {
      this.elements.guideSkipBtn.addEventListener('click', () => this.dismissGuide());
    }
    if (this.elements.guideDoneBtn) {
      this.elements.guideDoneBtn.addEventListener('click', () => this.dismissGuide());
    }
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
      this.clearExportCta();
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
      if (typeof response.settings.onboardingSeen === 'boolean') {
        this.state.settings.onboardingSeen = response.settings.onboardingSeen;
      }
      if (Number.isInteger(response.settings.guideVersion)) {
        this.state.settings.guideVersion = response.settings.guideVersion;
      }
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

  shouldShowOnboardingGuide() {
    return !this.state.settings.onboardingSeen || this.state.settings.guideVersion !== GUIDE_VERSION;
  }

  openGuide() {
    if (!this.elements.guideOverlay) return;
    this.state.guideStep = 0;
    this.elements.guideOverlay.hidden = false;
    this.renderGuideStep();
  }

  renderGuideStep() {
    if (!this.elements.guideOverlay) return;
    const step = GUIDE_STEPS[this.state.guideStep];
    if (!step) return;

    this.elements.guideTitle.textContent = step.title;
    this.elements.guideBody.textContent = step.body;
    this.elements.guideStepLabel.textContent = `Step ${this.state.guideStep + 1} of ${GUIDE_STEPS.length}`;

    this.elements.guideBackBtn.hidden = this.state.guideStep === 0;
    this.elements.guideNextBtn.hidden = this.state.guideStep >= GUIDE_STEPS.length - 1;
    this.elements.guideDoneBtn.hidden = this.state.guideStep < GUIDE_STEPS.length - 1;
  }

  nextGuideStep() {
    if (this.state.guideStep >= GUIDE_STEPS.length - 1) return;
    this.state.guideStep += 1;
    this.renderGuideStep();
  }

  previousGuideStep() {
    if (this.state.guideStep <= 0) return;
    this.state.guideStep -= 1;
    this.renderGuideStep();
  }

  async dismissGuide() {
    if (this.elements.guideOverlay) {
      this.elements.guideOverlay.hidden = true;
    }

    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.XA_SAVE_SETTINGS,
      payload: {
        onboardingSeen: true,
        guideVersion: GUIDE_VERSION
      }
    }).catch((error) => ({ success: false, error: error.message }));

    if (!response.success) {
      this.setStatus('Guide state was not saved', 'error');
      return;
    }

    this.state.settings.onboardingSeen = true;
    this.state.settings.guideVersion = GUIDE_VERSION;
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

  clearExportCta() {
    if (this.exportCtaTimer) {
      clearTimeout(this.exportCtaTimer);
      this.exportCtaTimer = null;
    }
    this.elements.exportBtn.classList.remove('action-attention');
  }

  pulseExportCta() {
    this.clearExportCta();
    this.elements.exportBtn.classList.add('action-attention');
    this.exportCtaTimer = setTimeout(() => {
      this.clearExportCta();
    }, 3000);
  }

  handleExtractionCompletion(totalCount) {
    this.setProgress(100);
    this.refreshRecordCount().catch(() => {});
    this.setRunning(false);

    if (totalCount > 0) {
      this.setStatus(`Extraction complete (${totalCount} records). Ready to export.`, 'success');
      this.pulseExportCta();
      return;
    }

    this.setStatus('No records found. Try scrolling and extract again.', 'error');
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

    this.handleExtractionCompletion(Number(response.totalCount || 0));
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
      this.handleExtractionCompletion(Number(message.totalCount || 0));
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
