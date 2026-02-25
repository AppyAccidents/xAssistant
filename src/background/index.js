const {
  MESSAGE_TYPES,
  validateDataQuery
} = require('../core/contracts/messages.js');
const { StorageRepository } = require('../storage/repository.js');
const { getScopeUrl } = require('../extraction/route-detector.js');

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

async function runScopeExtraction({ scope, username, mode, runId }) {
  const url = getScopeUrl(scope, username);
  const tab = await createBackgroundTab(url);

  try {
    const response = await sendToTab(tab.id, {
      type: MESSAGE_TYPES.EXTRACTION_START,
      payload: { scope, mode, runId }
    });

    if (!response || !response.success) {
      const error = new Error(response?.error || `Extraction failed for ${scope}`);
      error.code = response?.code || 'EXTRACTION_FAILED';
      throw error;
    }

    return response;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function handleStartExtraction(payload) {
  const runId = `run-${Date.now()}`;
  const scopeRequest = payload.scope || 'all';
  const mode = payload.mode || 'full';
  const username = payload.username || '';

  const scopes = scopeRequest === 'all' ? ['bookmarks', 'likes'] : [scopeRequest];
  const records = [];
  const startedAt = Date.now();

  for (const scope of scopes) {
    const scopeResult = await runScopeExtraction({
      scope,
      username,
      mode,
      runId: `${runId}-${scope}`
    });

    records.push(...(scopeResult.records || []));
  }

  const durationMs = Date.now() - startedAt;
  await repository.upsertRecords(records, {
    runId,
    scope: scopeRequest,
    totalCount: records.length,
    durationMs
  });

  const completion = {
    type: MESSAGE_TYPES.EXTRACTION_COMPLETE,
    runId,
    scope: scopeRequest,
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
