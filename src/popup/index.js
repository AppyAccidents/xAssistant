const { MESSAGE_TYPES } = require('../core/contracts/messages.js');
const {
  generateJSONExport,
  generateCSVExport,
  generateMarkdownExport,
  generateTextExport
} = require('../export/index.js');
const { downloadTextFile } = require('../ui/dom-safe.js');
const { getPlatformAdapter } = require('../platforms/index.js');

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

const GUIDE_VERSION = 2;
const GUIDE_STEPS = [
  {
    title: 'Choose a platform',
    body: 'Pick X or Instagram before starting extraction.'
  },
  {
    title: 'Choose a target',
    body: 'Select a specific target or run all supported targets for that platform.'
  },
  {
    title: 'Extract, then export',
    body: 'Run extraction first, then export the combined report in the format you need.'
  }
];

class PopupApp {
  constructor() {
    this.state = {
      settings: {
        onboardingSeen: false,
        guideVersion: GUIDE_VERSION,
        selectedPlatform: 'x',
        selectedTarget: 'all',
        settingsByPlatform: {
          x: { username: '' },
          instagram: { username: '' }
        }
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
      platformSelect: document.getElementById('platformSelect'),
      targetSelect: document.getElementById('targetSelect'),
      usernameField: document.getElementById('usernameField'),
      usernameLabel: document.getElementById('usernameLabel'),
      usernameInput: document.getElementById('usernameInput'),
      extractSelectedBtn: document.getElementById('extractSelectedBtn'),
      extractAllBtn: document.getElementById('extractAllBtn'),
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
    this.renderPlatformControls();
    await this.refreshRecordCount();
    this.setProgress(0);
    this.setStatus(`Ready (${this.state.recordCount} records)`, 'idle');
    if (this.shouldShowOnboardingGuide()) {
      this.openGuide();
    }
  }

  bindEvents() {
    this.elements.platformSelect.addEventListener('change', () => this.handlePlatformChange());
    this.elements.targetSelect.addEventListener('change', () => this.handleTargetChange());
    this.elements.extractSelectedBtn.addEventListener('click', () => this.startExtraction(this.elements.targetSelect.value));
    this.elements.extractAllBtn.addEventListener('click', () => this.startExtraction('all'));
    this.elements.exportBtn.addEventListener('click', () => this.exportData());

    this.elements.usernameInput.addEventListener('blur', () => this.savePlatformSettings());
    this.elements.usernameInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.savePlatformSettings();
      }
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (!message || !message.__relay) return;
      this.handleRuntimeEvent(message);
    });

    this.elements.guideNextBtn?.addEventListener('click', () => this.nextGuideStep());
    this.elements.guideBackBtn?.addEventListener('click', () => this.previousGuideStep());
    this.elements.guideSkipBtn?.addEventListener('click', () => this.dismissGuide());
    this.elements.guideDoneBtn?.addEventListener('click', () => this.dismissGuide());
  }

  getSelectedPlatform() {
    return this.elements.platformSelect.value === 'instagram' ? 'instagram' : 'x';
  }

  getSelectedTarget() {
    return this.elements.targetSelect.value || 'all';
  }

  getSelectedAdapter() {
    return getPlatformAdapter(this.getSelectedPlatform());
  }

  renderPlatformControls() {
    const platform = this.state.settings.selectedPlatform;
    const target = this.state.settings.selectedTarget;
    const adapter = getPlatformAdapter(platform);
    const targets = adapter.getAllTargets();

    this.elements.platformSelect.value = platform;
    this.elements.targetSelect.innerHTML = '';

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'All Supported Targets';
    this.elements.targetSelect.appendChild(allOption);

    targets.forEach((item) => {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = adapter.getTargetLabel(item);
      this.elements.targetSelect.appendChild(option);
    });

    this.elements.targetSelect.value = targets.includes(target) ? target : 'all';
    this.elements.extractAllBtn.textContent = `Extract All For ${adapter.label}`;

    const username = this.state.settings.settingsByPlatform[platform]?.username || '';
    this.elements.usernameInput.value = username ? `@${username}` : '';
    this.updateConditionalFields();
  }

  updateConditionalFields() {
    const adapter = this.getSelectedAdapter();
    const target = this.getSelectedTarget();
    const schemaTarget = target === 'all' ? adapter.getAllTargets()[0] : target;
    const schema = adapter.getInputSchema(schemaTarget);
    const usernameField = schema.find((item) => item.key === 'username');
    const requiresUsername = Boolean(usernameField);
    this.elements.usernameField.hidden = !requiresUsername;
    if (usernameField) {
      this.elements.usernameLabel.textContent = usernameField.label;
    }
    this.elements.usernameInput.disabled = !requiresUsername || this.state.running;
  }

  setStatus(text, tone = 'idle') {
    this.elements.statusText.textContent = text;
    this.setAppState(tone);
  }

  setAppState(tone) {
    if (!this.elements.appRoot) return;

    this.elements.appRoot.classList.remove('state-idle', 'state-running', 'state-success', 'state-error');
    this.elements.appRoot.classList.add(`state-${tone === 'running' || tone === 'success' || tone === 'error' ? tone : 'idle'}`);
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

    this.elements.platformSelect.disabled = isRunning;
    this.elements.targetSelect.disabled = isRunning;
    this.elements.extractSelectedBtn.disabled = isRunning;
    this.elements.extractAllBtn.disabled = isRunning;
    this.elements.exportBtn.disabled = isRunning;
    this.updateConditionalFields();
  }

  async loadSettings() {
    const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.XA_GET_SETTINGS })
      .catch(() => ({ success: false }));

    if (response.success && response.settings) {
      const settings = response.settings;
      this.state.settings = {
        ...this.state.settings,
        ...settings,
        settingsByPlatform: {
          x: {
            username: normalizeUsername(settings.settingsByPlatform?.x?.username || settings.username || '')
          },
          instagram: {
            username: normalizeUsername(settings.settingsByPlatform?.instagram?.username || '')
          }
        }
      };
    }
  }

  async savePlatformSettings() {
    const platform = this.getSelectedPlatform();
    const payload = {
      selectedPlatform: platform,
      selectedTarget: this.getSelectedTarget(),
      settingsByPlatform: {
        ...this.state.settings.settingsByPlatform,
        x: {
          username: platform === 'x'
            ? normalizeUsername(this.elements.usernameInput.value)
            : normalizeUsername(this.state.settings.settingsByPlatform.x.username || '')
        },
        instagram: {
          username: platform === 'instagram'
            ? normalizeUsername(this.elements.usernameInput.value)
            : normalizeUsername(this.state.settings.settingsByPlatform.instagram.username || '')
        }
      }
    };

    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.XA_SAVE_SETTINGS,
      payload
    }).catch((error) => ({ success: false, error: error.message }));

    if (!response.success) {
      return false;
    }

    this.state.settings = {
      ...this.state.settings,
      ...response.settings
    };
    this.renderPlatformControls();
    return true;
  }

  handlePlatformChange() {
    this.state.settings.selectedPlatform = this.getSelectedPlatform();
    this.state.settings.selectedTarget = 'all';
    this.renderPlatformControls();
    this.savePlatformSettings();
  }

  handleTargetChange() {
    this.state.settings.selectedTarget = this.getSelectedTarget();
    this.updateConditionalFields();
    this.savePlatformSettings();
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
    this.elements.guideOverlay.hidden = true;
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.XA_SAVE_SETTINGS,
      payload: {
        onboardingSeen: true,
        guideVersion: GUIDE_VERSION,
        selectedPlatform: this.getSelectedPlatform(),
        selectedTarget: this.getSelectedTarget(),
        settingsByPlatform: this.state.settings.settingsByPlatform
      }
    }).catch((error) => ({ success: false, error: error.message }));

    if (!response.success) {
      this.setStatus('Guide state was not saved', 'error');
      return;
    }

    this.state.settings = {
      ...this.state.settings,
      ...response.settings
    };
  }

  async refreshRecordCount() {
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.DATA_QUERY,
      payload: {
        platform: 'all',
        target: 'all',
        page: { offset: 0, limit: 1 }
      }
    }).catch(() => ({ success: false }));

    if (!response.success) return;
    this.state.recordCount = typeof response.total === 'number' ? response.total : (response.records || []).length;
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
    this.exportCtaTimer = setTimeout(() => this.clearExportCta(), 3000);
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

  handleExtractionFailure(message, code = '') {
    if (code === 'INSTAGRAM_COLLECTION_INDEX_UNRESOLVED') {
      this.setStatus('Instagram saved collections loaded, but All posts could not be opened automatically.', 'error');
      return;
    }

    if (code === 'INSTAGRAM_GRID_EMPTY') {
      this.setStatus('Instagram All posts loaded, but no extractable saved items were found.', 'error');
      return;
    }

    if (code === 'INSTAGRAM_PAGE_UNSUPPORTED') {
      this.setStatus('Instagram saved page structure is not supported by the current extractor.', 'error');
      return;
    }

    this.setStatus(message || 'Extraction failed', 'error');
  }

  async startExtraction(targetOverride) {
    if (this.state.running) return;

    await this.savePlatformSettings();

    const platform = this.getSelectedPlatform();
    const target = targetOverride || this.getSelectedTarget();
    const rawInput = {
      username: normalizeUsername(this.elements.usernameInput.value)
    };
    const adapter = getPlatformAdapter(platform);
    const validationTarget = target === 'all' ? adapter.getAllTargets()[0] : target;
    const inputValidation = adapter.validateInput(validationTarget, rawInput);
    if (!inputValidation.valid) {
      this.setStatus(inputValidation.error, 'error');
      this.setProgress(0);
      return;
    }
    const input = rawInput;

    this.setRunning(true);
    this.setProgress(2);
    this.setStatus(`Starting ${platform}/${target} extraction...`, 'running');

    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.XA_START_EXTRACTION,
      payload: {
        platform,
        target,
        mode: 'full',
        input
      }
    }).catch((error) => ({ success: false, error: error.message }));

    if (!response.success) {
      this.handleExtractionFailure(response.error, response.code);
      this.setRunning(false);
      this.setProgress(0);
      return;
    }

    this.handleExtractionCompletion(Number(response.totalCount || 0));
  }

  exportDataForFormat(records, format) {
    if (format === 'json') {
      return {
        content: JSON.stringify(generateJSONExport(records, { platform: 'all', target: 'all' }), null, 2),
        extension: 'json',
        mime: 'application/json'
      };
    }

    if (format === 'csv') {
      return {
        content: generateCSVExport(records, { platform: 'all', target: 'all' }),
        extension: 'csv',
        mime: 'text/csv'
      };
    }

    if (format === 'md') {
      return {
        content: generateMarkdownExport(records, { platform: 'all', target: 'all' }),
        extension: 'md',
        mime: 'text/markdown'
      };
    }

    if (format === 'txt') {
      return {
        content: generateTextExport(records, { platform: 'all', target: 'all' }),
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
        platform: 'all',
        target: 'all',
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
      const filename = `social-assistant-report-${timestamp}.${output.extension}`;
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
      this.handleExtractionFailure(message.message, message.code);
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
