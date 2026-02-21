/**
 * Knowledge Base Exporter
 *
 * Generates a rich Markdown knowledge base from Twitter/X bookmarks.
 * Each bookmark gets its own section with:
 *   - Tweet text & author details
 *   - Engagement stats
 *   - Images with extracted text (via Gemini Vision)
 *   - Linked article summary (if available via Jina)
 *   - AI-generated context: summary, key insights, topics, actionable info
 *   - Tags
 *   - Source link
 *
 * The exporter is designed to be used as a standalone Obsidian/Notion-friendly
 * knowledge base that doesn't require the extension to read.
 */

/**
 * Format a number for display (e.g. 1200 → "1.2K").
 */
function fmtNum(n) {
    const num = parseInt(n || 0, 10);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
    return String(num);
}

/**
 * Sanitize text for safe embedding in Markdown.
 */
function sanitize(text) {
    if (!text) return '';
    return String(text)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
}

/**
 * Render the YAML front-matter block at the top of the file.
 * Compatible with Obsidian and most Markdown tools.
 */
function renderFrontMatter(bookmarks, aiAnalysis) {
    const now = new Date();
    const tags = aiAnalysis?.tags?.slice(0, 10).join(', ') || '';
    const categories = aiAnalysis?.categories?.join(', ') || '';

    return [
        '---',
        `title: X Bookmarks Knowledge Base`,
        `date: ${now.toISOString().slice(0, 10)}`,
        `exported: "${now.toLocaleString()}"`,
        `bookmarks: ${bookmarks.length}`,
        tags ? `tags: [${tags}]` : '',
        categories ? `categories: [${categories}]` : '',
        '---',
        ''
    ].filter(Boolean).join('\n');
}

/**
 * Render the collection summary section.
 */
function renderSummarySection(bookmarks, aiAnalysis) {
    const parts = [];
    parts.push(`# X Bookmarks Knowledge Base\n`);
    parts.push(`> Exported ${new Date().toLocaleString()} · ${bookmarks.length} bookmarks\n`);

    if (aiAnalysis?.overallSummary) {
        parts.push(`## Collection Overview\n`);
        parts.push(`${sanitize(aiAnalysis.overallSummary)}\n`);
    }

    if (aiAnalysis?.categories?.length) {
        parts.push(`**Main Categories:** ${aiAnalysis.categories.join(' · ')}\n`);
    }

    if (aiAnalysis?.tags?.length) {
        parts.push(`**Key Topics:** ${aiAnalysis.tags.map(t => `\`${t}\``).join(' ')}\n`);
    }

    parts.push(`\n---\n`);
    return parts.join('\n');
}

/**
 * Render a single bookmark as a detailed knowledge-base entry.
 *
 * @param {Object} bookmark        – bookmark data
 * @param {number} index           – 1-based index
 * @param {Object} [deepAnalysis]  – result of GeminiProvider.analyzeBookmark()
 * @param {string[]} [imageTexts]  – array of extracted image texts
 * @param {string[]} [customTags]  – user-defined tags for this bookmark
 * @param {string} [articleSummary] – Jina article summary (if available)
 */
function renderBookmarkEntry(bookmark, index, deepAnalysis, imageTexts, customTags, articleSummary) {
    const parts = [];

    // ── Header ───────────────────────────────────────────────────────────────
    const author = sanitize(bookmark.displayName || bookmark.username || 'Unknown');
    const handle = bookmark.username ? `@${bookmark.username}` : '';
    const date = bookmark.dateTime
        ? new Date(bookmark.dateTime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : '';

    const headlineParts = [`## ${index}. ${author}`];
    if (handle) headlineParts.push(handle);
    if (date) headlineParts.push(`· ${date}`);
    parts.push(headlineParts.join(' ') + '\n');

    // ── Tweet text ───────────────────────────────────────────────────────────
    const tweetText = sanitize(bookmark.text);
    if (tweetText) {
        parts.push(`> ${tweetText.replace(/\n/g, '\n> ')}\n`);
    }

    // ── AI Summary ──────────────────────────────────────────────────────────
    if (deepAnalysis?.summary) {
        parts.push(`\n### Summary\n${sanitize(deepAnalysis.summary)}\n`);
    }

    // ── Key Insights ────────────────────────────────────────────────────────
    if (deepAnalysis?.keyInsights?.length) {
        parts.push(`\n### Key Insights\n`);
        deepAnalysis.keyInsights.forEach(insight => {
            parts.push(`- ${sanitize(insight)}\n`);
        });
    }

    // ── Actionable info ──────────────────────────────────────────────────────
    if (deepAnalysis?.actionableInfo) {
        parts.push(`\n### Actionable Takeaway\n${sanitize(deepAnalysis.actionableInfo)}\n`);
    }

    // ── Image content ────────────────────────────────────────────────────────
    if (imageTexts && imageTexts.length > 0) {
        parts.push(`\n### Image Content\n`);
        imageTexts.forEach((txt, i) => {
            if (txt) {
                parts.push(`**Image ${i + 1}:** ${sanitize(txt)}\n\n`);
            }
        });
    }

    // ── Article summary ──────────────────────────────────────────────────────
    if (articleSummary) {
        parts.push(`\n### Linked Article Summary\n${sanitize(articleSummary)}\n`);
    }

    // ── Metadata row ─────────────────────────────────────────────────────────
    const metaParts = [];
    if (bookmark.likes) metaParts.push(`♥ ${fmtNum(bookmark.likes)}`);
    if (bookmark.retweets) metaParts.push(`↺ ${fmtNum(bookmark.retweets)}`);
    if (bookmark.replies) metaParts.push(`💬 ${fmtNum(bookmark.replies)}`);
    if (bookmark.views) metaParts.push(`👁 ${fmtNum(bookmark.views)}`);
    if (deepAnalysis?.sentiment) metaParts.push(`Sentiment: ${deepAnalysis.sentiment}`);
    if (deepAnalysis?.knowledgeValue) metaParts.push(`Value: ${deepAnalysis.knowledgeValue}`);
    if (metaParts.length) {
        parts.push(`\n*${metaParts.join(' · ')}*\n`);
    }

    // ── Topics & Tags ─────────────────────────────────────────────────────────
    const allTags = [
        ...(customTags || []),
        ...(deepAnalysis?.topics || [])
    ];
    const uniqueTags = [...new Set(allTags.map(t => t.trim().toLowerCase()))].slice(0, 8);
    if (uniqueTags.length) {
        parts.push(`\n**Tags:** ${uniqueTags.map(t => `\`${t}\``).join(' ')}\n`);
    }

    // ── Media links ──────────────────────────────────────────────────────────
    const mediaItems = bookmark.media || [];
    if (mediaItems.length) {
        parts.push(`\n**Media:**\n`);
        mediaItems.forEach(m => {
            const label = m.type === 'video' ? 'Video' : 'Image';
            parts.push(`- [${label}](${m.url})\n`);
        });
    }

    // ── Source link ──────────────────────────────────────────────────────────
    parts.push(`\n**Source:** [View on X](${bookmark.url})\n`);

    parts.push(`\n---\n`);
    return parts.join('');
}

/**
 * Generate the full knowledge-base Markdown string.
 *
 * @param {Object[]} bookmarks         – array of bookmark objects
 * @param {Object}   options
 * @param {Object}   [options.aiAnalysis]          – collection-level AI analysis
 * @param {Object[]} [options.deepAnalyses]         – per-bookmark deep analysis results
 * @param {string[][]} [options.imageTextsPerBookmark] – per-bookmark image texts
 * @param {string[]} [options.articleSummaries]    – per-bookmark article summaries
 * @param {Function} [options.getCustomTags]       – (url) => string[]
 * @param {boolean}  [options.includeFrontMatter]  – include YAML front matter (default true)
 */
function generateKnowledgeBase(bookmarks, options = {}) {
    if (!bookmarks || bookmarks.length === 0) return '';

    const {
        aiAnalysis = null,
        deepAnalyses = [],
        imageTextsPerBookmark = [],
        articleSummaries = [],
        getCustomTags = () => [],
        includeFrontMatter = true
    } = options;

    const parts = [];

    if (includeFrontMatter) {
        parts.push(renderFrontMatter(bookmarks, aiAnalysis));
    }

    parts.push(renderSummarySection(bookmarks, aiAnalysis));

    bookmarks.forEach((bookmark, i) => {
        const deepAnalysis = deepAnalyses[i] || null;
        const imageTexts = imageTextsPerBookmark[i] || [];
        const articleSummary = articleSummaries[i] || '';
        const customTags = getCustomTags(bookmark.url);

        parts.push(renderBookmarkEntry(
            bookmark,
            i + 1,
            deepAnalysis,
            imageTexts,
            customTags,
            articleSummary
        ));
    });

    return parts.join('\n');
}

/**
 * Trigger a browser download of the knowledge base as a .md file.
 */
function downloadKnowledgeBase(bookmarks, options = {}) {
    const md = generateKnowledgeBase(bookmarks, options);
    if (!md) return;

    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-knowledge-base-${date}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

module.exports = {
    generateKnowledgeBase,
    downloadKnowledgeBase,
    renderBookmarkEntry,
    renderSummarySection
};
