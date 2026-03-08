const {
  MESSAGE_TYPES,
  validateDataQuery,
  validateExtractionStart
} = require('../core/contracts/messages.js');
const { StorageRepository } = require('../storage/repository.js');
const { getTargetUrl } = require('../extraction/route-detector.js');
const { expandExtractionTargets, getPlatformAdapter } = require('../platforms/index.js');

const repository = new StorageRepository(chrome.storage.local);

async function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const handler = (updatedTabId, changeInfo, tab) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(handler);
        resolve(tab);
      }
    };

    chrome.tabs.onUpdated.addListener(handler);
  });
}

async function createBackgroundTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  await waitForTabLoad(tab.id);
  return tab;
}

async function sendToTab(tabId, message, attempts = 3) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, message);
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }

  throw lastError;
}

async function runExtractionTask({ platform, target, mode, input, runId }) {
  const url = getTargetUrl(platform, target, input);
  const tab = await createBackgroundTab(url);

  try {
    const response = await sendToTab(tab.id, {
      type: MESSAGE_TYPES.EXTRACTION_START,
      payload: { platform, target, mode, input, runId }
    });

    if (!response || !response.success) {
      const error = new Error(response?.error || `Extraction failed for ${platform}/${target}`);
      error.code = response?.code || 'EXTRACTION_FAILED';
      throw error;
    }

    return response;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function handleStartExtraction(payload) {
  const validation = validateExtractionStart(payload || {});
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const { platform, target, mode, input } = validation.value;
  const runId = `run-${Date.now()}`;
  const targets = expandExtractionTargets(platform, target);
  const records = [];
  const startedAt = Date.now();

  for (const currentTarget of targets) {
    const adapter = getPlatformAdapter(platform);
    const inputValidation = adapter.validateInput(currentTarget, input);
    if (!inputValidation.valid) {
      throw new Error(inputValidation.error);
    }

    const taskResult = await runExtractionTask({
      platform,
      target: currentTarget,
      mode,
      input: inputValidation.value,
      runId: `${runId}-${platform}-${currentTarget}`
    });

    const taskRecords = taskResult.records || [];
    if (taskRecords.length > 0) {
      await repository.upsertRecords(taskRecords, {
        runId: `${runId}-${currentTarget}`,
        platform,
        target: currentTarget,
        totalCount: taskRecords.length,
        durationMs: taskResult.durationMs || 0
      });
    }
    records.push(...taskRecords);
  }

  const durationMs = Date.now() - startedAt;
  const completion = {
    type: MESSAGE_TYPES.EXTRACTION_COMPLETE,
    runId,
    platform,
    target,
    totalCount: records.length,
    durationMs,
    __relay: true
  };

  chrome.runtime.sendMessage(completion).catch(() => {});

  return {
    runId,
    totalCount: records.length,
    durationMs
  };
}

async function handleDataQuery(payload) {
  const validation = validateDataQuery(payload || {});
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  return repository.queryRecords(validation.value);
}

chrome.runtime.onInstalled.addListener(() => {
  repository.ensureInitialized().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.__relay) {
    return;
  }

  if (
    message.type === MESSAGE_TYPES.EXTRACTION_PROGRESS ||
    message.type === MESSAGE_TYPES.EXTRACTION_COMPLETE ||
    message.type === MESSAGE_TYPES.EXTRACTION_ERROR
  ) {
    chrome.runtime.sendMessage({ ...message, __relay: true }).catch(() => {});
    return;
  }

  if (message.type === MESSAGE_TYPES.XA_START_EXTRACTION) {
    handleStartExtraction(message.payload || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.DATA_QUERY) {
    handleDataQuery(message.payload || {})
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.XA_GET_SETTINGS) {
    repository.getSettings()
      .then((settings) => sendResponse({ success: true, settings }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === MESSAGE_TYPES.XA_SAVE_SETTINGS) {
    repository.updateSettings(message.payload || {})
      .then((settings) => sendResponse({ success: true, settings }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
