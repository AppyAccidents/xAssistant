// X Bookmarks Analyzer with AI - Popup Script v0.13.1
const { TierManager, WORKER_URL } = require('../services/tier-manager.js');
const { GeminiProvider: GeminiProviderClass, ProxyGeminiProvider, GEMINI_FLASH, GEMINI_PRO } = require('../providers/gemini.js');
const { generateKnowledgeBase, downloadKnowledgeBase } = require('../exporters/knowledge-base.js');

class PopupController {
  constructor() {
    this.tierManager = new TierManager();
    this.initializeState();
    this.bindElements();
    this.setupEventListeners();
    this.setupKeyboardShortcuts(); // NEW v0.11.0
    this.loadSettings().then(async () => {
      await this.tierManager.revalidateSavedLicense();
      this.loadLastExtraction();
      this.render();
      this.checkReminders(); // Check reminders on startup
      this.updateTierUI();
    });
  }

  initializeState = () => {
    this.state = {
      lastExtraction: null,
      filteredBookmarks: null, // For search/filter results
      isDarkMode: false,
      aiAnalysis: null,
      apiKey: '',
      llmProvider: 'none', // 'openai', 'anthropic', 'none'
      systemPrompt: '', // Custom system prompt
      renderedCount: 50, // Infinite scroll
      searchQuery: '',
      filterOptions: {
        minLikes: 0,
        minRetweets: 0,
        author: '',
        dateFrom: '',
        dateTo: '',
        readStatus: 'all', // 'all', 'read', 'unread'
        hasNotes: false,
        collections: []
      },
      progress: {
        current: 0,
        total: 0,
        status: 'Ready'
      },
      performanceMetrics: {
        lastExtractionTime: 0,
        lastAnalysisTime: 0,
        bookmarksExtracted: 0
      },
      // NEW FEATURES v0.10.0
      bookmarkMetadata: {}, // { url: { read: bool, notes: string, customTags: [], favorite: bool, collection: string, archived: bool, highlights: [], readingPriority: 0 } }
      collections: [], // { id, name, color, bookmarkCount }
      savedSearches: [], // { id, name, query, filters }
      viewMode: 'list', // 'list', 'grid', 'card'
      reminders: [], // { bookmarkUrl, reminderDate, message }
      // NEW FEATURES v0.11.0
      bulkSelection: [], // Array of selected bookmark URLs
      undoStack: [], // History stack for undo
      redoStack: [], // History stack for redo
      readingQueue: [], // { bookmarkUrl, priority, addedDate }
      engagementHistory: {}, // { url: [{ timestamp, likes, retweets, replies, views }] }
      analysisStatus: 'ready',
    };


    this.constants = {
      BATCH_SIZE: 100,
      SCROLL_DELAY: 1000,
      MAX_SAFE_BOOKMARKS: 500,
      AI_ANALYSIS_LIMIT: 50,
      AI_MAX_TOKENS: 500,
      AI_TEMPERATURE: 0.7,
      AI_MODEL: 'gpt-3.5-turbo',
      AUTO_SCROLL_DELAY: 2000,
      AUTO_SCROLL_MAX_ATTEMPTS: 50,
      AUTO_SCROLL_STABLE_ATTEMPTS: 3,
      POST_SCROLL_DELAY: 1000,
      POST_SCAN_DELAY: 1000,
      API_KEY_MIN_LENGTH: 20,
      MAX_TAGS: 20,
      MAX_CATEGORIES: 10,
      API_RETRY_ATTEMPTS: 3,
      API_RETRY_DELAY: 1000
    };

    // Debounced functions cache
    this.debouncedSearch = this.debounce(this.performSearch.bind(this), 300);
  };

  bindElements = () => {
    this.elements = {
      statusBar: document.getElementById('status-bar'),
      extractionStatus: document.getElementById('extraction-status'),
      progressBar: document.getElementById('progress-container'),
      progressFill: document.querySelector('.progress-fill'),
      progressText: document.getElementById('progress-text'),
      darkModeToggle: document.getElementById('darkModeToggle'),
      clearStorageBtn: document.getElementById('clearStorageBtn'),
      bookmarksBtn: document.getElementById('bookmarksBtn'),
      scanBtn: document.getElementById('scanBtn'),
      autoScrollBtn: document.getElementById('autoScrollBtn'),
      analyzeAiBtn: document.getElementById('analyzeAiBtn'),
      exportMdBtn: document.getElementById('exportMdBtn'),
      exportCsvBtn: document.getElementById('exportCsvBtn'),
      searchInput: document.getElementById('searchInput'),
      filterBtn: document.getElementById('filterBtn'),
      mainContent: document.getElementById('mainContent'),
      closeBtn: document.getElementById('closeBtn'),
      settingsBtn: document.getElementById('settingsBtn'),
      viewModeBtn: document.getElementById('viewModeBtn'),
      exportNotionBtn: document.getElementById('exportNotionBtn'),
      exportObsidianBtn: document.getElementById('exportObsidianBtn'),
      sentimentBtn: document.getElementById('sentimentBtn'),
      aiQABtn: document.getElementById('aiQABtn'),
      authorAnalyticsBtn: document.getElementById('authorAnalyticsBtn'),
      hiddenGemsBtn: document.getElementById('hiddenGemsBtn'),
      // Tabs
      tabBtns: document.querySelectorAll('.tab-btn'),
      tabContents: document.querySelectorAll('.tab-content'),
      libraryContainer: document.getElementById('library-container'),
      // Tier & rate-limit UI
      tierBadge: document.getElementById('tierBadge'),
      rateLimitText: document.getElementById('rateLimitText'),
      // Knowledge Base export
      exportKbBtn: document.getElementById('exportKbBtn'),
      kbBtnSubtitle: document.getElementById('kbBtnSubtitle'),
      kbProgress: document.getElementById('kbProgress'),
      kbProgressFill: document.getElementById('kbProgressFill'),
      kbProgressText: document.getElementById('kbProgressText'),
      // Settings – subscription
      subTierDisplay: document.getElementById('subTierDisplay'),
      subDescription: document.getElementById('subDescription'),
      subscriptionStatus: document.getElementById('subscriptionStatus'),
      licenseKeyInput: document.getElementById('licenseKeyInput'),
      activateLicenseBtn: document.getElementById('activateLicenseBtn'),
      deactivateLicenseBtn: document.getElementById('deactivateLicenseBtn'),
      licenseMsg: document.getElementById('licenseMsg'),
      bmcUpgradeBox: document.getElementById('bmcUpgradeBox'),
    };

    // Tab Event Listeners
    this.elements.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.getAttribute('data-tab');
        this.switchTab(tabName);
      });
    });
  };

  switchTab = (tabName) => {
    this.elements.tabBtns.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    this.elements.tabContents.forEach(content => {
      if (content.id === `tab-${tabName}`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });

    // Refresh library if switching to it
    if (tabName === 'library') {
      this.renderLibrary();
    }
  };

  // Infinite Scroll Observer
  setupIntersectionObserver = () => {
    this.observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        this.renderLibrary(true); // Append mode
      }
    }, { root: null, rootMargin: '100px', threshold: 0.1 });
  };

  renderLibrary = (append = false) => {
    const container = this.elements.libraryContainer;
    if (!container) return;

    if (!this.observer) this.setupIntersectionObserver();

    const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;

    // Empty state
    if (!bookmarks || bookmarks.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--disabled-color); display: flex; flex-direction: column; align-items: center; gap: 16px;">
          <div style="font-size: 48px;">🔍</div>
          <p>No bookmarks found here.</p>
          <button id="startScanBtn" class="action-button primary">Start New Scan</button>
        </div>
      `;
      // Guided Empty State Listener
      setTimeout(() => {
        const startBtn = container.querySelector('#startScanBtn');
        if (startBtn) {
          startBtn.addEventListener('click', () => {
            this.switchTab('scan');
            // Optionally highlight the scan button or auto-start? 
            // For now just switch.
          });
        }
      }, 0);
      return;
    }

    // Reset if not appending
    if (!append) {
      container.innerHTML = '';
      this.state.renderedCount = 50;
      window.scrollTo(0, 0); // Reset scroll
    }

    // Calculate range
    const start = append ? document.querySelectorAll('.bookmark-card').length : 0;
    const end = this.state.renderedCount;

    // Check if we need to render more
    const toRender = bookmarks.slice(start, end);

    toRender.forEach(bookmark => {
      const card = document.createElement('div');
      card.className = 'bookmark-card';

      // Find image
      let bgImage = '';
      if (bookmark.media && bookmark.media.length > 0) {
        // Prefer image type
        const img = bookmark.media.find(m => m.type === 'photo') || bookmark.media[0];
        bgImage = `url('${img.media_url_https || img.url}')`;
      }

      card.innerHTML = `
        <div class="card-media" style="${bgImage ? 'background-image: ' + bgImage : ''}">
           ${!bgImage ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--disabled-color);font-size:24px;">📝</div>' : ''}
           <div class="card-actions-overlay">
             <div class="card-action-btn copy-btn" title="Copy Link">🔗</div>
             <div class="card-action-btn collection-btn" title="Add to Collection">📂</div>
             <div class="card-action-btn favorite-btn ${bookmark.favorite ? 'active' : ''}" title="Favorite">❤️</div>
           </div>
        </div>
        <div class="card-content">
          <div class="card-text">${bookmark.text}</div>
          <div class="card-footer">
            <span>@${bookmark.username}</span>
            <span>❤️ ${bookmark.likes}</span>
          </div>
        </div>
      `;

      card.addEventListener('click', (e) => {
        // Prevent opening if clicking an action button
        if (e.target.closest('.card-action-btn')) return;
        window.open(bookmark.url, '_blank');
      });

      // Quick Actions
      const copyBtn = card.querySelector('.copy-btn');
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(bookmark.url);
        this.showToast('Link copied to clipboard!', 'success');
      });

      const collectionBtn = card.querySelector('.collection-btn');
      collectionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.bulkSelection = [bookmark.url];
        this.showCollectionsDialog();
      });

      const favoriteBtn = card.querySelector('.favorite-btn');
      favoriteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        bookmark.favorite = !bookmark.favorite;
        favoriteBtn.classList.toggle('active');
        // Persist change needed? Yes, but batch it or just rely on state?
        // Ideally should save to storage.
        // Quick dirty save:
        await chrome.storage.local.set({ lastExtraction: this.state.lastExtraction });
        this.showToast(bookmark.favorite ? 'Added to favorites' : 'Removed from favorites', 'success');
      });

      container.appendChild(card);
    });

    // Handle Sentinel (Infinite Scroll)
    const existingSentinel = document.getElementById('infinite-scroll-sentinel');
    if (existingSentinel) existingSentinel.remove();

    if (this.state.renderedCount < bookmarks.length) {
      const sentinel = document.createElement('div');
      sentinel.id = 'infinite-scroll-sentinel';
      sentinel.style.height = '20px';
      sentinel.style.width = '100%';
      // sentinel.textContent = 'Loading more...'; // Optional visual
      container.appendChild(sentinel);

      // Update state for NEXT render
      this.state.renderedCount += 50;

      // Observe
      this.observer.observe(sentinel);
    }
  };

  loadSettings = async () => {
    const settings = await chrome.storage.local.get([
      'settings', 'apiKey', 'llmProvider', 'bookmarkMetadata',
      'collections', 'savedSearches', 'viewMode', 'reminders',
      'readingQueue', 'engagementHistory', 'systemPrompt'
    ]);
    if (settings.settings) {
      this.state.isDarkMode = settings.settings.darkMode || false;
      this.updateTheme();
    }
    if (settings.apiKey) {
      this.state.apiKey = settings.apiKey;
    }
    if (settings.llmProvider) {
      this.state.llmProvider = settings.llmProvider;
    }
    if (settings.systemPrompt) {
      this.state.systemPrompt = settings.systemPrompt;
    }
    // NEW v0.10.0
    if (settings.bookmarkMetadata) {
      this.state.bookmarkMetadata = settings.bookmarkMetadata;
    }
    if (settings.collections) {
      this.state.collections = settings.collections;
    }
    if (settings.savedSearches) {
      this.state.savedSearches = settings.savedSearches;
    }
    if (settings.viewMode) {
      this.state.viewMode = settings.viewMode;
    }
    if (settings.reminders) {
      this.state.reminders = settings.reminders;
    }
    // NEW v0.11.0
    if (settings.readingQueue) {
      this.state.readingQueue = settings.readingQueue;
    }
    if (settings.engagementHistory) {
      this.state.engagementHistory = settings.engagementHistory;
    }
  };

  saveSettings = async () => {
    await chrome.storage.local.set({
      settings: {
        darkMode: this.state.isDarkMode
      },
      bookmarkMetadata: this.state.bookmarkMetadata,
      collections: this.state.collections,
      savedSearches: this.state.savedSearches,
      viewMode: this.state.viewMode,
      reminders: this.state.reminders,
      readingQueue: this.state.readingQueue,
      engagementHistory: this.state.engagementHistory
    });
  };

  validateApiKey = (apiKey, provider) => {
    if (!apiKey || typeof apiKey !== 'string') {
      return { valid: false, error: 'API key is required' };
    }

    const trimmedKey = apiKey.trim();

    // Empty check
    if (trimmedKey.length === 0) {
      return { valid: false, error: 'API key cannot be empty' };
    }

    // Provider-specific validation
    if (provider === 'openai') {
      // OpenAI API keys start with 'sk-' and are typically 40+ characters
      if (!trimmedKey.startsWith('sk-')) {
        return { valid: false, error: 'Invalid API key format. OpenAI keys start with "sk-"' };
      }
    } else if (provider === 'anthropic') {
      // Anthropic API keys start with 'sk-ant-'
      if (!trimmedKey.startsWith('sk-ant-')) {
        return { valid: false, error: 'Invalid API key format. Anthropic keys start with "sk-ant-"' };
      }
    } else if (provider === 'gemini') {
      // Gemini API keys usually start with 'AIza'
      if (!trimmedKey.startsWith('AIza')) {
        return { valid: false, error: 'Invalid API key format. Gemini keys usually start with "AIza"' };
      }
    }

    if (trimmedKey.length < this.constants.API_KEY_MIN_LENGTH) {
      return { valid: false, error: 'API key is too short. Please check your key.' };
    }

    return { valid: true, error: null };
  };

  saveApiKey = async (apiKey) => {
    this.state.apiKey = apiKey;
    await chrome.storage.local.set({ apiKey: apiKey });
  };

  loadLastExtraction = async () => {
    const result = await chrome.storage.local.get(['lastExtraction', 'aiAnalysis', 'performanceMetrics', 'manualBookmarks']);

    // Merge native and manual bookmarks for unified view
    let allBookmarks = [];

    if (result.lastExtraction) {
      allBookmarks = result.lastExtraction.bookmarks || [];
      this.updateExtractionStatus(result.lastExtraction.timestamp);
    }

    // Add manual bookmarks with source indicator
    if (result.manualBookmarks && result.manualBookmarks.length > 0) {
      allBookmarks = [...allBookmarks, ...result.manualBookmarks];
    }

    // Remove duplicates based on URL (keep most recent)
    const uniqueBookmarks = [];
    const seenUrls = new Set();

    // Sort by savedAt/timestamp to keep most recent
    allBookmarks.sort((a, b) => {
      const dateA = new Date(a.savedAt || a.dateTime || 0);
      const dateB = new Date(b.savedAt || b.dateTime || 0);
      return dateB - dateA;
    });

    for (const bookmark of allBookmarks) {
      if (bookmark.url && !seenUrls.has(bookmark.url)) {
        uniqueBookmarks.push(bookmark);
        seenUrls.add(bookmark.url);
      }
    }

    this.state.lastExtraction = uniqueBookmarks;
    this.updateUI();

    if (result.aiAnalysis) {
      this.state.aiAnalysis = result.aiAnalysis;
    }
    if (result.performanceMetrics) {
      this.state.performanceMetrics = result.performanceMetrics;
    }
  };

  setupEventListeners = () => {
    // Dark mode toggle
    this.elements.darkModeToggle?.addEventListener('change', e => this.handleDarkModeToggle(e));

    // Clear storage
    this.elements.clearStorageBtn?.addEventListener('click', () => this.handleClearStorage());

    // Scan buttons
    this.elements.scanBtn?.addEventListener('click', () => this.handleScan());
    this.elements.autoScrollBtn?.addEventListener('click', () => this.handleAutoScroll());
    this.elements.bookmarksBtn?.addEventListener('click', () => this.openBookmarksPage());

    // AI Analysis button
    this.elements.analyzeAiBtn?.addEventListener('click', () => this.analyzeBookmarks());

    // Export buttons
    this.elements.exportMdBtn?.addEventListener('click', () => this.downloadMarkdown());
    this.elements.exportCsvBtn?.addEventListener('click', () => this.downloadCSV());
    this.elements.exportJsonBtn?.addEventListener('click', () => this.downloadJSON());
    this.elements.exportHtmlBtn?.addEventListener('click', () => this.downloadHTML());
    this.elements.copyClipboardBtn?.addEventListener('click', () => this.copyToClipboard());

    // Search and filter
    this.elements.searchInput?.addEventListener('input', (e) => {
      this.state.searchQuery = e.target.value;
      this.debouncedSearch();
    });
    this.elements.filterBtn?.addEventListener('click', () => this.showFilterDialog());
    this.elements.sortBtn?.addEventListener('click', () => this.showSortDialog());
    // Settings and close
    this.elements.closeBtn?.addEventListener('click', () => window.close());
    this.elements.settingsBtn?.addEventListener('click', () => this.showSettingsDialog());

    this.elements.viewModeBtn?.addEventListener('click', () => this.toggleViewMode());
    this.elements.exportNotionBtn?.addEventListener('click', () => this.downloadNotion());
    this.elements.exportObsidianBtn?.addEventListener('click', () => this.downloadObsidian());
    this.elements.sentimentBtn?.addEventListener('click', () => this.showSentimentAnalysis());
    this.elements.aiQABtn?.addEventListener('click', () => this.showAIQADialog());
    this.elements.authorAnalyticsBtn?.addEventListener('click', () => this.showAuthorAnalytics());
    this.elements.hiddenGemsBtn?.addEventListener('click', () => this.showHiddenGems());

    // Knowledge Base export
    this.elements.exportKbBtn?.addEventListener('click', () => this.exportKnowledgeBase());

    // License activation
    this.elements.activateLicenseBtn?.addEventListener('click', () => this.handleActivateLicense());
    this.elements.deactivateLicenseBtn?.addEventListener('click', () => this.handleDeactivateLicense());

    // Listen for messages from content script
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'progressUpdate') {
        this.handleProgressUpdate(msg.progress);
      }
      // Note: scanComplete is handled via sendResponse callback, not as a message
    });
  };

  updateUI = () => {
    this.updateExportButtons();
    this.updateProgressBar();
  };

  updateExportButtons = () => {
    const hasData = this.state.lastExtraction && this.state.lastExtraction.length > 0;
    if (this.elements.exportMdBtn) this.elements.exportMdBtn.disabled = !hasData;
    if (this.elements.exportCsvBtn) this.elements.exportCsvBtn.disabled = !hasData;
    if (this.elements.analyzeAiBtn) this.elements.analyzeAiBtn.disabled = !hasData;
    if (this.elements.exportNotionBtn) this.elements.exportNotionBtn.disabled = !hasData;
    if (this.elements.exportObsidianBtn) this.elements.exportObsidianBtn.disabled = !hasData;
    // KB export: needs data. Pro users go through Worker (no personal key needed).
    // Free users need Gemini provider + their own API key.
    if (this.elements.exportKbBtn) {
      this.tierManager.isProUser().then(isPro => {
        const canKb = hasData && (isPro || (this.state.llmProvider === 'gemini' && !!this.state.apiKey));
        this.elements.exportKbBtn.disabled = !canKb;
      }).catch(() => {
        this.elements.exportKbBtn.disabled = !hasData;
      });
    }
  };
  updateProgressBar = () => {
    const { current, total } = this.state.progress;
    if (total > 0) {
      const percent = Math.round((current / total) * 100);
      if (this.elements.progressFill) {
        this.elements.progressFill.style.width = `${percent}%`;
      }
      if (this.elements.progressText) {
        this.elements.progressText.textContent = `${current} / ${total} bookmarks`;
      }
      if (this.elements.progressBar) {
        this.elements.progressBar.style.display = 'block';
      }

      // Update ARIA attributes for accessibility
      const progressBarEl = document.getElementById('progress-bar');
      if (progressBarEl) {
        progressBarEl.setAttribute('aria-valuenow', percent);
        progressBarEl.setAttribute('aria-valuetext', `${current} of ${total} bookmarks processed`);
      }
    } else {
      if (this.elements.progressBar) {
        this.elements.progressBar.style.display = 'none';
      }
    }
  };

  updateTheme = () => {
    document.body.setAttribute('data-theme', this.state.isDarkMode ? 'dark' : 'light');
  };

  updateStatus = (message, type = 'info') => {
    // Legacy support for status bar
    if (this.elements.statusBar) {
      this.elements.statusBar.textContent = message;
      this.elements.statusBar.setAttribute('aria-label', message);
    }

    // Toast notification for user feedback
    this.showToast(message, type);
  };

  showToast = (message, type = 'info') => {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    // Icon based on type
    let icon = '';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';
    else if (type === 'warning') icon = '⚠️';
    else icon = 'ℹ️';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    // Remove after 3 seconds
    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => {
        toast.remove();
        if (container.children.length === 0) {
          container.remove();
        }
      });
    }, 3000);
  };

  updateExtractionStatus = (timestamp) => {
    if (!this.elements.extractionStatus) return;

    if (!this.state.lastExtraction) {
      this.elements.extractionStatus.textContent = '';
      return;
    }

    const age = Date.now() - timestamp;
    const minutes = Math.floor(age / 60000);
    this.elements.extractionStatus.textContent =
      `${this.state.lastExtraction.length} bookmarks from ${minutes} minutes ago`;
  };

  // Event Handlers
  handleDarkModeToggle = async (event) => {
    this.state.isDarkMode = event.target.checked;
    this.updateTheme();
    await this.saveSettings();
  };

  showConfirmDialog = (message, onConfirm) => {
    const dialog = document.createElement('div');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color);
      padding: 24px;
      border-radius: 8px;
      max-width: 400px;
      width: 90%;
    `;

    const messageEl = document.createElement('p');
    messageEl.style.cssText = 'color: var(--text-color); margin: 0 0 16px 0; font-size: 15px;';
    messageEl.textContent = message;
    dialogContent.appendChild(messageEl);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(dialog);
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Confirm';
    confirmBtn.style.cssText = 'padding: 8px 16px; border: none; background: var(--danger-color); color: white; border-radius: 4px; cursor: pointer;';
    confirmBtn.addEventListener('click', () => {
      document.body.removeChild(dialog);
      onConfirm();
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(confirmBtn);
    dialogContent.appendChild(buttonContainer);
    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    // ESC key to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        document.body.removeChild(dialog);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Close on background click
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        document.body.removeChild(dialog);
        document.removeEventListener('keydown', escHandler);
      }
    });
  };

  handleClearStorage = async () => {
    this.showConfirmDialog(
      'Are you sure you want to clear all stored bookmarks and AI analysis? This cannot be undone.',
      async () => {
        this.state.lastExtraction = null;
        this.state.aiAnalysis = null;
        await chrome.storage.local.remove(['lastExtraction', 'aiAnalysis']);

        // Remove AI results display if present
        const existingResults = document.getElementById('ai-results');
        if (existingResults) {
          existingResults.remove();
        }

        this.updateStatus('Stored bookmarks and analysis cleared');
        this.updateUI();
      }
    );
  };

  handleProgressUpdate = (progress) => {
    this.state.progress = progress;
    this.updateUI();
  };

  handleScanComplete = async (bookmarks, performanceData, isQuickScan = false) => {
    this.state.lastExtraction = bookmarks;

    // Store performance metrics
    if (performanceData) {
      this.state.performanceMetrics.lastExtractionTime = performanceData.duration || 0;
      this.state.performanceMetrics.bookmarksExtracted = performanceData.tweetsExtracted || bookmarks.length;
    }

    await chrome.storage.local.set({
      lastExtraction: {
        timestamp: Date.now(),
        bookmarks: bookmarks
      },
      performanceMetrics: this.state.performanceMetrics
    });

    this.updateStatus(`Successfully extracted ${bookmarks.length} bookmark${bookmarks.length !== 1 ? 's' : ''}`);

    // Add helpful feedback for quick scans with few bookmarks
    if (isQuickScan && bookmarks.length < 20) {
      this.updateStatus(`⚠️ Only ${bookmarks.length} visible bookmark${bookmarks.length !== 1 ? 's' : ''} scanned. Use "Scan All Bookmarks" to load and scan ALL your bookmarks!`);
    }

    if (bookmarks.length > this.constants.MAX_SAFE_BOOKMARKS) {
      this.updateStatus('Warning: Large bookmark set detected. Consider batch processing.');
    }

    this.updateUI();

    // Switch to library tab to show results
    this.switchTab('library');

    // Automatically analyze with AI if provider is configured and API key is set (or if using LLM-free mode)
    if (bookmarks.length > 0) {
      if (this.state.llmProvider === 'none') {
        // Auto-analyze with LLM-free mode
        this.analyzeBookmarks();
      } else if (this.state.apiKey && this.state.llmProvider !== 'none') {
        // Auto-analyze with configured LLM provider
        this.analyzeBookmarks();
      }
    }
  };

  handleScan = () => {
    this.updateStatus('Quick scanning visible bookmarks only...');
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'scanBookmarks'
      }, (response) => {
        if (chrome.runtime.lastError) {
          this.updateStatus('Error: Could not connect to page. Please refresh and try again.');
          return;
        }
        if (response && response.success) {
          this.handleScanComplete(response.tweets || [], response.performance, true);
        } else {
          this.updateStatus('Error: Failed to scan bookmarks.');
        }
      });
    });
  };

  handleAutoScroll = () => {
    this.updateStatus('🔄 Auto-scrolling to load all bookmarks... (this may take a minute)');
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tabId = tabs[0].id;

      // Inject progressive scroll & scan script
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: async () => {
          // Progressive scroll and scan function that extracts bookmarks as we scroll
          const progressiveScanAndScroll = async () => {
            const allBookmarks = new Map(); // Use Map to avoid duplicates by URL
            let lastHeight = 0;
            let scrollAttempts = 0;
            const maxAttempts = 50;
            const scrollDelay = 2000;
            const stableAttempts = 3;

            // Helper function to extract bookmarks from current viewport
            const extractCurrentBookmarks = () => {
              const articles = document.querySelectorAll('article');
              const bookmarks = [];

              articles.forEach(article => {
                try {
                  // Extract URL first
                  const link = article.querySelector('a[href*="/status/"]');
                  const url = link ? link.href : '';
                  if (!url) return;

                  // Skip if already extracted
                  if (allBookmarks.has(url)) return;

                  // Extract text
                  const textEls = article.querySelectorAll('[data-testid="tweetText"]');
                  const textParts = [];
                  textEls.forEach(el => {
                    const text = el.textContent?.trim();
                    if (text) textParts.push(text);
                  });
                  const text = textParts.join(' ');

                  // Extract author info
                  let displayName = '';
                  let username = '';
                  const header = article.querySelector('div[role="group"]')?.parentElement?.parentElement;
                  if (header) {
                    const spans = header.querySelectorAll('span');
                    if (spans.length > 0) displayName = spans[0].textContent?.trim() || '';
                    for (const span of spans) {
                      const spanText = span.textContent?.trim();
                      if (spanText && spanText.startsWith('@')) {
                        username = spanText.replace('@', '');
                        break;
                      }
                    }
                  }

                  // Fallback for username from URL
                  if (!username && url) {
                    const match = url.match(/(?:x\.com|twitter\.com)\/([^\/]+)\/status/);
                    if (match) username = match[1];
                  }

                  // Extract timestamp
                  const timeEl = article.querySelector('time');
                  const dateTime = timeEl ? timeEl.getAttribute('datetime') || '' : '';

                  // Extract engagement metrics
                  const extractNumber = (text) => {
                    if (!text) return '';
                    const abbrevMatch = text.match(/([\d,.]+)\s*([KMBkmb])/);
                    if (abbrevMatch) {
                      const num = parseFloat(abbrevMatch[1].replace(/,/g, ''));
                      const suffix = abbrevMatch[2].toUpperCase();
                      const multipliers = { 'K': 1000, 'M': 1000000, 'B': 1000000000 };
                      return Math.round(num * (multipliers[suffix] || 1)).toString();
                    }
                    const numberMatch = text.match(/([\d,.]+)/);
                    return numberMatch ? numberMatch[1].replace(/,/g, '') : '';
                  };

                  const likeEl = article.querySelector('[data-testid="like"]');
                  const likes = likeEl ? extractNumber(likeEl.textContent) : '';

                  const retweetEl = article.querySelector('[data-testid="retweet"]');
                  const retweets = retweetEl ? extractNumber(retweetEl.textContent) : '';

                  const replyEl = article.querySelector('[data-testid="reply"]');
                  const replies = replyEl ? extractNumber(replyEl.textContent) : '';

                  let views = '';
                  const viewEls = article.querySelectorAll('a[aria-label*="View"], span[aria-label*="View"]');
                  for (const el of viewEls) {
                    const label = el.getAttribute('aria-label');
                    if (label && /view/i.test(label)) {
                      views = extractNumber(label);
                      break;
                    }
                  }

                  bookmarks.push({
                    url,
                    text,
                    displayName,
                    username,
                    dateTime,
                    likes,
                    retweets,
                    replies,
                    views
                  });
                } catch (err) {
                  console.error('[X Extractor] Error extracting bookmark:', err);
                }
              });

              return bookmarks;
            };

            // Scroll and extract progressively
            while (scrollAttempts < maxAttempts) {
              // Extract bookmarks at current scroll position
              const currentBookmarks = extractCurrentBookmarks();
              currentBookmarks.forEach(bookmark => {
                allBookmarks.set(bookmark.url, bookmark);
              });

              // Progress update
              console.log(`[X Extractor] Extracted ${allBookmarks.size} bookmarks so far...`);

              // Smart Scroll: Wait for network activity or timeout
              const previousHeight = document.body.scrollHeight;
              window.scrollTo(0, previousHeight);

              // Wait for either network response or timeout
              await new Promise(resolve => {
                let resolved = false;
                const timeoutId = setTimeout(() => {
                  if (!resolved) { resolved = true; resolve(); }
                }, 4000); // 4s timeout (fallback)

                const handler = () => {
                  if (!resolved) {
                    resolved = true;
                    clearTimeout(timeoutId);
                    window.removeEventListener('x-bookmarks-response', handler);
                    // Add small delay for render
                    setTimeout(resolve, 500);
                  }
                };

                window.addEventListener('x-bookmarks-response', handler);
              });

              const newHeight = document.body.scrollHeight;
              if (newHeight === lastHeight) {
                scrollAttempts++;
                if (scrollAttempts >= stableAttempts) break;
              } else {
                scrollAttempts = 0;
              }
              lastHeight = newHeight;
            }

            // Final extraction at the bottom
            const finalBookmarks = extractCurrentBookmarks();
            finalBookmarks.forEach(bookmark => {
              allBookmarks.set(bookmark.url, bookmark);
            });

            // Return all extracted bookmarks
            return {
              success: true,
              bookmarks: Array.from(allBookmarks.values()),
              count: allBookmarks.size
            };
          };

          return await progressiveScanAndScroll();
        }
      }, (results) => {
        // Check for errors
        if (chrome.runtime.lastError) {
          this.updateStatus('Error during auto-scroll. Please refresh and try again.');
          return;
        }

        if (!results || !results[0] || !results[0].result) {
          this.updateStatus('Error: Failed to extract bookmarks.');
          return;
        }

        const result = results[0].result;
        if (result.success && result.bookmarks) {
          this.updateStatus(`✓ Successfully extracted ${result.count} bookmark${result.count !== 1 ? 's' : ''}!`);
          this.handleScanComplete(result.bookmarks, { duration: 0, tweetsExtracted: result.count }, false);
        } else {
          this.updateStatus('Error: Failed to scan bookmarks.');
        }
      });
    });
  };

  analyzeBookmarks = async () => {
    if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
      this.updateStatus('No bookmarks to analyze.');
      return;
    }

    // Check if LLM provider is configured
    if (this.state.llmProvider === 'none') {
      // Use LLM-free analysis
      this.analyzeLLMFree();
      return;
    }

    if (!this.state.apiKey && this.state.llmProvider !== 'none') {
      this.updateStatus('No API key configured. Click settings to add one or use LLM-free mode.');
      return;
    }

    // Show loading state
    if (this.elements.analyzeAiBtn) {
      this.elements.analyzeAiBtn.disabled = true;
      this.elements.analyzeAiBtn.textContent = 'Analyzing...';
    }

    const startTime = performance.now();
    const bookmarkCount = this.state.lastExtraction.length;
    const analyzeCount = Math.min(bookmarkCount, this.constants.AI_ANALYSIS_LIMIT);

    if (bookmarkCount > this.constants.AI_ANALYSIS_LIMIT) {
      this.updateStatus(`Analyzing first ${analyzeCount} of ${bookmarkCount} bookmarks...`);
    } else {
      this.updateStatus(`Analyzing ${analyzeCount} bookmarks...`);
    }

    try {
      const provider = this.createLLMProvider();
      const analysis = await this.retryOperation(() => provider.analyzeBookmarks(this.state.lastExtraction));

      // Store performance metrics
      const duration = Math.round(performance.now() - startTime);
      this.state.performanceMetrics.lastAnalysisTime = duration;
      await chrome.storage.local.set({ performanceMetrics: this.state.performanceMetrics });

      this.state.aiAnalysis = analysis;
      await chrome.storage.local.set({ aiAnalysis: analysis });

      let statusMsg = `Analysis complete! Found ${analysis.tags.length} tags and ${analysis.categories.length} categories.`;
      if (bookmarkCount > this.constants.AI_ANALYSIS_LIMIT) {
        statusMsg += ` (Analyzed first ${this.constants.AI_ANALYSIS_LIMIT} of ${bookmarkCount} bookmarks)`;
      }

      this.updateStatus(statusMsg);
      this.showAnalysisResults(analysis);
    } catch (error) {
      console.error('AI Analysis error:', error);
      this.updateStatus(`Analysis failed: ${error.message}`);
    } finally {
      // Reset button state
      if (this.elements.analyzeAiBtn) {
        this.elements.analyzeAiBtn.disabled = false;
        this.elements.analyzeAiBtn.textContent = 'Analyze Bookmarks';
      }
    }
  };

  createLLMProvider = (modelTier = 'flash') => {
    switch (this.state.llmProvider) {
      case 'gemini':
        return new GeminiProviderClass(this.state.apiKey, this.constants, modelTier);
      case 'openai':
        return new OpenAIProvider(this.state.apiKey, this.state.systemPrompt);
      case 'anthropic':
        return new AnthropicProvider(this.state.apiKey, this.state.systemPrompt);
      case 'none':
        return new LLMFreeProvider(this.constants);
      default:
        throw new Error('Unknown LLM provider');
    }
  };

  createGeminiProvider = async () => {
    const isPro = await this.tierManager.isProUser();
    if (isPro) {
      // Pro: route through Worker so the Gemini Pro key never leaves the server
      const token = await this.tierManager.getToken();
      return new ProxyGeminiProvider(token, WORKER_URL, this.constants);
    }
    // Free: call Gemini Flash directly with the user's own API key
    return new GeminiProviderClass(this.state.apiKey, this.constants, 'flash');
  };

  analyzeLLMFree = async () => {
    // Show loading state
    if (this.elements.analyzeAiBtn) {
      this.elements.analyzeAiBtn.disabled = true;
      this.elements.analyzeAiBtn.textContent = 'Analyzing...';
    }

    const startTime = performance.now();
    const bookmarkCount = this.state.lastExtraction.length;
    this.updateStatus(`Analyzing ${bookmarkCount} bookmarks (LLM-free mode)...`);

    try {
      const provider = new LLMFreeProvider(this.constants);
      const analysis = await provider.analyzeBookmarks(this.state.lastExtraction);

      // Store performance metrics
      const duration = Math.round(performance.now() - startTime);
      this.state.performanceMetrics.lastAnalysisTime = duration;
      await chrome.storage.local.set({ performanceMetrics: this.state.performanceMetrics });

      this.state.aiAnalysis = analysis;
      await chrome.storage.local.set({ aiAnalysis: analysis });

      this.updateStatus(`Analysis complete! Found ${analysis.tags.length} tags and ${analysis.categories.length} categories.`);
      this.showAnalysisResults(analysis);
    } catch (error) {
      console.error('Analysis error:', error);
      this.updateStatus(`Analysis failed: ${error.message}`);
    } finally {
      // Reset button state
      if (this.elements.analyzeAiBtn) {
        this.elements.analyzeAiBtn.disabled = false;
        this.elements.analyzeAiBtn.textContent = 'Analyze Bookmarks';
      }
    }
  };

  // Sanitize text to prevent XSS attacks
  sanitizeText = (text) => {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  showAnalysisResults = (analysis) => {
    // Create analysis results display
    const existingResults = document.getElementById('ai-results');
    if (existingResults) {
      existingResults.remove();
    }

    // Create container using DOM methods instead of innerHTML
    const resultsDiv = document.createElement('div');
    resultsDiv.id = 'ai-results';
    resultsDiv.style.cssText = `
      margin: 16px 0;
      padding: 16px;
      background: var(--bg-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
    `;

    // Title
    const title = document.createElement('h3');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'AI Analysis Results';
    resultsDiv.appendChild(title);

    // Overall summary
    if (analysis.overallSummary) {
      const summaryDiv = document.createElement('div');
      summaryDiv.style.cssText = 'margin-bottom: 16px;';

      const summaryLabel = document.createElement('strong');
      summaryLabel.style.color = 'var(--text-color)';
      summaryLabel.textContent = 'Overall Summary:';
      summaryDiv.appendChild(summaryLabel);

      const summaryText = document.createElement('p');
      summaryText.style.cssText = 'color: var(--text-color); margin: 8px 0;';
      summaryText.textContent = analysis.overallSummary; // textContent auto-escapes
      summaryDiv.appendChild(summaryText);

      resultsDiv.appendChild(summaryDiv);
    }

    // Tags
    if (analysis.tags && analysis.tags.length > 0) {
      const tagsDiv = document.createElement('div');
      tagsDiv.style.cssText = 'margin-bottom: 16px;';

      const tagsLabel = document.createElement('strong');
      tagsLabel.style.color = 'var(--text-color)';
      tagsLabel.textContent = 'Tags:';
      tagsDiv.appendChild(tagsLabel);

      tagsDiv.appendChild(document.createElement('br'));

      const tagsContainer = document.createElement('div');
      tagsContainer.style.cssText = 'margin-top: 8px;';

      analysis.tags.forEach(tag => {
        const tagSpan = document.createElement('span');
        tagSpan.style.cssText = 'display: inline-block; background: var(--primary-color); color: white; padding: 4px 12px; margin: 4px; border-radius: 16px; font-size: 12px;';
        tagSpan.textContent = tag; // textContent auto-escapes
        tagsContainer.appendChild(tagSpan);
      });

      tagsDiv.appendChild(tagsContainer);
      resultsDiv.appendChild(tagsDiv);
    }

    // Categories
    if (analysis.categories && analysis.categories.length > 0) {
      const categoriesDiv = document.createElement('div');
      categoriesDiv.style.cssText = 'margin-bottom: 16px;';

      const categoriesLabel = document.createElement('strong');
      categoriesLabel.style.color = 'var(--text-color)';
      categoriesLabel.textContent = 'Categories:';
      categoriesDiv.appendChild(categoriesLabel);

      const categoriesList = document.createElement('ul');
      categoriesList.style.cssText = 'color: var(--text-color); margin: 8px 0; padding-left: 20px;';

      analysis.categories.forEach(cat => {
        const li = document.createElement('li');
        li.textContent = cat; // textContent auto-escapes
        categoriesList.appendChild(li);
      });

      categoriesDiv.appendChild(categoriesList);
      resultsDiv.appendChild(categoriesDiv);
    }

    // Analyze more button
    const analyzeBtn = document.createElement('button');
    analyzeBtn.id = 'analyzeBtn';
    analyzeBtn.style.cssText = 'background: var(--primary-color); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 8px;';
    analyzeBtn.textContent = 'Re-analyze';
    analyzeBtn.addEventListener('click', () => this.analyzeBookmarks());
    resultsDiv.appendChild(analyzeBtn);

    // Insert after status container
    const statusContainer = document.querySelector('.status-container');
    if (statusContainer && statusContainer.parentNode) {
      statusContainer.parentNode.insertBefore(resultsDiv, statusContainer.nextSibling);
    }
  };

  showSettingsDialog = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'settings-dialog-title');
    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color);
      padding: 24px;
      border-radius: 8px;
      max-width: 450px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
    `;

    const providerOptions = `
      <option value="none" ${this.state.llmProvider === 'none' ? 'selected' : ''}>None (LLM-free mode)</option>
      <option value="openai" ${this.state.llmProvider === 'openai' ? 'selected' : ''}>OpenAI</option>
      <option value="anthropic" ${this.state.llmProvider === 'anthropic' ? 'selected' : ''}>Anthropic (Claude)</option>
      <option value="gemini" ${this.state.llmProvider === 'gemini' ? 'selected' : ''}>Google Gemini (Free Tier Available)</option>
    `;

    dialogContent.innerHTML = `
      <h2 id="settings-dialog-title" style="margin-top: 0; color: var(--text-color);">Settings</h2>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Analysis Provider:
          <select id="providerSelect" style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
            ${providerOptions}
          </select>
        </label>
        <small style="color: var(--disabled-color);">
          <strong>Free & Private:</strong> Bring your own API key to analyze bookmarks. 
          Google Gemini has a generous free tier. Your key is stored locally.
        </small>
      </div>

      <div id="apiKeySection" style="margin-bottom: 16px; ${this.state.llmProvider === 'none' ? 'display: none;' : ''}">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          <span id="apiKeyLabel">API Key:</span>
          <input type="password" id="apiKeyInput" value="${this.state.apiKey}"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
        <small id="apiKeyHelp" style="color: var(--disabled-color);"></small>
      </div>
      
      <div id="systemPromptSection" style="margin-bottom: 24px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          System Prompt (Optional):
          <textarea id="systemPromptInput" 
                 placeholder="Custom instructions for the AI (e.g., 'Focus on technical details', 'Summarize as bullet points'). Default is 'You are a helpful assistant...'"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color); min-height: 80px; resize: vertical;">${this.state.systemPrompt || ''}</textarea>
        </label>
        <small style="color: var(--disabled-color);">Override the default AI personality and instructions.</small>
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="cancelBtn" style="padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;">Cancel</button>
        <button id="saveBtn" style="padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;">Save</button>
      </div>
    `;

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    // Update API key section based on provider selection
    const updateApiKeySection = (provider) => {
      const apiKeySection = document.getElementById('apiKeySection');
      const apiKeyLabel = document.getElementById('apiKeyLabel');
      const apiKeyHelp = document.getElementById('apiKeyHelp');
      const systemPromptSection = document.getElementById('systemPromptSection');

      // System Prompt only applicable for LLMs
      systemPromptSection.style.display = provider === 'none' ? 'none' : 'block';

      if (provider === 'none') {
        apiKeySection.style.display = 'none';
      } else {
        apiKeySection.style.display = 'block';
        if (provider === 'openai') {
          apiKeyLabel.textContent = 'OpenAI API Key:';
          apiKeyHelp.innerHTML = 'Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" style="color: var(--primary-color);">OpenAI</a>';
        } else if (provider === 'anthropic') {
          apiKeyLabel.textContent = 'Anthropic API Key:';
          apiKeyHelp.innerHTML = 'Get your API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color: var(--primary-color);">Anthropic Console</a>';
        } else if (provider === 'gemini') {
          apiKeyLabel.textContent = 'Gemini API Key (Recommended):';
          apiKeyHelp.innerHTML = 'Free to use! Get your key from <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: var(--primary-color);">Google AI Studio</a>';
        }
      }
    };

    // Initialize API key section
    const providerSelect = document.getElementById('providerSelect');
    updateApiKeySection(providerSelect.value);

    // Handle provider selection change
    providerSelect.addEventListener('change', (e) => {
      updateApiKeySection(e.target.value);
    });

    // Store currently focused element to restore later
    const previouslyFocused = document.activeElement;

    // Get all focusable elements in dialog
    const getFocusableElements = () => {
      return dialogContent.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
    };

    // Focus first element
    const focusableElements = getFocusableElements();
    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    // Focus trap
    const handleTabKey = (e) => {
      const focusables = Array.from(getFocusableElements());
      const firstFocusable = focusables[0];
      const lastFocusable = focusables[focusables.length - 1];

      if (e.key === 'Tab') {
        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            e.preventDefault();
            lastFocusable.focus();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            e.preventDefault();
            firstFocusable.focus();
          }
        }
      }
    };

    const closeDialog = () => {
      document.body.removeChild(dialog);
      document.removeEventListener('keydown', handleDialogKeys);
      if (previouslyFocused) {
        previouslyFocused.focus();
      }
    };

    // ESC key and tab trap
    const handleDialogKeys = (e) => {
      if (e.key === 'Escape') {
        closeDialog();
      } else {
        handleTabKey(e);
      }
    };

    document.addEventListener('keydown', handleDialogKeys);

    // Event handlers
    document.getElementById('cancelBtn').addEventListener('click', closeDialog);

    document.getElementById('saveBtn').addEventListener('click', async () => {
      const provider = document.getElementById('providerSelect').value;
      const apiKey = document.getElementById('apiKeyInput').value.trim();
      const systemPrompt = document.getElementById('systemPromptInput').value.trim();

      // Validate API key before saving (only if provider requires it)
      if (provider !== 'none' && apiKey.length > 0) {
        const validation = this.validateApiKey(apiKey, provider);
        if (!validation.valid) {
          // Show error in dialog
          const existingError = document.getElementById('apiKeyError');
          if (existingError) {
            existingError.textContent = validation.error;
          } else {
            const errorDiv = document.createElement('div');
            errorDiv.id = 'apiKeyError';
            errorDiv.style.cssText = 'color: var(--danger-color); font-size: 13px; margin-top: 8px;';
            errorDiv.textContent = validation.error;
            const inputParent = document.getElementById('apiKeyInput').parentElement;
            inputParent.appendChild(errorDiv);
          }
          // Keep focus on input
          document.getElementById('apiKeyInput').focus();
          return;
        }
      }

      // Save provider, API key, and prompt
      this.state.llmProvider = provider;
      this.state.systemPrompt = systemPrompt;

      const storageData = {
        llmProvider: provider,
        systemPrompt: systemPrompt
      };

      await chrome.storage.local.set(storageData);

      if (provider !== 'none') {
        await this.saveApiKey(apiKey);
      }

      this.updateStatus('Settings saved!');
      closeDialog();
    });

    // Close on background click
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog();
      }
    });
  };

  render = () => {
    // Update UI based on current state
    this.updateUI();

    // Show AI results if available
    if (this.state.aiAnalysis) {
      this.showAnalysisResults(this.state.aiAnalysis);
    }
  };

  generateMarkdown = () => {
    const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
    if (!bookmarks || bookmarks.length === 0) return '';

    const exportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    // Use array for better performance
    const mdParts = [
      `# X Bookmarks Export\n\n`,
      `**Exported:** ${exportDate}\n`,
      `**Total Bookmarks:** ${bookmarks.length}\n\n`,
      `---\n\n`
    ];

    // Process bookmarks with simplified format
    bookmarks.forEach((bookmark, index) => {
      mdParts.push(`## Bookmark ${index + 1}\n\n`);

      // Tweet text
      if (bookmark.text) {
        mdParts.push(`**Text:** ${bookmark.text}\n\n`);
      }

      // Tweet owner
      const ownerName = bookmark.displayName || 'Unknown';
      const ownerHandle = bookmark.username ? `@${bookmark.username}` : '@unknown';
      mdParts.push(`**Owner:** ${ownerName} (${ownerHandle})\n\n`);

      // Category tags (max 5)
      const tags = [];

      // First, check for custom tags for this specific bookmark
      const customTags = this.getCustomTags(bookmark.url);
      if (customTags && customTags.length > 0) {
        tags.push(...customTags.slice(0, 5));
      }

      // If no custom tags or less than 5, add from AI analysis
      if (tags.length < 5 && this.state.aiAnalysis && this.state.aiAnalysis.tags) {
        const remainingSlots = 5 - tags.length;
        const aiTags = this.state.aiAnalysis.tags.slice(0, remainingSlots);
        tags.push(...aiTags);
      }

      if (tags.length > 0) {
        mdParts.push(`**Tags:** ${tags.join(', ')}\n\n`);
      }

      // Link
      mdParts.push(`**Link:** ${bookmark.url}\n\n`);

      // Media Links (High Quality)
      if (bookmark.media && bookmark.media.length > 0) {
        mdParts.push(`**Media:**\n`);
        bookmark.media.forEach(m => {
          mdParts.push(`- [${m.type === 'video' ? 'Video (MP4)' : 'Image (Original)'}](${m.url})\n`);
        });
        mdParts.push(`\n`);
      }

      mdParts.push(`---\n\n`);
    });

    return mdParts.join('');
  };

  calculateBasicStats = (bookmarks) => {
    let totalLikes = 0;
    let totalRetweets = 0;
    const authorCounts = {};
    let minDate = null;
    let maxDate = null;

    bookmarks.forEach(b => {
      totalLikes += parseInt(b.likes || 0);
      totalRetweets += parseInt(b.retweets || 0);

      if (b.username) {
        authorCounts[b.username] = (authorCounts[b.username] || 0) + 1;
      }

      if (b.dateTime) {
        const date = new Date(b.dateTime);
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }
    });

    const avgLikes = bookmarks.length > 0 ? totalLikes / bookmarks.length : 0;

    let topAuthor = { username: null, count: 0 };
    Object.entries(authorCounts).forEach(([username, count]) => {
      if (count > topAuthor.count) {
        topAuthor = { username, count };
      }
    });

    let dateRange = 'N/A';
    if (minDate && maxDate) {
      const minStr = minDate.toLocaleDateString();
      const maxStr = maxDate.toLocaleDateString();
      dateRange = minStr === maxStr ? minStr : `${minStr} - ${maxStr}`;
    }

    return {
      totalLikes,
      totalRetweets,
      avgLikes,
      topAuthor,
      dateRange
    };
  };

  generateCSV = () => {
    const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
    if (!bookmarks || bookmarks.length === 0) return '';

    const escapeCSV = (val) => {
      if (val === undefined || val === null) return '';
      const str = String(val).replace(/\n/g, ' ');
      if (/[",]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const rows = [];

    // Helper to format media links
    const formatMedia = (media) => {
      if (!media || media.length === 0) return '';
      return media.map(m => m.url).join('; ');
    };

    // Header row
    if (this.state.aiAnalysis) {
      rows.push('Author,Username,Date,Text,Likes,Retweets,Replies,Views,Link,Media URLs,Tags,Categories');
      const tags = this.state.aiAnalysis.tags ? this.state.aiAnalysis.tags.join('; ') : '';
      const categories = this.state.aiAnalysis.categories ? this.state.aiAnalysis.categories.join('; ') : '';

      bookmarks.forEach(t => {
        rows.push([
          escapeCSV(t.displayName || ''),
          escapeCSV('@' + (t.username || '')),
          escapeCSV(t.dateTime || ''),
          escapeCSV(t.text || ''),
          escapeCSV(t.likes || ''),
          escapeCSV(t.retweets || ''),
          escapeCSV(t.replies || ''),
          escapeCSV(t.views || ''),
          escapeCSV(t.url),
          escapeCSV(formatMedia(t.media)),
          escapeCSV(tags),
          escapeCSV(categories)
        ].join(','));
      });
    } else {
      rows.push('Author,Username,Date,Text,Likes,Retweets,Replies,Views,Link,Media URLs');
      bookmarks.forEach(t => {
        rows.push([
          escapeCSV(t.displayName || ''),
          escapeCSV('@' + (t.username || '')),
          escapeCSV(t.dateTime || ''),
          escapeCSV(t.text || ''),
          escapeCSV(t.likes || ''),
          escapeCSV(t.retweets || ''),
          escapeCSV(t.replies || ''),
          escapeCSV(t.views || ''),
          escapeCSV(t.url),
          escapeCSV(formatMedia(t.media))
        ].join(','));
      });
    }

    return rows.join('\n');
  };

  downloadMarkdown = () => {
    const md = this.generateMarkdown();
    if (!md) return;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-bookmarks-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.updateStatus('Downloaded Markdown file!');
  };

  downloadCSV = () => {
    const csv = this.generateCSV();
    if (!csv) return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-bookmarks-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.updateStatus('Downloaded CSV file!');
  };

  copyToClipboard = async () => {
    console.log('[Clipboard] Copy button clicked');

    // Check if we have bookmarks to copy
    if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
      console.warn('[Clipboard] No bookmarks in state');
      this.updateStatus('⚠️ No bookmarks to copy. Please scan bookmarks first.');
      return;
    }

    console.log(`[Clipboard] State has ${this.state.lastExtraction.length} bookmarks`);

    const md = this.generateMarkdown();
    if (!md || md.trim() === '') {
      console.error('[Clipboard] generateMarkdown returned empty string');
      this.updateStatus('⚠️ No content to copy. Please scan bookmarks first.');
      return;
    }

    const bookmarkCount = this.state.lastExtraction.length;
    console.log(`[Clipboard] Generated markdown: ${md.length} characters`);
    console.log(`[Clipboard] First 200 chars:`, md.substring(0, 200));
    console.log(`[Clipboard] Attempting to copy ${bookmarkCount} bookmarks`);

    try {
      // Try modern Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        console.log('[Clipboard] Using Clipboard API');
        await navigator.clipboard.writeText(md);
        this.updateStatus(`✓ Copied ${bookmarkCount} bookmark${bookmarkCount !== 1 ? 's' : ''} to clipboard! (${Math.round(md.length / 1024)}KB)`);
        console.log('[Clipboard] ✓ Successfully copied using Clipboard API');

        // Verify it was actually copied
        try {
          const clipboardContent = await navigator.clipboard.readText();
          console.log(`[Clipboard] Verified clipboard has ${clipboardContent.length} characters`);
        } catch (readErr) {
          console.warn('[Clipboard] Could not verify clipboard (permission denied):', readErr.message);
        }
      } else {
        // Fallback to legacy method
        console.log('[Clipboard] Clipboard API not available, using fallback');
        this.fallbackCopyToClipboard(md);
      }
    } catch (err) {
      console.error('[Clipboard] Error copying to clipboard:', err);
      console.error('[Clipboard] Error name:', err.name);
      console.error('[Clipboard] Error message:', err.message);
      // Try fallback method
      this.fallbackCopyToClipboard(md);
    }
  };

  fallbackCopyToClipboard = (text) => {
    console.log('[Clipboard] Attempting fallback copy method');
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      const successful = document.execCommand('copy');
      if (successful) {
        const count = this.state.lastExtraction ? this.state.lastExtraction.length : 0;
        this.updateStatus(`✓ Copied ${count} bookmark${count !== 1 ? 's' : ''} to clipboard!`);
        console.log('[Clipboard] Successfully copied using fallback method');
      } else {
        console.error('[Clipboard] execCommand copy returned false');
        this.updateStatus('⚠️ Failed to copy. Please try using a download option instead.');
      }
    } catch (err) {
      console.error('[Clipboard] Fallback copy failed:', err);
      this.updateStatus('⚠️ Clipboard copy failed. Please try using a download option instead.');
    } finally {
      document.body.removeChild(textarea);
    }
  };

  openBookmarksPage = () => {
    const url = 'https://x.com/i/bookmarks';
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        chrome.tabs.update(tabs[0].id, { url });
      } else {
        chrome.tabs.create({ url });
      }
    });
  };

  // Utility: Debounce function
  debounce = (func, wait) => {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  };

  // Search functionality
  performSearch = () => {
    if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
      return;
    }

    const query = this.state.searchQuery.toLowerCase().trim();

    if (!query) {
      this.state.filteredBookmarks = null;
      this.updateStatus(`Showing all ${this.state.lastExtraction.length} bookmarks`);
      return;
    }

    this.state.filteredBookmarks = this.state.lastExtraction.filter(bookmark => {
      return (
        bookmark.text?.toLowerCase().includes(query) ||
        bookmark.displayName?.toLowerCase().includes(query) ||
        bookmark.username?.toLowerCase().includes(query)
      );
    });

    this.updateStatus(`Found ${this.state.filteredBookmarks.length} bookmarks matching "${this.state.searchQuery}"`);
  };

  // Filter dialog
  showFilterDialog = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 450px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    dialogContent.innerHTML = `
      <h2 style="margin-top: 0; color: var(--text-color);">Filter Bookmarks</h2>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Min Likes:
          <input type="number" id="minLikes" value="${this.state.filterOptions.minLikes}" min="0"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Min Retweets:
          <input type="number" id="minRetweets" value="${this.state.filterOptions.minRetweets}" min="0"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Author Username:
          <input type="text" id="authorFilter" value="${this.state.filterOptions.author}" placeholder="@username"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Date From:
          <input type="date" id="dateFrom" value="${this.state.filterOptions.dateFrom}"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Date To:
          <input type="date" id="dateTo" value="${this.state.filterOptions.dateTo}"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Read Status:
          <select id="readStatus" style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
            <option value="all" ${this.state.filterOptions.readStatus === 'all' ? 'selected' : ''}>All</option>
            <option value="read" ${this.state.filterOptions.readStatus === 'read' ? 'selected' : ''}>Read Only</option>
            <option value="unread" ${this.state.filterOptions.readStatus === 'unread' ? 'selected' : ''}>Unread Only</option>
          </select>
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; color: var(--text-color); cursor: pointer;">
          <input type="checkbox" id="hasNotes" ${this.state.filterOptions.hasNotes ? 'checked' : ''}
                 style="margin-right: 8px;">
          Only show bookmarks with notes
        </label>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="resetBtn" style="padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;">Reset</button>
        <button id="cancelBtn" style="padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;">Cancel</button>
        <button id="applyBtn" style="padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;">Apply</button>
      </div>
    `;

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    const closeDialog = () => document.body.removeChild(dialog);

    document.getElementById('cancelBtn').addEventListener('click', closeDialog);
    document.getElementById('resetBtn').addEventListener('click', () => {
      this.state.filterOptions = { minLikes: 0, minRetweets: 0, author: '', dateFrom: '', dateTo: '', readStatus: 'all', hasNotes: false, collections: [] };
      this.state.filteredBookmarks = null;
      this.updateStatus(`Showing all ${this.state.lastExtraction?.length || 0} bookmarks`);
      closeDialog();
    });

    document.getElementById('applyBtn').addEventListener('click', () => {
      this.state.filterOptions.minLikes = parseInt(document.getElementById('minLikes').value) || 0;
      this.state.filterOptions.minRetweets = parseInt(document.getElementById('minRetweets').value) || 0;
      this.state.filterOptions.author = document.getElementById('authorFilter').value.replace('@', '').trim();
      this.state.filterOptions.dateFrom = document.getElementById('dateFrom').value;
      this.state.filterOptions.dateTo = document.getElementById('dateTo').value;
      this.state.filterOptions.readStatus = document.getElementById('readStatus').value;
      this.state.filterOptions.hasNotes = document.getElementById('hasNotes').checked;

      this.applyFilters();
      closeDialog();
    });

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });
  };

  applyFilters = () => {
    if (!this.state.lastExtraction) return;

    this.state.filteredBookmarks = this.state.lastExtraction.filter(bookmark => {
      const likes = parseInt(bookmark.likes) || 0;
      const retweets = parseInt(bookmark.retweets) || 0;
      const username = bookmark.username?.toLowerCase() || '';
      const targetAuthor = this.state.filterOptions.author.toLowerCase();

      // Basic filters
      if (likes < this.state.filterOptions.minLikes) return false;
      if (retweets < this.state.filterOptions.minRetweets) return false;
      if (targetAuthor && !username.includes(targetAuthor)) return false;

      // Date range filter
      if (this.state.filterOptions.dateFrom || this.state.filterOptions.dateTo) {
        const bookmarkDate = new Date(bookmark.dateTime);
        if (this.state.filterOptions.dateFrom) {
          const fromDate = new Date(this.state.filterOptions.dateFrom);
          if (bookmarkDate < fromDate) return false;
        }
        if (this.state.filterOptions.dateTo) {
          const toDate = new Date(this.state.filterOptions.dateTo);
          toDate.setHours(23, 59, 59, 999); // Include full day
          if (bookmarkDate > toDate) return false;
        }
      }

      // Read status filter
      if (this.state.filterOptions.readStatus !== 'all') {
        const isRead = this.getReadStatus(bookmark.url);
        if (this.state.filterOptions.readStatus === 'read' && !isRead) return false;
        if (this.state.filterOptions.readStatus === 'unread' && isRead) return false;
      }

      // Has notes filter
      if (this.state.filterOptions.hasNotes) {
        const notes = this.getBookmarkNote(bookmark.url);
        if (!notes || notes.trim() === '') return false;
      }

      return true;
    });

    this.updateStatus(`Filtered to ${this.state.filteredBookmarks.length} bookmarks`);
  };

  // Performance metrics dialog
  showMetricsDialog = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 400px; width: 90%;
    `;

    const metrics = this.state.performanceMetrics;
    const extractionTime = metrics.lastExtractionTime ? `${metrics.lastExtractionTime}ms` : 'N/A';
    const analysisTime = metrics.lastAnalysisTime ? `${metrics.lastAnalysisTime}ms` : 'N/A';
    const bookmarksCount = metrics.bookmarksExtracted || this.state.lastExtraction?.length || 0;

    const providerDisplay = this.state.llmProvider === 'none'
      ? 'LLM-Free Mode'
      : (this.state.llmProvider || 'None').toUpperCase();

    dialogContent.innerHTML = `
      <h2 style="margin-top: 0; color: var(--text-color);">Performance Metrics</h2>
      <div style="color: var(--text-color); margin-bottom: 16px;">
        <p><strong>Last Extraction Time:</strong> ${extractionTime}</p>
        <p><strong>Last Analysis Time:</strong> ${analysisTime}</p>
        <p><strong>Bookmarks Extracted:</strong> ${bookmarksCount}</p>
        <p><strong>Current Provider:</strong> ${providerDisplay}</p>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="closeMetricsBtn" style="padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;">Close</button>
      </div>
    `;

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    const closeDialog = () => document.body.removeChild(dialog);
    document.getElementById('closeMetricsBtn').addEventListener('click', closeDialog);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });
  };

  // JSON export functionality
  downloadJSON = () => {
    const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
    if (!bookmarks || bookmarks.length === 0) return;

    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        totalBookmarks: bookmarks.length,
        version: '0.8.0',
        llmProvider: this.state.llmProvider
      },
      analysis: this.state.aiAnalysis || null,
      statistics: this.calculateBasicStats(bookmarks),
      bookmarks: bookmarks
    };

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-bookmarks-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.updateStatus('Downloaded JSON file!');
  };

  // Retry operation with exponential backoff
  retryOperation = async (operation, attempts = this.constants.API_RETRY_ATTEMPTS) => {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) {
          const delay = this.constants.API_RETRY_DELAY * Math.pow(2, i);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  };

  // ====== NEW FEATURES v0.9.0 ======

  // FEATURE: Duplicate Detection
  detectDuplicates = () => {
    if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
      this.updateStatus('No bookmarks to check for duplicates.');
      return;
    }

    const urlMap = new Map();
    const duplicates = [];

    this.state.lastExtraction.forEach((bookmark, index) => {
      if (urlMap.has(bookmark.url)) {
        duplicates.push({ original: urlMap.get(bookmark.url), duplicate: index, url: bookmark.url });
      } else {
        urlMap.set(bookmark.url, index);
      }
    });

    if (duplicates.length === 0) {
      this.updateStatus('No duplicates found! All bookmarks are unique.');
      return;
    }

    // Show duplicates dialog
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = `Found ${duplicates.length} Duplicate(s)`;
    dialogContent.appendChild(title);

    const info = document.createElement('p');
    info.style.cssText = 'color: var(--text-color); margin-bottom: 16px;';
    info.textContent = 'The following bookmarks appear multiple times:';
    dialogContent.appendChild(info);

    const list = document.createElement('ul');
    list.style.cssText = 'color: var(--text-color); max-height: 300px; overflow-y: auto;';
    duplicates.forEach(dup => {
      const li = document.createElement('li');
      li.style.cssText = 'margin-bottom: 8px; word-break: break-all;';
      li.textContent = `${dup.url.substring(0, 60)}...`;
      list.appendChild(li);
    });
    dialogContent.appendChild(list);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;';

    const removeDupsBtn = document.createElement('button');
    removeDupsBtn.textContent = 'Remove Duplicates';
    removeDupsBtn.style.cssText = 'padding: 8px 16px; border: none; background: var(--danger-color); color: white; border-radius: 4px; cursor: pointer;';
    removeDupsBtn.addEventListener('click', () => {
      this.removeDuplicates(duplicates);
      document.body.removeChild(dialog);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));

    buttonContainer.appendChild(removeDupsBtn);
    buttonContainer.appendChild(closeBtn);
    dialogContent.appendChild(buttonContainer);
    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    this.updateStatus(`Found ${duplicates.length} duplicate bookmark(s).`);
  };

  removeDuplicates = async (duplicates) => {
    const indicesToRemove = new Set(duplicates.map(d => d.duplicate));
    const uniqueBookmarks = this.state.lastExtraction.filter((_, index) => !indicesToRemove.has(index));

    this.state.lastExtraction = uniqueBookmarks;
    await chrome.storage.local.set({
      lastExtraction: {
        timestamp: Date.now(),
        bookmarks: uniqueBookmarks
      }
    });

    this.updateStatus(`Removed ${duplicates.length} duplicate(s). ${uniqueBookmarks.length} unique bookmarks remaining.`);
    this.updateUI();
  };

  // FEATURE: Sort bookmarks by engagement metrics
  sortBookmarks = (criteria) => {
    if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
      this.updateStatus('No bookmarks to sort.');
      return;
    }

    const bookmarksToSort = this.state.filteredBookmarks || this.state.lastExtraction;
    let sorted = [...bookmarksToSort];

    switch (criteria) {
      case 'likes':
        sorted.sort((a, b) => (parseInt(b.likes) || 0) - (parseInt(a.likes) || 0));
        break;
      case 'retweets':
        sorted.sort((a, b) => (parseInt(b.retweets) || 0) - (parseInt(a.retweets) || 0));
        break;
      case 'replies':
        sorted.sort((a, b) => (parseInt(b.replies) || 0) - (parseInt(a.replies) || 0));
        break;
      case 'views':
        sorted.sort((a, b) => (parseInt(b.views) || 0) - (parseInt(a.views) || 0));
        break;
      case 'date':
        sorted.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
        break;
      case 'engagement':
        // Combined engagement score
        sorted.sort((a, b) => {
          const scoreA = (parseInt(a.likes) || 0) * 2 + (parseInt(a.retweets) || 0) * 3 + (parseInt(a.replies) || 0) * 1;
          const scoreB = (parseInt(b.likes) || 0) * 2 + (parseInt(b.retweets) || 0) * 3 + (parseInt(b.replies) || 0) * 1;
          return scoreB - scoreA;
        });
        break;
      default:
        break;
    }

    this.state.filteredBookmarks = sorted;
    this.updateStatus(`Sorted by ${criteria}.`);
  };

  // FEATURE: Show sort dialog
  showSortDialog = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 350px; width: 90%;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'Sort Bookmarks';
    dialogContent.appendChild(title);

    const sortOptions = [
      { value: 'engagement', label: 'Total Engagement (Likes + Retweets + Replies)' },
      { value: 'likes', label: 'Most Likes' },
      { value: 'retweets', label: 'Most Retweets' },
      { value: 'replies', label: 'Most Replies' },
      { value: 'views', label: 'Most Views' },
      { value: 'date', label: 'Most Recent' }
    ];

    sortOptions.forEach(option => {
      const btn = document.createElement('button');
      btn.textContent = option.label;
      btn.style.cssText = `
        width: 100%; padding: 12px; margin-bottom: 8px; border: 1px solid var(--border-color);
        background: var(--bg-color); color: var(--text-color); border-radius: 4px;
        cursor: pointer; text-align: left; transition: background 0.2s;
      `;
      btn.addEventListener('mouseover', () => {
        btn.style.background = 'var(--hover-color)';
      });
      btn.addEventListener('mouseout', () => {
        btn.style.background = 'var(--bg-color)';
      });
      btn.addEventListener('click', () => {
        this.sortBookmarks(option.value);
        document.body.removeChild(dialog);
      });
      dialogContent.appendChild(btn);
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'width: 100%; padding: 12px; margin-top: 8px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    cancelBtn.addEventListener('click', () => document.body.removeChild(dialog));
    dialogContent.appendChild(cancelBtn);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) document.body.removeChild(dialog);
    });
  };

  // FEATURE: HTML Export with styling
  generateHTML = () => {
    const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
    if (!bookmarks || bookmarks.length === 0) return '';

    const stats = this.calculateBasicStats(bookmarks);
    const analysis = this.state.aiAnalysis;

    let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X Bookmarks Export - ${new Date().toLocaleDateString()}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           line-height: 1.6; color: #333; background: #f5f5f5; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 40px;
                 border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #1d9bf0; margin-bottom: 10px; font-size: 32px; }
    h2 { color: #14171a; margin: 30px 0 15px; font-size: 24px; border-bottom: 2px solid #1d9bf0; padding-bottom: 8px; }
    h3 { color: #14171a; margin: 20px 0 10px; font-size: 18px; }
    .header { text-align: center; margin-bottom: 40px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
             gap: 15px; margin: 20px 0; }
    .stat-card { background: #f7f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #1d9bf0; }
    .stat-label { font-size: 12px; color: #657786; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #14171a; margin-top: 5px; }
    .bookmark { background: #fff; border: 1px solid #e1e8ed; border-radius: 8px;
                padding: 20px; margin-bottom: 15px; transition: box-shadow 0.2s; }
    .bookmark:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .bookmark-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px; }
    .author { font-weight: bold; color: #14171a; font-size: 16px; }
    .username { color: #657786; font-size: 14px; margin-left: 5px; }
    .date { color: #657786; font-size: 13px; }
    .text { color: #14171a; margin: 12px 0; font-size: 15px; line-height: 1.5; }
    .metrics { display: flex; gap: 20px; margin-top: 12px; flex-wrap: wrap; }
    .metric { display: flex; align-items: center; gap: 5px; color: #657786; font-size: 13px; }
    .metric-value { font-weight: 600; color: #14171a; }
    .link { color: #1d9bf0; text-decoration: none; word-break: break-all; font-size: 13px; }
    .link:hover { text-decoration: underline; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 15px 0; }
    .tag { background: #1d9bf0; color: white; padding: 5px 15px; border-radius: 20px;
           font-size: 12px; font-weight: 500; }
    .categories { list-style: none; }
    .categories li { padding: 8px 0; color: #14171a; border-bottom: 1px solid #e1e8ed; }
    .categories li:last-child { border-bottom: none; }
    .summary { background: #e8f5fd; padding: 20px; border-radius: 8px; margin: 20px 0;
               border-left: 4px solid #1d9bf0; color: #14171a; line-height: 1.6; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px;
              border-top: 1px solid #e1e8ed; color: #657786; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📚 X Bookmarks Export</h1>
      <p style="color: #657786; margin-top: 10px;">Generated on ${new Date().toLocaleString()}</p>
      <p style="color: #657786;">Total Bookmarks: ${bookmarks.length}</p>
    </div>
`;

    // Analysis section
    if (analysis) {
      html += `
    <h2>📊 AI Analysis</h2>
    <div class="summary">${this.escapeHtml(analysis.overallSummary || 'No summary available.')}</div>
`;

      if (analysis.tags && analysis.tags.length > 0) {
        html += `
    <h3>🏷️ Tags</h3>
    <div class="tags">
      ${analysis.tags.map(tag => `<span class="tag">${this.escapeHtml(tag)}</span>`).join('')}
    </div>
`;
      }

      if (analysis.categories && analysis.categories.length > 0) {
        html += `
    <h3>📁 Categories</h3>
    <ul class="categories">
      ${analysis.categories.map(cat => `<li>${this.escapeHtml(cat)}</li>`).join('')}
    </ul>
`;
      }
    }

    // Statistics
    html += `
    <h2>📈 Statistics</h2>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Likes</div>
        <div class="stat-value">${stats.totalLikes.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Retweets</div>
        <div class="stat-value">${stats.totalRetweets.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Likes/Bookmark</div>
        <div class="stat-value">${Math.round(stats.avgLikes)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Top Author</div>
        <div class="stat-value" style="font-size: 18px;">@${stats.topAuthor.username || 'N/A'}</div>
      </div>
    </div>
`;

    // Bookmarks
    html += `
    <h2>🔖 Bookmarks</h2>
`;

    bookmarks.forEach((b, index) => {
      html += `
    <div class="bookmark">
      <div class="bookmark-header">
        <div>
          <span class="author">${this.escapeHtml(b.displayName || 'Unknown')}</span>
          <span class="username">@${this.escapeHtml(b.username || 'unknown')}</span>
        </div>
        <div class="date">${b.dateTime ? new Date(b.dateTime).toLocaleDateString() : 'N/A'}</div>
      </div>
      <div class="text">${this.escapeHtml(b.text || '(No text)')}</div>
      <div class="metrics">
        ${b.likes ? `<div class="metric">❤️ <span class="metric-value">${b.likes}</span></div>` : ''}
        ${b.retweets ? `<div class="metric">🔄 <span class="metric-value">${b.retweets}</span></div>` : ''}
        ${b.replies ? `<div class="metric">💬 <span class="metric-value">${b.replies}</span></div>` : ''}
        ${b.views ? `<div class="metric">👁️ <span class="metric-value">${b.views}</span></div>` : ''}
      </div>
      <a href="${b.url}" target="_blank" class="link">View on X →</a>
    </div>
`;
    });

    html += `
    <div class="footer">
      <p>Exported with X Bookmarks Analyzer v0.11.0</p>
      <p>Total bookmarks in this export: ${bookmarks.length}</p>
    </div>
  </div>
</body>
</html>`;

    return html;
  };

  escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  downloadHTML = () => {
    const html = this.generateHTML();
    if (!html) {
      this.updateStatus('No bookmarks to export.');
      return;
    }
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-bookmarks-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.updateStatus('Downloaded HTML file!');
  };

  // FEATURE: Notion Export
  generateNotionMarkdown = () => {
    const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
    if (!bookmarks || bookmarks.length === 0) return '';

    const lines = [];
    lines.push('# X Bookmarks Export\n');
    lines.push(`> Exported on ${new Date().toLocaleDateString()}\n`);
    lines.push(`> Total: ${bookmarks.length} bookmarks\n\n`);

    // Add database header for Notion
    lines.push('## Bookmarks Database\n\n');

    bookmarks.forEach((bookmark, index) => {
      // Notion-style toggle blocks
      lines.push(`### ${bookmark.displayName || 'Unknown'} (@${bookmark.username || 'unknown'})\n\n`);

      if (bookmark.text) {
        lines.push(`${bookmark.text}\n\n`);
      }

      // Properties in Notion format
      lines.push('**Properties:**\n');
      lines.push(`- **Author:** ${bookmark.displayName || 'Unknown'}\n`);
      lines.push(`- **Username:** @${bookmark.username || 'unknown'}\n`);
      lines.push(`- **Date:** ${bookmark.dateTime ? new Date(bookmark.dateTime).toLocaleDateString() : 'N/A'}\n`);
      lines.push(`- **Likes:** ${bookmark.likes || 0}\n`);
      lines.push(`- **Retweets:** ${bookmark.retweets || 0}\n`);
      lines.push(`- **Replies:** ${bookmark.replies || 0}\n`);
      if (bookmark.views) lines.push(`- **Views:** ${bookmark.views}\n`);
      lines.push(`- **URL:** ${bookmark.url}\n`);

      // Custom tags if any
      const customTags = this.getCustomTags(bookmark.url);
      if (customTags.length > 0) {
        lines.push(`- **Tags:** ${customTags.join(', ')}\n`);
      }

      // Notes if any
      const note = this.getBookmarkNote(bookmark.url);
      if (note) {
        lines.push(`\n**Notes:**\n> ${note}\n`);
      }

      lines.push('\n---\n\n');
    });

    return lines.join('');
  };

  downloadNotion = () => {
    const md = this.generateNotionMarkdown();
    if (!md) {
      this.updateStatus('No bookmarks to export.');
      return;
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-bookmarks-notion-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.updateStatus('Downloaded Notion-compatible Markdown!');
  };

  // FEATURE: Obsidian Export
  generateObsidianMarkdown = () => {
    const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
    if (!bookmarks || bookmarks.length === 0) return '';

    const lines = [];
    lines.push('# X Bookmarks Export\n\n');

    // Obsidian metadata
    lines.push('---\n');
    lines.push(`export_date: ${new Date().toISOString()}\n`);
    lines.push(`total_bookmarks: ${bookmarks.length}\n`);
    lines.push('tags:\n');
    lines.push('  - twitter\n');
    lines.push('  - bookmarks\n');
    if (this.state.aiAnalysis && this.state.aiAnalysis.tags) {
      this.state.aiAnalysis.tags.slice(0, 5).forEach(tag => {
        lines.push(`  - ${tag}\n`);
      });
    }
    lines.push('---\n\n');

    // Summary with backlinks
    lines.push('## Summary\n\n');
    lines.push(`This vault contains [[${bookmarks.length} bookmarks]] from X (Twitter).\n\n`);

    bookmarks.forEach((bookmark, index) => {
      // Create individual note for each bookmark
      const safeFilename = `${bookmark.username}-${Date.now()}-${index}`.replace(/[^a-zA-Z0-9-]/g, '_');

      lines.push(`## [[${safeFilename}|${bookmark.displayName || 'Unknown'}]]\n\n`);

      if (bookmark.text) {
        lines.push(`${bookmark.text}\n\n`);
      }

      // Wikilinks for tags
      const customTags = this.getCustomTags(bookmark.url);
      if (customTags.length > 0) {
        lines.push('**Tags:** ');
        lines.push(customTags.map(tag => `#${tag.replace(/\s+/g, '_')}`).join(' '));
        lines.push('\n\n');
      }

      // Metadata
      lines.push('**Metadata:**\n');
      lines.push(`- Author: [[${bookmark.username || 'unknown'}]]\n`);
      lines.push(`- Date: ${bookmark.dateTime ? new Date(bookmark.dateTime).toLocaleDateString() : 'N/A'}\n`);
      lines.push(`- Engagement: ${bookmark.likes || 0}❤️ ${bookmark.retweets || 0}🔄 ${bookmark.replies || 0}💬\n`);
      lines.push(`- [View on X](${bookmark.url})\n\n`);

      // Notes as blockquote
      const note = this.getBookmarkNote(bookmark.url);
      if (note) {
        lines.push('**My Notes:**\n');
        lines.push(`> ${note}\n\n`);
      }

      lines.push('---\n\n');
    });

    return lines.join('');
  };

  downloadObsidian = () => {
    const md = this.generateObsidianMarkdown();
    if (!md) {
      this.updateStatus('No bookmarks to export.');
      return;
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-bookmarks-obsidian-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.updateStatus('Downloaded Obsidian-compatible Markdown!');
  };

  // FEATURE: Auto-save bookmarks
  enableAutoSave = (intervalMinutes = 5) => {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    this.autoSaveTimer = setInterval(async () => {
      if (this.state.lastExtraction && this.state.lastExtraction.length > 0) {
        await chrome.storage.local.set({
          lastExtraction: {
            timestamp: Date.now(),
            bookmarks: this.state.lastExtraction
          },
          autoSaveTime: new Date().toISOString()
        });
        console.log('[Auto-save] Bookmarks saved automatically');
      }
    }, intervalMinutes * 60 * 1000);

    console.log(`[Auto-save] Enabled with ${intervalMinutes} minute interval`);
  };

  // ====== NEW FEATURES v0.10.0 ======

  // FEATURE: Read/Unread Status
  toggleReadStatus = async (bookmarkUrl) => {
    if (!this.state.bookmarkMetadata[bookmarkUrl]) {
      this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: '', customTags: [], favorite: false };
    }
    this.state.bookmarkMetadata[bookmarkUrl].read = !this.state.bookmarkMetadata[bookmarkUrl].read;
    await this.saveSettings();
    return this.state.bookmarkMetadata[bookmarkUrl].read;
  };

  markAsRead = async (bookmarkUrl) => {
    if (!this.state.bookmarkMetadata[bookmarkUrl]) {
      this.state.bookmarkMetadata[bookmarkUrl] = { read: true, notes: '', customTags: [], favorite: false };
    } else {
      this.state.bookmarkMetadata[bookmarkUrl].read = true;
    }
    await this.saveSettings();
  };

  markAsUnread = async (bookmarkUrl) => {
    if (!this.state.bookmarkMetadata[bookmarkUrl]) {
      this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: '', customTags: [], favorite: false };
    } else {
      this.state.bookmarkMetadata[bookmarkUrl].read = false;
    }
    await this.saveSettings();
  };

  getReadStatus = (bookmarkUrl) => {
    return this.state.bookmarkMetadata[bookmarkUrl]?.read || false;
  };

  // FEATURE: Personal Notes
  setBookmarkNote = async (bookmarkUrl, note) => {
    if (!this.state.bookmarkMetadata[bookmarkUrl]) {
      this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: '', customTags: [], favorite: false };
    }
    this.state.bookmarkMetadata[bookmarkUrl].notes = note;
    await this.saveSettings();
  };

  getBookmarkNote = (bookmarkUrl) => {
    return this.state.bookmarkMetadata[bookmarkUrl]?.notes || '';
  };

  showNotesDialog = (bookmark) => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'Add Note';
    dialogContent.appendChild(title);

    const bookmarkInfo = document.createElement('p');
    bookmarkInfo.style.cssText = 'color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;';
    bookmarkInfo.textContent = `@${bookmark.username}: ${bookmark.text?.substring(0, 60)}...`;
    dialogContent.appendChild(bookmarkInfo);

    const textarea = document.createElement('textarea');
    textarea.value = this.getBookmarkNote(bookmark.url);
    textarea.placeholder = 'Add your personal notes here...';
    textarea.style.cssText = `
      width: 100%; min-height: 120px; padding: 12px; margin-bottom: 16px;
      border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--bg-color); color: var(--text-color); font-size: 14px;
      font-family: inherit; resize: vertical;
    `;
    dialogContent.appendChild(textarea);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    cancelBtn.addEventListener('click', () => document.body.removeChild(dialog));

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save Note';
    saveBtn.style.cssText = 'padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;';
    saveBtn.addEventListener('click', async () => {
      await this.setBookmarkNote(bookmark.url, textarea.value);
      this.updateStatus('Note saved successfully!');
      document.body.removeChild(dialog);
    });

    buttonContainer.appendChild(cancelBtn);
    buttonContainer.appendChild(saveBtn);
    dialogContent.appendChild(buttonContainer);
    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    textarea.focus();
  };

  // FEATURE: Custom Tags
  addCustomTag = async (bookmarkUrl, tag) => {
    if (!this.state.bookmarkMetadata[bookmarkUrl]) {
      this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: '', customTags: [], favorite: false };
    }
    if (!this.state.bookmarkMetadata[bookmarkUrl].customTags) {
      this.state.bookmarkMetadata[bookmarkUrl].customTags = [];
    }
    if (!this.state.bookmarkMetadata[bookmarkUrl].customTags.includes(tag)) {
      this.state.bookmarkMetadata[bookmarkUrl].customTags.push(tag);
      await this.saveSettings();
    }
  };

  removeCustomTag = async (bookmarkUrl, tag) => {
    if (this.state.bookmarkMetadata[bookmarkUrl]?.customTags) {
      this.state.bookmarkMetadata[bookmarkUrl].customTags =
        this.state.bookmarkMetadata[bookmarkUrl].customTags.filter(t => t !== tag);
      await this.saveSettings();
    }
  };

  getCustomTags = (bookmarkUrl) => {
    return this.state.bookmarkMetadata[bookmarkUrl]?.customTags || [];
  };

  showTagsDialog = (bookmark) => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'Manage Tags';
    dialogContent.appendChild(title);

    const bookmarkInfo = document.createElement('p');
    bookmarkInfo.style.cssText = 'color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;';
    bookmarkInfo.textContent = `@${bookmark.username}: ${bookmark.text?.substring(0, 60)}...`;
    dialogContent.appendChild(bookmarkInfo);

    // Current tags
    const tagsContainer = document.createElement('div');
    tagsContainer.id = 'current-tags';
    tagsContainer.style.cssText = 'margin-bottom: 16px; min-height: 40px;';

    const renderTags = () => {
      tagsContainer.innerHTML = '';
      const tags = this.getCustomTags(bookmark.url);
      if (tags.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.style.cssText = 'color: var(--disabled-color); font-style: italic;';
        emptyMsg.textContent = 'No tags yet';
        tagsContainer.appendChild(emptyMsg);
      } else {
        tags.forEach(tag => {
          const tagSpan = document.createElement('span');
          tagSpan.style.cssText = `
            display: inline-block; background: var(--primary-color); color: white;
            padding: 6px 12px; margin: 4px; border-radius: 16px; font-size: 13px;
          `;
          tagSpan.textContent = tag;

          const removeBtn = document.createElement('button');
          removeBtn.textContent = '×';
          removeBtn.style.cssText = `
            background: none; border: none; color: white; font-size: 18px;
            cursor: pointer; margin-left: 6px; padding: 0 4px;
          `;
          removeBtn.addEventListener('click', async () => {
            await this.removeCustomTag(bookmark.url, tag);
            renderTags();
          });

          tagSpan.appendChild(removeBtn);
          tagsContainer.appendChild(tagSpan);
        });
      }
    };
    renderTags();
    dialogContent.appendChild(tagsContainer);

    // Add tag input
    const inputContainer = document.createElement('div');
    inputContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 16px;';

    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.placeholder = 'Add new tag...';
    tagInput.style.cssText = `
      flex: 1; padding: 8px 12px; border: 1px solid var(--border-color);
      border-radius: 4px; background: var(--bg-color); color: var(--text-color);
    `;

    const addTagBtn = document.createElement('button');
    addTagBtn.textContent = 'Add';
    addTagBtn.style.cssText = 'padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;';
    addTagBtn.addEventListener('click', async () => {
      const tag = tagInput.value.trim();
      if (tag) {
        await this.addCustomTag(bookmark.url, tag);
        tagInput.value = '';
        renderTags();
      }
    });

    tagInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        addTagBtn.click();
      }
    });

    inputContainer.appendChild(tagInput);
    inputContainer.appendChild(addTagBtn);
    dialogContent.appendChild(inputContainer);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'width: 100%; padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));
    dialogContent.appendChild(closeBtn);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    tagInput.focus();
  };

  // FEATURE: Saved Searches
  saveCurrentSearch = async () => {
    const searchName = prompt('Name this search:');
    if (!searchName) return;

    const savedSearch = {
      id: Date.now().toString(),
      name: searchName,
      query: this.state.searchQuery,
      filters: { ...this.state.filterOptions }
    };

    this.state.savedSearches.push(savedSearch);
    await this.saveSettings();
    this.updateStatus(`Search "${searchName}" saved!`);
  };

  loadSavedSearch = async (searchId) => {
    const search = this.state.savedSearches.find(s => s.id === searchId);
    if (!search) return;

    this.state.searchQuery = search.query;
    this.state.filterOptions = { ...search.filters };

    if (this.elements.searchInput) {
      this.elements.searchInput.value = search.query;
    }

    this.performSearch();
    this.applyFilters();
    this.updateStatus(`Loaded search: ${search.name}`);
  };

  deleteSavedSearch = async (searchId) => {
    this.state.savedSearches = this.state.savedSearches.filter(s => s.id !== searchId);
    await this.saveSettings();
  };

  showSavedSearchesDialog = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'Saved Searches';
    dialogContent.appendChild(title);

    if (this.state.savedSearches.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.style.cssText = 'color: var(--disabled-color); text-align: center; padding: 20px;';
      emptyMsg.textContent = 'No saved searches yet';
      dialogContent.appendChild(emptyMsg);
    } else {
      this.state.savedSearches.forEach(search => {
        const searchItem = document.createElement('div');
        searchItem.style.cssText = `
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px; margin-bottom: 8px; background: var(--hover-color);
          border-radius: 6px; border: 1px solid var(--border-color);
        `;

        const info = document.createElement('div');
        info.style.cssText = 'flex: 1;';

        const name = document.createElement('div');
        name.style.cssText = 'color: var(--text-color); font-weight: 600; margin-bottom: 4px;';
        name.textContent = search.name;

        const query = document.createElement('div');
        query.style.cssText = 'color: var(--disabled-color); font-size: 12px;';
        query.textContent = search.query || '(no query)';

        info.appendChild(name);
        info.appendChild(query);

        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 8px;';

        const loadBtn = document.createElement('button');
        loadBtn.textContent = 'Load';
        loadBtn.style.cssText = 'padding: 6px 12px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer; font-size: 12px;';
        loadBtn.addEventListener('click', () => {
          this.loadSavedSearch(search.id);
          document.body.removeChild(dialog);
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '×';
        deleteBtn.style.cssText = 'padding: 6px 10px; border: none; background: var(--danger-color); color: white; border-radius: 4px; cursor: pointer; font-size: 14px;';
        deleteBtn.addEventListener('click', async () => {
          await this.deleteSavedSearch(search.id);
          document.body.removeChild(dialog);
          this.showSavedSearchesDialog();
        });

        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);

        searchItem.appendChild(info);
        searchItem.appendChild(actions);
        dialogContent.appendChild(searchItem);
      });
    }

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 8px; justify-content: space-between; margin-top: 16px;';

    const saveCurrentBtn = document.createElement('button');
    saveCurrentBtn.textContent = 'Save Current Search';
    saveCurrentBtn.style.cssText = 'flex: 1; padding: 10px; border: none; background: var(--success-color); color: white; border-radius: 4px; cursor: pointer;';
    saveCurrentBtn.addEventListener('click', async () => {
      await this.saveCurrentSearch();
      document.body.removeChild(dialog);
      this.showSavedSearchesDialog();
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding: 10px 20px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));

    buttonContainer.appendChild(saveCurrentBtn);
    buttonContainer.appendChild(closeBtn);
    dialogContent.appendChild(buttonContainer);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
  };

  // FEATURE: View Mode Toggle
  toggleViewMode = async () => {
    const modes = ['list', 'grid', 'card'];
    const currentIndex = modes.indexOf(this.state.viewMode);
    this.state.viewMode = modes[(currentIndex + 1) % modes.length];
    await this.saveSettings();
    this.updateStatus(`View mode: ${this.state.viewMode}`);
  };

  // FEATURE: Collections
  createCollection = async (name, color = '#1DA1F2') => {
    const collection = {
      id: Date.now().toString(),
      name,
      color,
      bookmarkCount: 0
    };
    this.state.collections.push(collection);
    await this.saveSettings();
    return collection;
  };

  addToCollection = async (bookmarkUrl, collectionId) => {
    if (!this.state.bookmarkMetadata[bookmarkUrl]) {
      this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: '', customTags: [], favorite: false };
    }
    this.state.bookmarkMetadata[bookmarkUrl].collection = collectionId;
    await this.saveSettings();
  };

  showCollectionsDialog = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'Collections';
    dialogContent.appendChild(title);

    if (this.state.collections.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.style.cssText = 'color: var(--disabled-color); text-align: center; padding: 20px;';
      emptyMsg.textContent = 'No collections yet. Create one to organize your bookmarks!';
      dialogContent.appendChild(emptyMsg);
    } else {
      this.state.collections.forEach(collection => {
        const collectionItem = document.createElement('div');
        collectionItem.style.cssText = `
          padding: 12px; margin-bottom: 8px; background: var(--hover-color);
          border-radius: 6px; border-left: 4px solid ${collection.color};
        `;

        const name = document.createElement('div');
        name.style.cssText = 'color: var(--text-color); font-weight: 600;';
        name.textContent = collection.name;

        collectionItem.appendChild(name);
        dialogContent.appendChild(collectionItem);
      });
    }

    const createBtn = document.createElement('button');
    createBtn.textContent = '+ Create Collection';
    createBtn.style.cssText = 'width: 100%; padding: 12px; margin: 16px 0 8px 0; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;';
    createBtn.addEventListener('click', () => {
      const name = prompt('Collection name:');
      if (name) {
        this.createCollection(name);
        document.body.removeChild(dialog);
        this.showCollectionsDialog();
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'width: 100%; padding: 12px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));

    dialogContent.appendChild(createBtn);
    dialogContent.appendChild(closeBtn);
    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
  };

  // FEATURE: Sentiment Analysis
  analyzeSentiment = (text) => {
    // Simple rule-based sentiment analysis
    const positiveWords = ['good', 'great', 'awesome', 'excellent', 'amazing', 'love', 'best', 'wonderful', 'fantastic', 'happy', 'excited', 'perfect', 'brilliant'];
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'worst', 'horrible', 'disappointed', 'sad', 'angry', 'frustrating', 'annoying', 'poor'];

    const lowerText = text.toLowerCase();
    let score = 0;

    positiveWords.forEach(word => {
      if (lowerText.includes(word)) score += 1;
    });

    negativeWords.forEach(word => {
      if (lowerText.includes(word)) score -= 1;
    });

    if (score > 0) return 'positive';
    if (score < 0) return 'negative';
    return 'neutral';
  };

  showSentimentAnalysis = () => {
    if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
      this.updateStatus('No bookmarks to analyze.');
      return;
    }

    const sentiments = { positive: 0, neutral: 0, negative: 0 };

    this.state.lastExtraction.forEach(bookmark => {
      if (bookmark.text) {
        const sentiment = this.analyzeSentiment(bookmark.text);
        sentiments[sentiment]++;
      }
    });

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 400px; width: 90%;
    `;

    const total = this.state.lastExtraction.length;
    const posPercent = Math.round((sentiments.positive / total) * 100);
    const neuPercent = Math.round((sentiments.neutral / total) * 100);
    const negPercent = Math.round((sentiments.negative / total) * 100);

    dialogContent.innerHTML = `
      <h2 style="margin-top: 0; color: var(--text-color);">Sentiment Analysis</h2>
      <div style="margin: 20px 0;">
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-color);">😊 Positive</span>
            <span style="color: var(--text-color); font-weight: 600;">${sentiments.positive} (${posPercent}%)</span>
          </div>
          <div style="background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: var(--success-color); height: 100%; width: ${posPercent}%;"></div>
          </div>
        </div>
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-color);">😐 Neutral</span>
            <span style="color: var(--text-color); font-weight: 600;">${sentiments.neutral} (${neuPercent}%)</span>
          </div>
          <div style="background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: var(--disabled-color); height: 100%; width: ${neuPercent}%;"></div>
          </div>
        </div>
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-color);">😞 Negative</span>
            <span style="color: var(--text-color); font-weight: 600;">${sentiments.negative} (${negPercent}%)</span>
          </div>
          <div style="background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: var(--danger-color); height: 100%; width: ${negPercent}%;"></div>
          </div>
        </div>
      </div>
      <button id="closeDialog" style="width: 100%; padding: 12px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;">Close</button>
    `;

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    const closeDialog = () => document.body.removeChild(dialog);
    document.getElementById('closeDialog').addEventListener('click', closeDialog);
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });
  };

  // FEATURE: AI Q&A over bookmarks
  showAIQADialog = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'Ask AI About Your Bookmarks';
    dialogContent.appendChild(title);

    const info = document.createElement('p');
    info.style.cssText = 'color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;';
    info.textContent = 'Ask questions about your bookmarks. The AI will search through your bookmarks to find relevant answers.';
    dialogContent.appendChild(info);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g., Find tweets about React hooks';
    input.style.cssText = `
      width: 100%; padding: 12px; margin-bottom: 16px;
      border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--bg-color); color: var(--text-color); font-size: 14px;
    `;
    dialogContent.appendChild(input);

    const answerDiv = document.createElement('div');
    answerDiv.id = 'ai-answer';
    answerDiv.style.cssText = `
      min-height: 100px; padding: 16px; margin-bottom: 16px;
      background: var(--hover-color); border-radius: 8px;
      border: 1px solid var(--border-color); color: var(--text-color);
      display: none;
    `;
    dialogContent.appendChild(answerDiv);

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 8px;';

    const askBtn = document.createElement('button');
    askBtn.textContent = 'Ask';
    askBtn.style.cssText = 'flex: 1; padding: 12px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;';
    askBtn.addEventListener('click', () => {
      const question = input.value.trim();
      if (!question) return;

      answerDiv.style.display = 'block';
      answerDiv.textContent = 'Searching bookmarks...';

      // Simple keyword matching Q&A
      setTimeout(() => {
        const keywords = question.toLowerCase().split(' ').filter(w => w.length > 3);
        const results = (this.state.lastExtraction || []).filter(b => {
          const text = b.text?.toLowerCase() || '';
          return keywords.some(keyword => text.includes(keyword));
        });

        if (results.length === 0) {
          answerDiv.textContent = 'No relevant bookmarks found for your question.';
        } else {
          answerDiv.innerHTML = `
            <strong style="color: var(--text-color);">Found ${results.length} relevant bookmarks:</strong><br><br>
            ${results.slice(0, 5).map((b, i) => `
              <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
                <strong style="color: var(--text-color);">@${b.username}</strong>: ${b.text?.substring(0, 150)}...
                <br><a href="${b.url}" target="_blank" style="color: var(--primary-color); font-size: 12px;">View tweet</a>
              </div>
            `).join('')}
          `;
        }
      }, 500);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'padding: 12px 20px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));

    buttonContainer.appendChild(askBtn);
    buttonContainer.appendChild(closeBtn);
    dialogContent.appendChild(buttonContainer);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);

    input.focus();
  };

  // SUBSCRIPTION & QUOTA UI
  updateSubscriptionUI = () => {
    const { isPro } = this.state.quota;

    if (isPro) {
      if (this.elements.upgradeBtn) this.elements.upgradeBtn.style.display = 'none';
      if (this.elements.subscriptionStatus) {
        this.elements.subscriptionStatus.style.display = 'block';
        this.elements.subscriptionStatus.textContent = '🌟 Pro Plan Active (Unlimited Analysis)';
      }
    } else {
      if (this.elements.upgradeBtn) {
        this.elements.upgradeBtn.style.display = 'block';
        this.elements.upgradeBtn.textContent = `👑 Upgrade to Pro (${this.state.quota.count}/${this.state.quota.limit} used today)`;
      }
      if (this.elements.subscriptionStatus) this.elements.subscriptionStatus.style.display = 'none';
    }
  };

  handleUpgrade = () => {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-content">
        <span class="modal-icon">👑</span>
        <h2 class="modal-title">Upgrade to Pro</h2>
        <p class="modal-text">
          Unlock unlimited AI analysis and advanced features!<br>
          Current Plan: 10 bookmarks/day<br>
          Pro Plan: Unlimited
        </p>
        <div class="modal-actions">
          <button id="confirmUpgradeBtn" class="modal-primary-btn">Unlock Now ($9.99)</button>
          <button id="cancelUpgradeBtn" class="modal-secondary-btn">Maybe Later</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    document.getElementById('confirmUpgradeBtn').onclick = async () => {
      await this.subscriptionManager.upgrade();
      this.state.quota.isPro = true;
      this.updateSubscriptionUI();
      document.body.removeChild(dialog);
      this.updateStatus('🌟 Upgraded to Pro! Enjoy unlimited access.');
    };

    document.getElementById('cancelUpgradeBtn').onclick = () => {
      document.body.removeChild(dialog);
    };
  };

  showLimitReachedModal = () => {
    const dialog = document.createElement('div');
    dialog.className = 'modal-overlay';
    dialog.innerHTML = `
      <div class="modal-content">
        <span class="modal-icon">🛑</span>
        <h2 class="modal-title">Daily Limit Reached</h2>
        <p class="modal-text">
          You have reached your daily limit of ${this.quotaManager.DAILY_LIMIT} AI analyses.<br>
          Upgrade to Pro for unlimited access or come back tomorrow!
        </p>
        <div class="modal-actions">
          <button id="limitUpgradeBtn" class="modal-primary-btn">Upgrade to Pro</button>
          <button id="limitCloseBtn" class="modal-secondary-btn">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(dialog);

    document.getElementById('limitUpgradeBtn').onclick = () => {
      document.body.removeChild(dialog);
      this.handleUpgrade();
    };

    document.getElementById('limitCloseBtn').onclick = () => {
      document.body.removeChild(dialog);
    };
  };

  // FEATURE: Find Similar Bookmarks
  findSimilarBookmarks = (bookmarkUrl) => {
    const targetBookmark = this.state.lastExtraction?.find(b => b.url === bookmarkUrl);
    if (!targetBookmark) return [];

    const targetWords = new Set(
      (targetBookmark.text || '').toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 4)
    );

    const similarities = (this.state.lastExtraction || [])
      .filter(b => b.url !== bookmarkUrl)
      .map(bookmark => {
        const words = (bookmark.text || '').toLowerCase().split(/\s+/).filter(w => w.length > 4);
        const commonWords = words.filter(w => targetWords.has(w)).length;
        const similarity = commonWords / Math.max(targetWords.size, words.length);
        return { bookmark, similarity };
      })
      .filter(item => item.similarity > 0.1)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);

    return similarities;
  };

  showSimilarBookmarksDialog = (bookmark) => {
    const similar = this.findSimilarBookmarks(bookmark.url);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'Similar Bookmarks';
    dialogContent.appendChild(title);

    const info = document.createElement('p');
    info.style.cssText = 'color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;';
    info.textContent = `Finding bookmarks similar to: ${bookmark.text?.substring(0, 60)}...`;
    dialogContent.appendChild(info);

    if (similar.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.style.cssText = 'color: var(--disabled-color); text-align: center; padding: 20px;';
      emptyMsg.textContent = 'No similar bookmarks found';
      dialogContent.appendChild(emptyMsg);
    } else {
      similar.forEach(({ bookmark: b, similarity }) => {
        const item = document.createElement('div');
        item.style.cssText = `
          padding: 12px; margin-bottom: 12px; background: var(--hover-color);
          border-radius: 6px; border-left: 4px solid var(--primary-color);
        `;

        const author = document.createElement('div');
        author.style.cssText = 'color: var(--text-color); font-weight: 600; margin-bottom: 4px;';
        author.textContent = `@${b.username} (${Math.round(similarity * 100)}% similar)`;

        const text = document.createElement('div');
        text.style.cssText = 'color: var(--text-color); font-size: 13px; margin-bottom: 8px;';
        text.textContent = b.text?.substring(0, 150) + '...';

        const link = document.createElement('a');
        link.href = b.url;
        link.target = '_blank';
        link.style.cssText = 'color: var(--primary-color); font-size: 12px; text-decoration: none;';
        link.textContent = 'View tweet →';

        item.appendChild(author);
        item.appendChild(text);
        item.appendChild(link);
        dialogContent.appendChild(item);
      });
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'width: 100%; padding: 12px; margin-top: 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));
    dialogContent.appendChild(closeBtn);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
  };

  // FEATURE: Reminder System
  setReminder = async (bookmarkUrl, reminderDate, message = '') => {
    const reminder = {
      id: Date.now().toString(),
      bookmarkUrl,
      reminderDate: reminderDate.toISOString(),
      message,
      created: new Date().toISOString()
    };

    this.state.reminders.push(reminder);
    await this.saveSettings();
    return reminder;
  };

  checkReminders = () => {
    const now = new Date();
    const dueReminders = this.state.reminders.filter(r => {
      return new Date(r.reminderDate) <= now;
    });

    if (dueReminders.length > 0) {
      dueReminders.forEach(reminder => {
        const bookmark = this.state.lastExtraction?.find(b => b.url === reminder.bookmarkUrl);
        if (bookmark) {
          this.updateStatus(`Reminder: ${reminder.message || bookmark.text?.substring(0, 50)}`);
        }
      });

      // Remove due reminders
      this.state.reminders = this.state.reminders.filter(r => {
        return new Date(r.reminderDate) > now;
      });
      this.saveSettings();
    }
  };

  // ====== NEW FEATURES v0.11.0 (LOW COMPLEXITY) ======

  // FEATURE: Favorites/Stars
  toggleFavorite = async (bookmarkUrl) => {
    if (!this.state.bookmarkMetadata[bookmarkUrl]) {
      this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: '', customTags: [], favorite: false };
    }
    this.state.bookmarkMetadata[bookmarkUrl].favorite = !this.state.bookmarkMetadata[bookmarkUrl].favorite;
    await this.saveSettings();
    return this.state.bookmarkMetadata[bookmarkUrl].favorite;
  };

  isFavorite = (bookmarkUrl) => {
    return this.state.bookmarkMetadata[bookmarkUrl]?.favorite || false;
  };

  getFavorites = () => {
    return (this.state.lastExtraction || []).filter(b => this.isFavorite(b.url));
  };

  // FEATURE: Archive
  toggleArchive = async (bookmarkUrl) => {
    if (!this.state.bookmarkMetadata[bookmarkUrl]) {
      this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: '', customTags: [], favorite: false, archived: false };
    }
    this.state.bookmarkMetadata[bookmarkUrl].archived = !this.state.bookmarkMetadata[bookmarkUrl].archived;
    await this.saveSettings();
    return this.state.bookmarkMetadata[bookmarkUrl].archived;
  };

  isArchived = (bookmarkUrl) => {
    return this.state.bookmarkMetadata[bookmarkUrl]?.archived || false;
  };

  getArchived = () => {
    return (this.state.lastExtraction || []).filter(b => this.isArchived(b.url));
  };

  // FEATURE: Bulk Selection
  toggleBulkSelection = (bookmarkUrl) => {
    const index = this.state.bulkSelection.indexOf(bookmarkUrl);
    if (index > -1) {
      this.state.bulkSelection.splice(index, 1);
    } else {
      this.state.bulkSelection.push(bookmarkUrl);
    }
  };

  selectAll = () => {
    const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction || [];
    this.state.bulkSelection = bookmarks.map(b => b.url);
  };

  deselectAll = () => {
    this.state.bulkSelection = [];
  };

  bulkMarkAsRead = async () => {
    for (const url of this.state.bulkSelection) {
      await this.markAsRead(url);
    }
    this.updateStatus(`Marked ${this.state.bulkSelection.length} bookmarks as read`);
  };

  bulkAddToCollection = async (collectionId) => {
    for (const url of this.state.bulkSelection) {
      await this.addToCollection(url, collectionId);
    }
    this.updateStatus(`Added ${this.state.bulkSelection.length} bookmarks to collection`);
  };

  bulkDelete = async () => {
    // Remove selected bookmarks from lastExtraction
    this.state.lastExtraction = (this.state.lastExtraction || []).filter(b =>
      !this.state.bulkSelection.includes(b.url)
    );
    await chrome.storage.local.set({
      lastExtraction: {
        timestamp: Date.now(),
        bookmarks: this.state.lastExtraction
      }
    });
    this.updateStatus(`Deleted ${this.state.bulkSelection.length} bookmarks`);
    this.state.bulkSelection = [];
    this.updateUI();
    this.updateStatus(`Deleted ${this.state.bulkSelection.length} bookmarks`);
    this.state.bulkSelection = [];
    this.updateUI();
  };

  // FEATURE: Reading Time Estimation
  estimateReadingTime = (text) => {
    if (!text) return 0;
    const wordsPerMinute = 200;
    const words = text.trim().split(/\s+/).length;
    return Math.ceil(words / wordsPerMinute);
  };

  // FEATURE: Content Type Detection
  detectContentType = (bookmark) => {
    const text = bookmark.text || '';
    const hasLinks = /https?:\/\//.test(text);
    const hasHashtags = /#\w+/.test(text);
    const hasMentions = /@\w+/.test(text);
    const isThread = text.includes('🧵') || text.includes('1/') || text.includes('Thread:');
    const isQuestion = text.includes('?');

    // Determine content type
    if (isThread) return 'thread';
    if (bookmark.replies > 50) return 'discussion';
    if (hasLinks && text.length < 100) return 'link-share';
    if (isQuestion) return 'question';
    if (text.length > 500) return 'long-form';
    if (hasHashtags) return 'tagged';
    return 'standard';
  };

  // FEATURE: Keyboard Shortcuts
  setupKeyboardShortcuts = () => {
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + K - Search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.elements.searchInput?.focus();
      }
      // Ctrl/Cmd + F - Filter
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        this.showFilterDialog();
      }
      // Ctrl/Cmd + S - Sort
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        this.showSortDialog();
      }
      // Ctrl/Cmd + E - Export
      if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        this.downloadMarkdown();
      }
      // Ctrl/Cmd + A - Select All (when not in input)
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.selectAll();
        this.updateStatus(`Selected all ${this.state.bulkSelection.length} bookmarks`);
      }
      // Escape - Deselect All
      if (e.key === 'Escape') {
        this.deselectAll();
        this.updateStatus('Cleared selection');
      }
      // Ctrl/Cmd + Z - Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
      }
      // Ctrl/Cmd + Shift + Z or Ctrl/Cmd + Y - Redo
      if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') || ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        this.redo();
      }
    });
  };

  // FEATURE: Author Frequency Analytics
  getAuthorAnalytics = () => {
    const authorStats = {};
    (this.state.lastExtraction || []).forEach(bookmark => {
      const username = bookmark.username || 'unknown';
      if (!authorStats[username]) {
        authorStats[username] = {
          count: 0,
          totalLikes: 0,
          totalRetweets: 0,
          displayName: bookmark.displayName || username,
          bookmarks: []
        };
      }
      authorStats[username].count++;
      authorStats[username].totalLikes += parseInt(bookmark.likes || 0);
      authorStats[username].totalRetweets += parseInt(bookmark.retweets || 0);
      authorStats[username].bookmarks.push(bookmark);
    });

    return Object.entries(authorStats)
      .map(([username, stats]) => ({
        username,
        ...stats,
        avgLikes: Math.round(stats.totalLikes / stats.count),
        avgRetweets: Math.round(stats.totalRetweets / stats.count)
      }))
      .sort((a, b) => b.count - a.count);
  };

  showAuthorAnalytics = () => {
    const authors = this.getAuthorAnalytics();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = 'Author Analytics';
    dialogContent.appendChild(title);

    authors.slice(0, 20).forEach((author, index) => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding: 12px; margin-bottom: 8px; background: var(--hover-color);
        border-radius: 6px; border-left: 4px solid var(--primary-color);
      `;

      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; margin-bottom: 8px;';

      const name = document.createElement('div');
      name.style.cssText = 'color: var(--text-color); font-weight: 600;';
      name.textContent = `${index + 1}. ${author.displayName} (@${author.username})`;

      const count = document.createElement('div');
      count.style.cssText = 'color: var(--primary-color); font-weight: 600;';
      count.textContent = `${author.count} bookmarks`;

      header.appendChild(name);
      header.appendChild(count);

      const stats = document.createElement('div');
      stats.style.cssText = 'color: var(--disabled-color); font-size: 13px;';
      stats.textContent = `Avg: ${author.avgLikes} likes • ${author.avgRetweets} retweets`;

      item.appendChild(header);
      item.appendChild(stats);
      dialogContent.appendChild(item);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'width: 100%; padding: 12px; margin-top: 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));
    dialogContent.appendChild(closeBtn);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
  };

  // FEATURE: Undo/Redo System
  saveState = (action) => {
    this.state.undoStack.push({
      action,
      timestamp: Date.now(),
      data: JSON.stringify({
        lastExtraction: this.state.lastExtraction,
        bookmarkMetadata: this.state.bookmarkMetadata
      })
    });
    // Keep only last 20 states
    if (this.state.undoStack.length > 20) {
      this.state.undoStack.shift();
    }
    this.state.redoStack = []; // Clear redo stack on new action
  };

  undo = () => {
    if (this.state.undoStack.length === 0) {
      this.updateStatus('Nothing to undo');
      return;
    }

    // Save current state to redo stack
    this.state.redoStack.push({
      action: 'redo point',
      timestamp: Date.now(),
      data: JSON.stringify({
        lastExtraction: this.state.lastExtraction,
        bookmarkMetadata: this.state.bookmarkMetadata
      })
    });

    const previousState = this.state.undoStack.pop();
    const restored = JSON.parse(previousState.data);
    this.state.lastExtraction = restored.lastExtraction;
    this.state.bookmarkMetadata = restored.bookmarkMetadata;

    this.updateStatus(`Undone: ${previousState.action}`);
    this.updateUI();
  };

  redo = () => {
    if (this.state.redoStack.length === 0) {
      this.updateStatus('Nothing to redo');
      return;
    }

    const nextState = this.state.redoStack.pop();
    const restored = JSON.parse(nextState.data);
    this.state.lastExtraction = restored.lastExtraction;
    this.state.bookmarkMetadata = restored.bookmarkMetadata;

    this.updateStatus('Redone action');
    this.updateUI();
  };

  // FEATURE: Hidden Gems Finder
  findHiddenGems = () => {
    if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
      return [];
    }

    // Define "hidden gems" as low engagement but potentially valuable content
    const avgLikes = this.state.lastExtraction.reduce((sum, b) => sum + (parseInt(b.likes) || 0), 0) / this.state.lastExtraction.length;

    return this.state.lastExtraction
      .filter(b => {
        const likes = parseInt(b.likes) || 0;
        const hasLinks = /https?:\/\//.test(b.text || '');
        const isLongForm = (b.text || '').length > 400;
        const readingTime = this.estimateReadingTime(b.text);

        // Low engagement but quality indicators
        return likes < avgLikes * 0.5 && (hasLinks || isLongForm || readingTime >= 2);
      })
      .slice(0, 20);
  };

  showHiddenGems = () => {
    const gems = this.findHiddenGems();

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;

    const title = document.createElement('h2');
    title.style.cssText = 'margin-top: 0; color: var(--text-color);';
    title.textContent = '💎 Hidden Gems';
    dialogContent.appendChild(title);

    const info = document.createElement('p');
    info.style.cssText = 'color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;';
    info.textContent = 'Quality bookmarks with lower engagement that you might have missed.';
    dialogContent.appendChild(info);

    if (gems.length === 0) {
      const emptyMsg = document.createElement('p');
      emptyMsg.style.cssText = 'color: var(--disabled-color); text-align: center; padding: 20px;';
      emptyMsg.textContent = 'No hidden gems found';
      dialogContent.appendChild(emptyMsg);
    } else {
      gems.forEach(gem => {
        const item = document.createElement('div');
        item.style.cssText = `
          padding: 12px; margin-bottom: 12px; background: var(--hover-color);
          border-radius: 6px; border-left: 4px solid #FFD700;
        `;

        const author = document.createElement('div');
        author.style.cssText = 'color: var(--text-color); font-weight: 600; margin-bottom: 4px;';
        author.textContent = `@${gem.username}`;

        const text = document.createElement('div');
        text.style.cssText = 'color: var(--text-color); font-size: 13px; margin-bottom: 8px;';
        text.textContent = gem.text?.substring(0, 200) + '...';

        const meta = document.createElement('div');
        meta.style.cssText = 'color: var(--disabled-color); font-size: 12px;';
        meta.textContent = `📖 ${this.estimateReadingTime(gem.text)} min read • ${gem.likes || 0} likes`;

        const link = document.createElement('a');
        link.href = gem.url;
        link.target = '_blank';
        link.style.cssText = 'color: var(--primary-color); font-size: 12px; text-decoration: none; display: inline-block; margin-top: 8px;';
        link.textContent = 'View tweet →';

        item.appendChild(author);
        item.appendChild(text);
        item.appendChild(meta);
        item.appendChild(link);
        dialogContent.appendChild(item);
      });
    }

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = 'width: 100%; padding: 12px; margin-top: 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;';
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));
    dialogContent.appendChild(closeBtn);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
  };

  // ====== MEDIUM COMPLEXITY FEATURES v0.11.0 ======

  // FEATURE: Reading Queue with Priorities
  addToReadingQueue = async (bookmarkUrl, priority = 1) => {
    const existing = this.state.readingQueue.find(item => item.bookmarkUrl === bookmarkUrl);
    if (existing) {
      existing.priority = priority;
    } else {
      this.state.readingQueue.push({
        bookmarkUrl,
        priority,
        addedDate: new Date().toISOString()
      });
    }
    await this.saveSettings();
  };

  showReadingQueue = () => {
    const queue = this.state.readingQueue
      .sort((a, b) => b.priority - a.priority)
      .map(item => {
        const bookmark = this.state.lastExtraction?.find(b => b.url === item.bookmarkUrl);
        return { ...item, bookmark };
      })
      .filter(item => item.bookmark);

    this.updateStatus(`Reading queue: ${queue.length} items`);
  };

  // FEATURE: Thread Reader/Unroller
  detectThread = (bookmark) => {
    const text = bookmark.text || '';
    const indicators = ['🧵', '1/', 'Thread:', 'THREAD:', '👇', '1) ', '1. '];
    return indicators.some(indicator => text.includes(indicator));
  };

  // FEATURE: Tag Cloud Visualization
  generateTagCloud = () => {
    const tagFrequency = {};
    if (this.state.aiAnalysis && this.state.aiAnalysis.tags) {
      this.state.aiAnalysis.tags.forEach(tag => {
        tagFrequency[tag] = (tagFrequency[tag] || 0) + 1;
      });
    }
    Object.values(this.state.bookmarkMetadata).forEach(meta => {
      if (meta.customTags) {
        meta.customTags.forEach(tag => {
          tagFrequency[tag] = (tagFrequency[tag] || 0) + 3;
        });
      }
    });
    return Object.entries(tagFrequency).sort((a, b) => b[1] - a[1]).slice(0, 50);
  };

  // ====== HIGH COMPLEXITY FEATURES v0.11.0 ======

  // FEATURE: Engagement Tracking Over Time
  trackEngagement = async (bookmark) => {
    if (!this.state.engagementHistory[bookmark.url]) {
      this.state.engagementHistory[bookmark.url] = [];
    }

    this.state.engagementHistory[bookmark.url].push({
      timestamp: new Date().toISOString(),
      likes: parseInt(bookmark.likes) || 0,
      retweets: parseInt(bookmark.retweets) || 0,
      replies: parseInt(bookmark.replies) || 0,
      views: parseInt(bookmark.views) || 0
    });

    // Keep only last 30 entries per bookmark
    if (this.state.engagementHistory[bookmark.url].length > 30) {
      this.state.engagementHistory[bookmark.url] = this.state.engagementHistory[bookmark.url].slice(-30);
    }

    await this.saveSettings();
  };

  trackAllEngagements = async () => {
    if (!this.state.lastExtraction) return;

    for (const bookmark of this.state.lastExtraction) {
      await this.trackEngagement(bookmark);
    }

    this.updateStatus(`Tracked engagement for ${this.state.lastExtraction.length} bookmarks`);
  };

  getEngagementGrowth = (bookmarkUrl) => {
    const history = this.state.engagementHistory[bookmarkUrl];
    if (!history || history.length < 2) return null;

    const first = history[0];
    const last = history[history.length - 1];

    return {
      likesGrowth: last.likes - first.likes,
      retweetsGrowth: last.retweets - first.retweets,
      repliesGrowth: last.replies - first.replies,
      viewsGrowth: last.views - first.views,
      timespan: new Date(last.timestamp) - new Date(first.timestamp)
    };
  };

  // FEATURE: Deleted Tweet Detection
  checkForDeletedTweets = async () => {
    if (!this.state.lastExtraction) return [];

    const deleted = [];
    const sampleSize = Math.min(20, this.state.lastExtraction.length);

    // Check a sample of bookmarks (to avoid rate limiting)
    for (let i = 0; i < sampleSize; i++) {
      const bookmark = this.state.lastExtraction[i];
      // In a real implementation, you'd use Twitter API or fetch the URL
      // For now, we'll just mark bookmarks as potentially deleted based on age
      const daysOld = (Date.now() - new Date(bookmark.dateTime)) / (1000 * 60 * 60 * 24);
      if (daysOld > 365) {
        deleted.push(bookmark);
      }
    }

    return deleted;
  };

  archiveDeletedTweets = async () => {
    const deleted = await this.checkForDeletedTweets();

    deleted.forEach(bookmark => {
      if (!this.state.bookmarkMetadata[bookmark.url]) {
        this.state.bookmarkMetadata[bookmark.url] = {};
      }
      this.state.bookmarkMetadata[bookmark.url].archivedContent = {
        text: bookmark.text,
        author: bookmark.displayName,
        username: bookmark.username,
        dateTime: bookmark.dateTime,
        archivedAt: new Date().toISOString()
      };
    });

    await this.saveSettings();
    this.updateStatus(`Archived ${deleted.length} potentially deleted tweets`);
  };

  // ====== END NEW FEATURES v0.11.0 ======
}

// LLM Provider Base Class
class LLMProvider {
  constructor(constants) {
    this.constants = constants || {
      AI_ANALYSIS_LIMIT: 50,
      AI_MAX_TOKENS: 500,
      AI_TEMPERATURE: 0.7,
      MAX_TAGS: 20,
      MAX_CATEGORIES: 10
    };
  }

  prepareBookmarkTexts(bookmarks) {
    return bookmarks
      .filter(b => b.text && b.text.trim())
      .slice(0, this.constants.AI_ANALYSIS_LIMIT)
      .map(b => `@${b.username}: ${b.text}`)
      .join('\n\n');
  }

  parseJSONResponse(content) {
    let analysis = null;

    // Strategy 1: Try parsing entire content as JSON
    try {
      analysis = JSON.parse(content);
      return analysis;
    } catch (e) {
      // Strategy 2: Extract JSON from markdown code blocks
      const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (codeBlockMatch) {
        try {
          analysis = JSON.parse(codeBlockMatch[1]);
          return analysis;
        } catch (e2) {
          // Continue to next strategy
        }
      }

      // Strategy 3: Find first JSON object in content
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          analysis = JSON.parse(jsonMatch[0]);
          return analysis;
        } catch (e3) {
          throw new Error('Failed to parse response as JSON');
        }
      } else {
        throw new Error('No JSON found in response');
      }
    }
  }

  validateAnalysis(analysis) {
    if (!analysis || typeof analysis !== 'object') {
      throw new Error('Analysis is not a valid object');
    }

    const validatedAnalysis = {
      overallSummary: typeof analysis.overallSummary === 'string' ? analysis.overallSummary : '',
      tags: Array.isArray(analysis.tags) ? analysis.tags.filter(t => typeof t === 'string').slice(0, this.constants.MAX_TAGS) : [],
      categories: Array.isArray(analysis.categories) ? analysis.categories.filter(c => typeof c === 'string').slice(0, this.constants.MAX_CATEGORIES) : [],
      timestamp: Date.now()
    };

    if (!validatedAnalysis.overallSummary && validatedAnalysis.tags.length === 0 && validatedAnalysis.categories.length === 0) {
      throw new Error('Response contained no useful analysis data');
    }

    return validatedAnalysis;
  }

  async analyzeBookmarks(bookmarks) {
    throw new Error('analyzeBookmarks must be implemented by subclass');
  }
}

// OpenAI Provider
class OpenAIProvider extends LLMProvider {
  constructor(apiKey, constants) {
    super(constants);
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    this.model = 'gpt-3.5-turbo';
  }

  async analyzeBookmarks(bookmarks) {
    const bookmarkTexts = this.prepareBookmarkTexts(bookmarks);

    if (!bookmarkTexts) {
      throw new Error('No bookmark content to analyze');
    }

    const prompt = `Analyze these Twitter/X bookmarks and provide:
1. An overall summary (2-3 sentences) of the main themes
2. A list of 5-10 relevant tags/keywords
3. 3-5 main categories these bookmarks fall into

Bookmarks:
${bookmarkTexts}

Respond in JSON format:
{
  "overallSummary": "...",
  "tags": ["tag1", "tag2", ...],
  "categories": ["category1", "category2", ...]
}`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant that analyzes social media content and provides structured summaries.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: this.constants.AI_TEMPERATURE,
          max_tokens: this.constants.AI_MAX_TOKENS
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
        throw new Error('Invalid API response structure');
      }

      if (!data.choices[0].message || !data.choices[0].message.content) {
        throw new Error('Missing content in API response');
      }

      const content = data.choices[0].message.content;
      const analysis = this.parseJSONResponse(content);
      return this.validateAnalysis(analysis);
    } catch (error) {
      console.error('OpenAI Analysis error:', error);
      throw error;
    }
  }
}

// Anthropic Provider
class AnthropicProvider extends LLMProvider {
  constructor(apiKey, constants) {
    super(constants);
    this.apiKey = apiKey;
    this.apiUrl = 'https://api.anthropic.com/v1/messages';
    this.model = 'claude-3-5-sonnet-20241022';
  }

  async analyzeBookmarks(bookmarks) {
    const bookmarkTexts = this.prepareBookmarkTexts(bookmarks);

    if (!bookmarkTexts) {
      throw new Error('No bookmark content to analyze');
    }

    const prompt = `Analyze these Twitter/X bookmarks and provide:
1. An overall summary (2-3 sentences) of the main themes
2. A list of 5-10 relevant tags/keywords
3. 3-5 main categories these bookmarks fall into

Bookmarks:
${bookmarkTexts}

Respond in JSON format:
{
  "overallSummary": "...",
  "tags": ["tag1", "tag2", ...],
  "categories": ["category1", "category2", ...]
}`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: this.constants.AI_MAX_TOKENS,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
        throw new Error('Invalid API response structure');
      }

      const content = data.content[0].text;
      const analysis = this.parseJSONResponse(content);
      return this.validateAnalysis(analysis);
    } catch (error) {
      console.error('Anthropic Analysis error:', error);
      throw error;
    }
  }
}

// Gemini Provider
class GeminiProvider extends LLMProvider {
  constructor(apiKey, constants) {
    super(constants);
    this.apiKey = apiKey;
    this.apiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  }

  async analyzeBookmarks(bookmarks) {
    const bookmarkTexts = this.prepareBookmarkTexts(bookmarks);

    if (!bookmarkTexts) {
      throw new Error('No bookmark content to analyze');
    }

    const prompt = `Analyze these Twitter/X bookmarks and provide:
1. An overall summary (2-3 sentences) of the main themes
2. A list of 5-10 relevant tags/keywords
3. 3-5 main categories these bookmarks fall into

Bookmarks:
${bookmarkTexts}

Respond in JSON format:
{
  "overallSummary": "...",
  "tags": ["tag1", "tag2", ...],
  "categories": ["category1", "category2", ...]
}`;

    try {
      const response = await fetch(`${this.apiUrl}?key=${this.apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: prompt
            }]
          }],
          generationConfig: {
            temperature: this.constants.AI_TEMPERATURE,
            maxOutputTokens: this.constants.AI_MAX_TOKENS,
            responseMimeType: "application/json"
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.candidates || data.candidates.length === 0) {
        throw new Error('Invalid API response structure');
      }

      const content = data.candidates[0].content.parts[0].text;
      const analysis = this.parseJSONResponse(content);
      return this.validateAnalysis(analysis);
    } catch (error) {
      console.error('Gemini Analysis error:', error);
      throw error;
    }
  }
}

// LLM-Free Provider (Basic Analysis)
class LLMFreeProvider extends LLMProvider {
  constructor(constants) {
    super(constants);
  }

  async analyzeBookmarks(bookmarks) {
    // Perform basic text analysis without external LLM
    if (!bookmarks || bookmarks.length === 0) {
      throw new Error('No bookmark content to analyze');
    }

    // Extract common words for tags
    const wordFrequency = {};
    const authorFrequency = {};
    const allText = [];

    bookmarks.forEach(b => {
      if (b.text) {
        allText.push(b.text.toLowerCase());
        // Extract words (simple tokenization)
        const words = b.text.toLowerCase()
          .replace(/[^\w\s#@]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 3 && !this.isStopWord(w));

        words.forEach(word => {
          wordFrequency[word] = (wordFrequency[word] || 0) + 1;
        });
      }

      if (b.username) {
        authorFrequency[b.username] = (authorFrequency[b.username] || 0) + 1;
      }
    });

    // Get top tags (most frequent words)
    const tags = Object.entries(wordFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);

    // Detect categories based on keywords
    const categories = this.detectCategories(allText.join(' '));

    // Generate basic summary
    const topAuthor = Object.entries(authorFrequency)
      .sort((a, b) => b[1] - a[1])[0];

    const summary = `This collection contains ${bookmarks.length} bookmarks. ` +
      `Most frequently bookmarked author: @${topAuthor ? topAuthor[0] : 'N/A'}. ` +
      `Common topics include: ${tags.slice(0, 3).join(', ')}.`;

    return {
      overallSummary: summary,
      tags: tags,
      categories: categories,
      timestamp: Date.now()
    };
  }

  isStopWord(word) {
    const stopWords = ['that', 'this', 'with', 'from', 'have', 'will', 'your', 'they', 'been', 'more', 'when', 'there', 'their', 'would', 'about', 'which', 'these', 'https'];
    return stopWords.includes(word);
  }

  detectCategories(text) {
    const categories = [];
    const lowerText = text.toLowerCase();

    const categoryKeywords = {
      'Technology': ['tech', 'software', 'code', 'programming', 'developer', 'ai', 'data', 'cloud', 'api'],
      'Business': ['business', 'startup', 'entrepreneur', 'market', 'company', 'revenue', 'growth'],
      'News & Politics': ['news', 'political', 'government', 'election', 'policy', 'breaking'],
      'Science': ['science', 'research', 'study', 'paper', 'scientific', 'discovery'],
      'Entertainment': ['movie', 'music', 'game', 'entertainment', 'show', 'video'],
      'Sports': ['sport', 'team', 'player', 'game', 'match', 'football', 'basketball'],
      'Education': ['learn', 'education', 'course', 'tutorial', 'teaching', 'university'],
      'Health': ['health', 'medical', 'wellness', 'fitness', 'mental', 'exercise']
    };

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      const matches = keywords.filter(keyword => lowerText.includes(keyword)).length;
      if (matches >= 2) {
        categories.push(category);
      }
    }

    if (categories.length === 0) {
      categories.push('General');
    }

    return categories.slice(0, 5);
  }

  // ============================================
  // NEW v0.12.0: ENHANCED AUTHORS DASHBOARD
  // ============================================

  getAuthorsDashboardData = () => {
    const authorStats = {};

    // Get all bookmarks (native + manual)
    const allBookmarks = this.state.lastExtraction || [];

    allBookmarks.forEach(bookmark => {
      const username = bookmark.username || 'unknown';
      if (!authorStats[username]) {
        authorStats[username] = {
          count: 0,
          totalLikes: 0,
          totalRetweets: 0,
          totalReplies: 0,
          totalViews: 0,
          displayName: bookmark.displayName || username,
          bookmarks: [],
          topics: new Map()
        };
      }

      authorStats[username].count++;
      authorStats[username].totalLikes += parseInt(bookmark.likes || 0);
      authorStats[username].totalRetweets += parseInt(bookmark.retweets || 0);
      authorStats[username].totalReplies += parseInt(bookmark.replies || 0);
      authorStats[username].totalViews += parseInt(bookmark.views || 0);
      authorStats[username].bookmarks.push(bookmark);

      // Extract topics from tweet text
      const topics = this.extractTopicsFromText(bookmark.text);
      topics.forEach(topic => {
        const current = authorStats[username].topics.get(topic) || 0;
        authorStats[username].topics.set(topic, current + 1);
      });
    });

    return Object.entries(authorStats)
      .map(([username, stats]) => ({
        username,
        ...stats,
        avgLikes: Math.round(stats.totalLikes / stats.count),
        avgRetweets: Math.round(stats.totalRetweets / stats.count),
        avgReplies: Math.round(stats.totalReplies / stats.count),
        avgViews: Math.round(stats.totalViews / stats.count),
        topTopics: Array.from(stats.topics.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([topic]) => topic)
      }))
      .sort((a, b) => b.count - a.count);
  };

  extractTopicsFromText = (text) => {
    if (!text) return [];

    const words = text.toLowerCase()
      .replace(/[^\w\s#]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !this.isStopWord(word));

    // Get hashtags
    const hashtags = text.match(/#\w+/g) || [];
    const hashtagWords = hashtags.map(tag => tag.substring(1).toLowerCase());

    // Combine and count
    const wordCounts = {};
    [...words, ...hashtagWords].forEach(word => {
      wordCounts[word] = (wordCounts[word] || 0) + 1;
    });

    // Return top words
    return Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  };

  showAuthorsDashboard = async () => {
    // Load manual bookmarks and combine with existing
    const storage = await chrome.storage.local.get('manualBookmarks');
    const manualBookmarks = storage.manualBookmarks || [];

    // Temporarily combine bookmarks for analysis
    const originalExtraction = this.state.lastExtraction;
    this.state.lastExtraction = [
      ...(originalExtraction || []),
      ...manualBookmarks
    ];

    const authors = this.getAuthorsDashboardData();

    // Restore original state
    this.state.lastExtraction = originalExtraction;

    if (authors.length === 0) {
      this.updateStatus('No bookmarks found. Extract bookmarks first.');
      return;
    }

    // Create dialog
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 12px;
      max-width: 800px; width: 95%; max-height: 85vh; overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 16px;';
    header.innerHTML = `
      <h2 style="margin: 0 0 8px 0; color: var(--text-color); font-size: 24px;">
        👥 Authors Dashboard
      </h2>
      <p style="margin: 0; color: var(--disabled-color); font-size: 14px;">
        Discover who you bookmark most and what topics they cover
      </p>
    `;
    dialogContent.appendChild(header);

    // Sort controls
    const sortControls = document.createElement('div');
    sortControls.style.cssText = 'margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap;';
    sortControls.innerHTML = `
      <button class="author-sort-btn" data-sort="count" style="padding: 8px 16px; background: var(--primary-color); color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 13px; font-weight: 600;">
        Most Bookmarks
      </button>
      <button class="author-sort-btn" data-sort="engagement" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        Highest Engagement
      </button>
      <button class="author-sort-btn" data-sort="recent" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        Most Recent
      </button>
    `;
    dialogContent.appendChild(sortControls);

    // Authors list container
    const authorsContainer = document.createElement('div');
    authorsContainer.id = 'authors-list-container';
    dialogContent.appendChild(authorsContainer);

    const renderAuthors = (sortBy = 'count') => {
      let sortedAuthors = [...authors];

      if (sortBy === 'engagement') {
        sortedAuthors.sort((a, b) => (b.avgLikes + b.avgRetweets) - (a.avgLikes + a.avgRetweets));
      } else if (sortBy === 'recent') {
        sortedAuthors.sort((a, b) => {
          const aLatest = Math.max(...a.bookmarks.map(bm => new Date(bm.dateTime || 0).getTime()));
          const bLatest = Math.max(...b.bookmarks.map(bm => new Date(bm.dateTime || 0).getTime()));
          return bLatest - aLatest;
        });
      }

      authorsContainer.innerHTML = '';

      sortedAuthors.forEach((author, index) => {
        const item = document.createElement('div');
        item.style.cssText = `
          padding: 16px; margin-bottom: 12px;
          background: var(--hover-color);
          border-radius: 8px;
          border-left: 4px solid var(--primary-color);
          transition: transform 0.2s;
          cursor: pointer;
        `;

        item.addEventListener('mouseenter', () => {
          item.style.transform = 'translateX(4px)';
        });

        item.addEventListener('mouseleave', () => {
          item.style.transform = 'translateX(0)';
        });

        const headerRow = document.createElement('div');
        headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';

        const nameSection = document.createElement('div');
        nameSection.innerHTML = `
          <div style="color: var(--text-color); font-weight: 700; font-size: 16px; margin-bottom: 4px;">
            ${index + 1}. ${author.displayName}
          </div>
          <div style="color: var(--disabled-color); font-size: 13px;">
            @${author.username}
          </div>
        `;

        const countBadge = document.createElement('div');
        countBadge.style.cssText = `
          background: var(--primary-color);
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-weight: 700;
          font-size: 14px;
        `;
        countBadge.textContent = `${author.count} bookmarks`;

        headerRow.appendChild(nameSection);
        headerRow.appendChild(countBadge);

        const statsRow = document.createElement('div');
        statsRow.style.cssText = 'display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px;';
        statsRow.innerHTML = `
          <div style="text-align: center; padding: 8px; background: var(--bg-color); border-radius: 6px;">
            <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 4px;">AVG LIKES</div>
            <div style="color: var(--text-color); font-weight: 600; font-size: 15px;">${author.avgLikes.toLocaleString()}</div>
          </div>
          <div style="text-align: center; padding: 8px; background: var(--bg-color); border-radius: 6px;">
            <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 4px;">AVG RTs</div>
            <div style="color: var(--text-color); font-weight: 600; font-size: 15px;">${author.avgRetweets.toLocaleString()}</div>
          </div>
          <div style="text-align: center; padding: 8px; background: var(--bg-color); border-radius: 6px;">
            <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 4px;">AVG REPLIES</div>
            <div style="color: var(--text-color); font-weight: 600; font-size: 15px;">${author.avgReplies.toLocaleString()}</div>
          </div>
          <div style="text-align: center; padding: 8px; background: var(--bg-color); border-radius: 6px;">
            <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 4px;">AVG VIEWS</div>
            <div style="color: var(--text-color); font-weight: 600; font-size: 15px;">${author.avgViews.toLocaleString()}</div>
          </div>
        `;

        const topicsRow = document.createElement('div');
        topicsRow.style.cssText = 'margin-top: 12px;';
        topicsRow.innerHTML = `
          <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 6px; font-weight: 600;">TOP TOPICS</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${author.topTopics.map(topic => `
              <span style="
                background: var(--primary-color);
                color: white;
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 500;
              ">${topic}</span>
            `).join('')}
          </div>
        `;

        item.appendChild(headerRow);
        item.appendChild(statsRow);
        item.appendChild(topicsRow);

        // Click to filter by author
        item.addEventListener('click', () => {
          this.state.filterOptions.author = author.username;
          this.applyFilters();
          document.body.removeChild(dialog);
          this.updateStatus(`Filtered by author: @${author.username}`);
        });

        authorsContainer.appendChild(item);
      });
    };

    // Initial render
    renderAuthors('count');

    // Sort button handlers
    sortControls.querySelectorAll('.author-sort-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Update button styles
        sortControls.querySelectorAll('.author-sort-btn').forEach(b => {
          b.style.background = 'var(--hover-color)';
          b.style.color = 'var(--text-color)';
        });
        e.target.style.background = 'var(--primary-color)';
        e.target.style.color = 'white';

        // Re-render with new sort
        renderAuthors(e.target.dataset.sort);
      });
    });

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      width: 100%; padding: 14px; margin-top: 20px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-color);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = 'var(--hover-color)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'transparent';
    });
    dialogContent.appendChild(closeBtn);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
  };

  // ============================================
  // NEW v0.12.0: MEDIA GALLERY VIEW
  // ============================================

  extractMediaFromBookmarks = async () => {
    const storage = await chrome.storage.local.get('manualBookmarks');
    const manualBookmarks = storage.manualBookmarks || [];
    const allBookmarks = [
      ...(this.state.lastExtraction || []),
      ...manualBookmarks
    ];

    const mediaBookmarks = [];

    for (const bookmark of allBookmarks) {
      const mediaUrls = this.extractMediaUrls(bookmark.text, bookmark.url);
      if (mediaUrls.length > 0) {
        mediaBookmarks.push({
          ...bookmark,
          mediaUrls,
          mediaTypes: mediaUrls.map(url => this.getMediaType(url))
        });
      }
    }

    return mediaBookmarks;
  };

  extractMediaUrls = (text, tweetUrl) => {
    const urls = [];

    // Extract image URLs from text
    const imgRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi;
    const imgMatches = text.match(imgRegex) || [];
    urls.push(...imgMatches);

    // Extract video URLs
    const videoRegex = /https?:\/\/[^\s]+\.(mp4|webm|mov)/gi;
    const videoMatches = text.match(videoRegex) || [];
    urls.push(...videoMatches);

    // Twitter media URLs (pbs.twimg.com)
    const twitterMediaRegex = /https?:\/\/pbs\.twimg\.com\/media\/[^\s]+/gi;
    const twitterMediaMatches = text.match(twitterMediaRegex) || [];
    urls.push(...twitterMediaMatches);

    // Add tweet URL as potential media source (X embeds images/videos)
    if (tweetUrl && urls.length === 0) {
      // Mark as tweet embed - we'll handle this specially
      urls.push(tweetUrl + '#embed');
    }

    return [...new Set(urls)];
  };

  getMediaType = (url) => {
    if (url.includes('#embed')) return 'tweet-embed';
    if (url.match(/\.(mp4|webm|mov)$/i)) return 'video';
    if (url.match(/\.(gif)$/i)) return 'gif';
    return 'image';
  };

  showMediaGallery = async () => {
    const mediaBookmarks = await this.extractMediaFromBookmarks();

    if (mediaBookmarks.length === 0) {
      this.updateStatus('No media found in bookmarks.');
      return;
    }

    // Create dialog
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.95); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 12px;
      max-width: 1200px; width: 95%; max-height: 90vh; overflow-y: auto;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 16px;';
    header.innerHTML = `
      <h2 style="margin: 0 0 8px 0; color: var(--text-color); font-size: 24px;">
        🎨 Media Gallery
      </h2>
      <p style="margin: 0; color: var(--disabled-color); font-size: 14px;">
        ${mediaBookmarks.length} bookmarks with media • Click any image to view full size
      </p>
    `;
    dialogContent.appendChild(header);

    // Filter controls
    const filterControls = document.createElement('div');
    filterControls.style.cssText = 'margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap;';
    filterControls.innerHTML = `
      <button class="media-filter-btn" data-filter="all" style="padding: 8px 16px; background: var(--primary-color); color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 13px; font-weight: 600;">
        All Media
      </button>
      <button class="media-filter-btn" data-filter="image" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        Images Only
      </button>
      <button class="media-filter-btn" data-filter="video" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        Videos Only
      </button>
      <button class="media-filter-btn" data-filter="gif" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        GIFs Only
      </button>
    `;
    dialogContent.appendChild(filterControls);

    // Gallery grid
    const galleryGrid = document.createElement('div');
    galleryGrid.id = 'media-gallery-grid';
    galleryGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    `;
    dialogContent.appendChild(galleryGrid);

    const renderGallery = (filter = 'all') => {
      galleryGrid.innerHTML = '';

      const filteredBookmarks = filter === 'all'
        ? mediaBookmarks
        : mediaBookmarks.filter(bm => bm.mediaTypes.includes(filter));

      filteredBookmarks.forEach(bookmark => {
        bookmark.mediaUrls.forEach((mediaUrl, idx) => {
          const mediaType = bookmark.mediaTypes[idx];

          // Skip if filtering
          if (filter !== 'all' && mediaType !== filter) return;

          const card = document.createElement('div');
          card.style.cssText = `
            position: relative;
            background: var(--hover-color);
            border-radius: 8px;
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.2s;
            aspect-ratio: 1;
          `;

          card.addEventListener('mouseenter', () => {
            card.style.transform = 'scale(1.05)';
          });

          card.addEventListener('mouseleave', () => {
            card.style.transform = 'scale(1)';
          });

          // Media content
          if (mediaType === 'tweet-embed') {
            card.innerHTML = `
              <div style="
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                background: linear-gradient(135deg, var(--primary-color), #1a8cd8);
                color: white;
                font-size: 48px;
              ">
                🐦
              </div>
            `;
          } else if (mediaType === 'video' || mediaType === 'gif') {
            card.innerHTML = `
              <div style="
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                background: var(--bg-color);
                color: var(--text-color);
                font-size: 48px;
              ">
                ${mediaType === 'video' ? '🎥' : '🎬'}
              </div>
            `;
          } else {
            card.innerHTML = `
              <img src="${mediaUrl}" alt="Media" style="
                width: 100%;
                height: 100%;
                object-fit: cover;
              " onerror="this.parentElement.innerHTML = '<div style=\\"display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-color);\\">❌</div>'">
            `;
          }

          // Overlay with author info
          const overlay = document.createElement('div');
          overlay.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
            padding: 12px;
            color: white;
            opacity: 0;
            transition: opacity 0.2s;
          `;
          overlay.innerHTML = `
            <div style="font-size: 12px; font-weight: 600;">@${bookmark.username}</div>
            <div style="font-size: 11px; opacity: 0.8; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${bookmark.text.substring(0, 50)}...
            </div>
          `;

          card.addEventListener('mouseenter', () => {
            overlay.style.opacity = '1';
          });

          card.addEventListener('mouseleave', () => {
            overlay.style.opacity = '0';
          });

          card.appendChild(overlay);

          // Click to open lightbox
          card.addEventListener('click', () => {
            this.showMediaLightbox(mediaUrl, mediaType, bookmark);
          });

          galleryGrid.appendChild(card);
        });
      });

      if (filteredBookmarks.length === 0) {
        galleryGrid.innerHTML = `
          <div style="
            grid-column: 1 / -1;
            text-align: center;
            padding: 40px;
            color: var(--disabled-color);
            font-size: 16px;
          ">
            No ${filter === 'all' ? '' : filter + ' '}media found
          </div>
        `;
      }
    };

    // Initial render
    renderGallery('all');

    // Filter button handlers
    filterControls.querySelectorAll('.media-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Update button styles
        filterControls.querySelectorAll('.media-filter-btn').forEach(b => {
          b.style.background = 'var(--hover-color)';
          b.style.color = 'var(--text-color)';
        });
        e.target.style.background = 'var(--primary-color)';
        e.target.style.color = 'white';

        // Re-render with filter
        renderGallery(e.target.dataset.filter);
      });
    });

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      width: 100%; padding: 14px; margin-top: 20px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-color);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = 'var(--hover-color)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'transparent';
    });
    dialogContent.appendChild(closeBtn);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
  };

  showMediaLightbox = (mediaUrl, mediaType, bookmark) => {
    const lightbox = document.createElement('div');
    lightbox.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.95);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      padding: 40px;
    `;

    const content = document.createElement('div');
    content.style.cssText = `
      max-width: 90%;
      max-height: 90%;
      position: relative;
    `;

    if (mediaType === 'tweet-embed') {
      content.innerHTML = `
        <div style="background: white; padding: 40px; border-radius: 12px; text-align: center;">
          <p style="margin-bottom: 20px; color: #333;">Open tweet to view embedded media</p>
          <a href="${mediaUrl.replace('#embed', '')}" target="_blank" style="
            display: inline-block;
            padding: 12px 24px;
            background: var(--primary-color);
            color: white;
            text-decoration: none;
            border-radius: 20px;
            font-weight: 600;
          ">View Tweet on X</a>
        </div>
      `;
    } else if (mediaType === 'video') {
      content.innerHTML = `
        <video src="${mediaUrl}" controls autoplay style="max-width: 100%; max-height: 80vh; border-radius: 8px;">
        </video>
      `;
    } else {
      content.innerHTML = `
        <img src="${mediaUrl}" alt="Media" style="max-width: 100%; max-height: 80vh; border-radius: 8px;">
      `;
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      position: absolute;
      top: -40px;
      right: 0;
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: none;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 20px;
      font-weight: bold;
    `;
    closeBtn.addEventListener('click', () => document.body.removeChild(lightbox));
    content.appendChild(closeBtn);

    // Author info
    const info = document.createElement('div');
    info.style.cssText = `
      margin-top: 16px;
      color: white;
      text-align: center;
    `;
    info.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px;">@${bookmark.username}</div>
      <div style="font-size: 14px; opacity: 0.8;">${bookmark.text.substring(0, 150)}${bookmark.text.length > 150 ? '...' : ''}</div>
      <a href="${bookmark.url}" target="_blank" style="
        display: inline-block;
        margin-top: 12px;
        padding: 8px 16px;
        background: var(--primary-color);
        color: white;
        text-decoration: none;
        border-radius: 20px;
        font-size: 13px;
        font-weight: 600;
      ">View Tweet</a>
    `;
    content.appendChild(info);

    lightbox.appendChild(content);

    // Click backdrop to close
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox) {
        document.body.removeChild(lightbox);
      }
    });

    document.body.appendChild(lightbox);
  };

  // ============================================
  // NEW v0.12.0: ARTICLE SUMMARIZATION
  // ============================================

  showArticleSummaryDialog = async () => {
    // Check if LLM provider is configured
    if (this.state.llmProvider === 'none') {
      this.updateStatus('Please configure an LLM provider in settings first.');
      this.showSettingsDialog();
      return;
    }

    const storage = await chrome.storage.local.get(['manualBookmarks', 'articleSummaries']);
    const manualBookmarks = storage.manualBookmarks || [];
    const cachedSummaries = storage.articleSummaries || {};

    const allBookmarks = [
      ...(this.state.lastExtraction || []),
      ...manualBookmarks
    ];

    // Find bookmarks with article links
    const bookmarksWithLinks = allBookmarks.filter(bm => {
      const urls = this.extractArticleUrls(bm.text);
      return urls.length > 0;
    });

    if (bookmarksWithLinks.length === 0) {
      this.updateStatus('No bookmarks with article links found.');
      return;
    }

    // Create dialog
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;

    const dialogContent = document.createElement('div');
    dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 12px;
      max-width: 900px; width: 95%; max-height: 85vh; overflow-y: auto;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 16px;';
    header.innerHTML = `
      <h2 style="margin: 0 0 8px 0; color: var(--text-color); font-size: 24px;">
        📰 Article Summaries
      </h2>
      <p style="margin: 0; color: var(--disabled-color); font-size: 14px;">
        ${bookmarksWithLinks.length} bookmarks with article links • Click "Summarize" to generate AI summary
      </p>
    `;
    dialogContent.appendChild(header);

    // Articles list
    const articlesList = document.createElement('div');
    articlesList.id = 'articles-list';
    articlesList.style.cssText = 'margin-bottom: 20px;';

    bookmarksWithLinks.slice(0, 20).forEach((bookmark, index) => {
      const urls = this.extractArticleUrls(bookmark.text);
      const articleUrl = urls[0];

      const card = document.createElement('div');
      card.style.cssText = `
        padding: 16px;
        margin-bottom: 12px;
        background: var(--hover-color);
        border-radius: 8px;
        border-left: 4px solid var(--primary-color);
      `;

      const cardHeader = document.createElement('div');
      cardHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;';

      const tweetInfo = document.createElement('div');
      tweetInfo.style.cssText = 'flex: 1; margin-right: 12px;';
      tweetInfo.innerHTML = `
        <div style="color: var(--text-color); font-weight: 600; margin-bottom: 4px;">
          @${bookmark.username}
        </div>
        <div style="color: var(--disabled-color); font-size: 13px; margin-bottom: 8px;">
          ${bookmark.text.substring(0, 100)}${bookmark.text.length > 100 ? '...' : ''}
        </div>
        <a href="${articleUrl}" target="_blank" style="
          color: var(--primary-color);
          font-size: 12px;
          text-decoration: none;
          word-break: break-all;
        ">${articleUrl.substring(0, 60)}${articleUrl.length > 60 ? '...' : ''}</a>
      `;

      const actionBtn = document.createElement('button');
      actionBtn.className = `summarize-btn-${index}`;
      actionBtn.style.cssText = `
        padding: 8px 16px;
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      `;

      // Check if we have a cached summary
      const cacheKey = this.getArticleCacheKey(articleUrl);
      if (cachedSummaries[cacheKey]) {
        actionBtn.textContent = 'View Summary';
        actionBtn.style.background = 'var(--success-color, #00BA7C)';
      } else {
        actionBtn.textContent = 'Summarize';
      }

      cardHeader.appendChild(tweetInfo);
      cardHeader.appendChild(actionBtn);
      card.appendChild(cardHeader);

      // Summary container (initially hidden)
      const summaryContainer = document.createElement('div');
      summaryContainer.style.cssText = 'display: none; margin-top: 12px; padding: 12px; background: var(--bg-color); border-radius: 6px;';
      summaryContainer.id = `summary-${index}`;
      card.appendChild(summaryContainer);

      actionBtn.addEventListener('click', async () => {
        if (cachedSummaries[cacheKey]) {
          // Show cached summary
          this.displaySummary(summaryContainer, cachedSummaries[cacheKey]);
          summaryContainer.style.display = 'block';
          actionBtn.textContent = 'Hide Summary';
          actionBtn.addEventListener('click', () => {
            if (summaryContainer.style.display === 'none') {
              summaryContainer.style.display = 'block';
              actionBtn.textContent = 'Hide Summary';
            } else {
              summaryContainer.style.display = 'none';
              actionBtn.textContent = 'View Summary';
            }
          }, { once: true });
        } else {
          // Generate new summary
          actionBtn.textContent = 'Summarizing...';
          actionBtn.disabled = true;
          actionBtn.style.opacity = '0.6';

          try {
            const summary = await this.summarizeArticle(articleUrl);

            // Cache the summary
            cachedSummaries[cacheKey] = summary;
            await chrome.storage.local.set({ articleSummaries: cachedSummaries });

            // Display summary
            this.displaySummary(summaryContainer, summary);
            summaryContainer.style.display = 'block';
            actionBtn.textContent = 'Hide Summary';
            actionBtn.disabled = false;
            actionBtn.style.opacity = '1';
            actionBtn.style.background = 'var(--success-color, #00BA7C)';
          } catch (error) {
            summaryContainer.innerHTML = `
              <div style="color: var(--danger-color, #F4212E); font-size: 14px;">
                ❌ Error: ${error.message}
              </div>
            `;
            summaryContainer.style.display = 'block';
            actionBtn.textContent = 'Retry';
            actionBtn.disabled = false;
            actionBtn.style.opacity = '1';
          }
        }
      });

      articlesList.appendChild(card);
    });

    dialogContent.appendChild(articlesList);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `
      width: 100%; padding: 14px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-color);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;
    closeBtn.addEventListener('click', () => document.body.removeChild(dialog));
    dialogContent.appendChild(closeBtn);

    dialog.appendChild(dialogContent);
    document.body.appendChild(dialog);
  };

  extractArticleUrls = (text) => {
    // Extract URLs from tweet text
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlRegex) || [];

    // Filter out Twitter/X URLs and media URLs
    return urls.filter(url => {
      const lowerUrl = url.toLowerCase();
      return !lowerUrl.includes('twitter.com') &&
        !lowerUrl.includes('x.com') &&
        !lowerUrl.includes('pbs.twimg.com') &&
        !lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)$/i);
    });
  };

  getArticleCacheKey = (url) => {
    // Create a simple hash of the URL for caching
    return btoa(url).substring(0, 50);
  };

  summarizeArticle = async (articleUrl) => {
    // Step 1: Fetch article content using Jina Reader API
    this.updateStatus('Fetching article content...');

    const jinaUrl = `https://r.jina.ai/${articleUrl}`;
    const jinaResponse = await fetch(jinaUrl, {
      headers: {
        'Accept': 'application/json',
        'X-Return-Format': 'markdown'
      }
    });

    if (!jinaResponse.ok) {
      throw new Error('Failed to fetch article content');
    }

    const jinaData = await jinaResponse.json();
    const articleText = jinaData.data?.content || jinaData.content || '';

    if (!articleText || articleText.length < 100) {
      throw new Error('Article content too short or empty');
    }

    // Limit article text to first 4000 characters for API efficiency
    const truncatedText = articleText.substring(0, 4000);

    // Step 2: Summarize using configured LLM provider
    this.updateStatus('Generating summary with AI...');

    const prompt = `Please provide a concise summary of the following article in 3-5 bullet points. Focus on the key takeaways and main arguments.

Article:
${truncatedText}

Summary (3-5 bullet points):`;

    let summary;

    if (this.state.llmProvider === 'openai') {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: 'You are a helpful assistant that summarizes articles concisely.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 300,
          temperature: 0.5
        })
      });

      if (!response.ok) {
        throw new Error('OpenAI API request failed');
      }

      const data = await response.json();
      summary = data.choices[0].message.content;

    } else if (this.state.llmProvider === 'anthropic') {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.state.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 300,
          messages: [
            { role: 'user', content: prompt }
          ]
        })
      });

      if (!response.ok) {
        throw new Error('Anthropic API request failed');
      }

      const data = await response.json();
      summary = data.content[0].text;

    } else {
      // Fallback: extract key sentences
      summary = this.extractKeySentences(truncatedText, 5);
    }

    this.updateStatus('Summary generated successfully!');

    return {
      summary,
      url: articleUrl,
      timestamp: Date.now(),
      provider: this.state.llmProvider
    };
  };

  extractKeySentences = (text, count = 5) => {
    // Simple extractive summarization
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);

    // Score sentences by length and position
    const scoredSentences = sentences.map((sentence, index) => ({
      text: sentence.trim(),
      score: sentence.length + (index < 5 ? 50 : 0) // Boost early sentences
    }));

    // Get top sentences
    const topSentences = scoredSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map(s => '• ' + s.text);

    return topSentences.join('\n');
  };

  displaySummary = (container, summaryData) => {
    const timeAgo = this.getTimeAgo(summaryData.timestamp);

    container.innerHTML = `
      <div style="margin-bottom: 8px; color: var(--disabled-color); font-size: 12px;">
        Generated ${timeAgo} • Provider: ${summaryData.provider || 'local'}
      </div>
      <div style="color: var(--text-color); font-size: 14px; line-height: 1.6; white-space: pre-wrap;">
        ${summaryData.summary}
      </div>
      <a href="${summaryData.url}" target="_blank" style="
        display: inline-block;
        margin-top: 12px;
        padding: 6px 12px;
        background: var(--primary-color);
        color: white;
        text-decoration: none;
        border-radius: 16px;
        font-size: 12px;
        font-weight: 600;
      ">Read Full Article →</a>
    `;
  };

  getTimeAgo = (timestamp) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);

    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  };

  // ── Tier UI ────────────────────────────────────────────────────────────────

  updateTierUI = async () => {
    const status = await this.tierManager.getStatus();
    const isPro  = status.valid === true && status.tier === 'pro';

    // For free users use the local usage counter; for pro, use server-reported value
    let remaining;
    if (isPro) {
      remaining = typeof status.remainingToday === 'number'
        ? status.remainingToday
        : status.dailyLimit || 50;
    } else {
      const used = await this.tierManager.getLocalUsageCount();
      remaining  = Math.max(0, 50 - used);
    }

    const bookmarkLimit = isPro ? this.tierManager.PRO_BOOKMARK_LIMIT : this.tierManager.FREE_BOOKMARK_LIMIT;

    // Header badge
    if (this.elements.tierBadge) {
      this.elements.tierBadge.textContent = isPro ? 'Pro' : 'Free';
      this.elements.tierBadge.className = `tier-badge ${isPro ? 'tier-pro' : 'tier-free'}`;
    }

    // Rate limit bar
    if (this.elements.rateLimitText) {
      this.elements.rateLimitText.textContent = `${remaining} of 50 analyses remaining today`;
    }

    // KB button subtitle
    if (this.elements.kbBtnSubtitle) {
      const modelLabel = isPro ? 'Gemini 2.5 Pro' : 'Gemini 2.0 Flash';
      this.elements.kbBtnSubtitle.textContent =
        `Analyzes ${bookmarkLimit} bookmarks · ${modelLabel}`;
    }

    // Settings tab subscription section
    if (this.elements.subTierDisplay) {
      this.elements.subTierDisplay.textContent = isPro ? 'Pro ✓' : 'Free';
    }
    if (this.elements.subscriptionStatus) {
      this.elements.subscriptionStatus.className = `subscription-status ${isPro ? 'pro' : 'free'}`;
    }
    if (this.elements.subDescription) {
      if (isPro && status.expiresAt) {
        const expDate = new Date(status.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        this.elements.subDescription.textContent =
          `Pro plan – Gemini 2.5 Pro, ${bookmarkLimit} bookmarks/export. ${remaining}/50 analyses remaining today. Renews ${expDate}.`;
      } else {
        this.elements.subDescription.textContent =
          `Free plan – analyzes your 3 most recent bookmarks with Gemini 2.0 Flash using your own API key.`;
      }
    }
    if (this.elements.deactivateLicenseBtn) {
      this.elements.deactivateLicenseBtn.style.display = isPro ? 'inline-block' : 'none';
    }
    if (this.elements.bmcUpgradeBox) {
      this.elements.bmcUpgradeBox.style.display = isPro ? 'none' : 'block';
    }

    // Refresh export button states
    this.updateExportButtons();
  };

  // ── License activation ─────────────────────────────────────────────────────

  handleActivateLicense = async () => {
    const rawToken = this.elements.licenseKeyInput?.value?.trim();
    if (!rawToken) {
      this.showLicenseMsg('Please enter your activation token.', 'error');
      return;
    }

    if (this.elements.activateLicenseBtn) {
      this.elements.activateLicenseBtn.disabled = true;
      this.elements.activateLicenseBtn.classList.add('verifying');
      this.elements.activateLicenseBtn.textContent = 'Verifying…';
    }
    this.showLicenseMsg('Contacting verification server…', '');

    const result = await this.tierManager.activateToken(rawToken);

    if (this.elements.activateLicenseBtn) {
      this.elements.activateLicenseBtn.disabled = false;
      this.elements.activateLicenseBtn.classList.remove('verifying');
      this.elements.activateLicenseBtn.textContent = 'Verify & Activate';
    }

    this.showLicenseMsg(result.message, result.success ? 'success' : 'error');
    if (result.success) {
      if (this.elements.licenseKeyInput) this.elements.licenseKeyInput.value = '';
      await this.updateTierUI();
    }
  };

  handleDeactivateLicense = async () => {
    await this.tierManager.deactivate();
    this.showLicenseMsg('Token removed. Reverted to Free plan.', '');
    await this.updateTierUI();
  };

  showLicenseMsg = (msg, type) => {
    if (!this.elements.licenseMsg) return;
    this.elements.licenseMsg.textContent = msg;
    this.elements.licenseMsg.className = `settings-hint${type ? ' ' + type : ''}`;
  };

  // ── Knowledge Base export ──────────────────────────────────────────────────

  exportKnowledgeBase = async () => {
    const bookmarks = this.state.lastExtraction;
    if (!bookmarks || bookmarks.length === 0) {
      this.updateStatus('No bookmarks to export.');
      return;
    }

    // Rate-limit check (free users: local counter; Pro: enforced server-side on each call)
    const isPro = await this.tierManager.isProUser();

    // Free users need to provide their own Gemini API key; Pro routes through the Worker
    if (!isPro && (this.state.llmProvider !== 'gemini' || !this.state.apiKey)) {
      this.updateStatus('Free plan: select Gemini as provider and add your Gemini API key in Settings.');
      return;
    }
    if (!isPro) {
      const { allowed, reason } = await this.tierManager.canAnalyzeFree();
      if (!allowed) {
        this.updateStatus(reason);
        this.showToast(reason, 'warning');
        return;
      }
    }

    const bookmarkLimit = await this.tierManager.getBookmarkLimit();
    const toProcess = bookmarks.slice(0, bookmarkLimit);

    // Disable button, show progress
    if (this.elements.exportKbBtn) this.elements.exportKbBtn.disabled = true;
    if (this.elements.kbProgress) this.elements.kbProgress.style.display = 'block';

    const setKbProgress = (pct, text) => {
      if (this.elements.kbProgressFill) this.elements.kbProgressFill.style.width = `${pct}%`;
      if (this.elements.kbProgressText) this.elements.kbProgressText.textContent = text;
    };

    setKbProgress(5, 'Initializing…');
    this.updateStatus(`Exporting Knowledge Base (${toProcess.length} bookmarks)…`);

    try {
      const gemini = await this.createGeminiProvider();

      // Step 1: Collection-level analysis (10%)
      setKbProgress(10, 'Generating collection overview…');
      let aiAnalysis = this.state.aiAnalysis;
      if (!aiAnalysis) {
        try {
          aiAnalysis = await gemini.analyzeBookmarks(toProcess);
          this.state.aiAnalysis = aiAnalysis;
        } catch (e) {
          console.warn('Collection analysis failed, continuing without it:', e.message);
        }
      }

      // Step 2: Per-bookmark analysis + image extraction
      const deepAnalyses = [];
      const imageTextsPerBookmark = [];
      const totalSteps = toProcess.length;

      for (let i = 0; i < toProcess.length; i++) {
        const bookmark = toProcess[i];
        const pct = 10 + Math.round(((i + 1) / totalSteps) * 80);
        setKbProgress(pct, `Analyzing bookmark ${i + 1} of ${totalSteps}…`);

        // Image text extraction
        let imageTexts = [];
        if (bookmark.media && bookmark.media.some(m => m.type !== 'video')) {
          try {
            imageTexts = await gemini.extractBookmarkImageTexts(bookmark);
          } catch (e) {
            console.warn('Image extraction failed for bookmark', i, ':', e.message);
          }
        }
        imageTextsPerBookmark.push(imageTexts);

        // Per-bookmark deep analysis
        let deepAnalysis = null;
        try {
          deepAnalysis = await gemini.analyzeBookmark(bookmark, imageTexts);
        } catch (e) {
          console.warn('Deep analysis failed for bookmark', i, ':', e.message);
        }
        deepAnalyses.push(deepAnalysis);

        // Free users: track usage locally for display; Pro: tracked server-side
        if (!isPro) {
          await this.tierManager.incrementLocalUsage(1);
        }
      }

      // Step 3: Generate and download
      setKbProgress(95, 'Generating Markdown…');
      const getCustomTags = (url) => {
        const meta = this.state.bookmarkMetadata?.[url];
        return meta?.customTags || [];
      };

      downloadKnowledgeBase(toProcess, {
        aiAnalysis,
        deepAnalyses,
        imageTextsPerBookmark,
        getCustomTags
      });

      setKbProgress(100, 'Done!');
      this.updateStatus(`Knowledge Base exported with ${toProcess.length} bookmarks.`);

      if (!isPro && bookmarks.length > bookmarkLimit) {
        this.showToast(
          `Free plan: exported ${bookmarkLimit} of ${bookmarks.length} bookmarks. Upgrade to Pro for up to 50.`,
          'info'
        );
      }

      // Refresh tier UI (usage counter changed)
      await this.updateTierUI();
    } catch (error) {
      console.error('Knowledge Base export error:', error);
      this.updateStatus(`Export failed: ${error.message}`);
      this.showToast(`Export failed: ${error.message}`, 'error');
    } finally {
      if (this.elements.exportKbBtn) this.elements.exportKbBtn.disabled = false;
      setTimeout(() => {
        if (this.elements.kbProgress) this.elements.kbProgress.style.display = 'none';
      }, 2000);
    }
  };
}

// Initialize the popup controller when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});
if (typeof module !== 'undefined' && module.exports) { module.exports = { PopupController, GeminiProviderClass, LLMProvider, OpenAIProvider, AnthropicProvider, LLMFreeProvider }; }
