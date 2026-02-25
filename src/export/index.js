function filterByScope(records, scope = 'all') {
  if (scope === 'bookmarks') return records.filter((record) => record.scope === 'bookmark');
  if (scope === 'likes') return records.filter((record) => record.scope === 'like');
  return records;
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value).replace(/\n/g, ' ');
  if (/[",]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function mediaUrls(record) {
  return (record.media || [])
    .map((item) => item.url)
    .filter(Boolean)
    .join('; ');
}

function displayName(record) {
  return record.author?.displayName || '';
}

function username(record) {
  return record.author?.username || '';
}

function generateJSONExport(records, { scope = 'all' } = {}) {
  const selected = filterByScope(records, scope);
  return {
    metadata: {
      scope,
      exportedAt: new Date().toISOString(),
      totalRecords: selected.length,
      schemaVersion: 2
    },
    records: selected
  };
}

function generateCSVExport(records, { scope = 'all' } = {}) {
  const selected = filterByScope(records, scope);

  const header = [
    'id',
    'scope',
    'tweetPostedAt',
    'capturedAt',
    'authorDisplayName',
    'authorUsername',
    'text',
    'mediaUrls',
    'likes',
    'retweets',
    'replies',
    'views',
    'url'
  ];

  const rows = [header.join(',')];

  selected.forEach((record) => {
    rows.push([
      escapeCSV(record.id),
      escapeCSV(record.scope),
      escapeCSV(record.tweetPostedAt || ''),
      escapeCSV(record.capturedAt || ''),
      escapeCSV(displayName(record)),
      escapeCSV(username(record)),
      escapeCSV(record.text || ''),
      escapeCSV(mediaUrls(record)),
      escapeCSV(record.metrics?.likes ?? ''),
      escapeCSV(record.metrics?.retweets ?? ''),
      escapeCSV(record.metrics?.replies ?? ''),
      escapeCSV(record.metrics?.views ?? ''),
      escapeCSV(record.url || '')
    ].join(','));
  });

  return rows.join('\n');
}

function generateMarkdownExport(records, { scope = 'all' } = {}) {
  const selected = filterByScope(records, scope);
  const lines = [];

  lines.push('# X-Assistant Report');
  lines.push('');
  lines.push(`- Scope: ${scope}`);
  lines.push(`- Exported: ${new Date().toISOString()}`);
  lines.push(`- Total: ${selected.length}`);
  lines.push('');

  selected.forEach((record, index) => {
    const name = displayName(record) || 'Unknown';
    const user = username(record) || 'unknown';
    const postedAt = record.tweetPostedAt || 'N/A';
    const capturedAt = record.capturedAt || 'N/A';
    const text = record.text || '(No text)';
    const media = mediaUrls(record) || 'None';

    lines.push(`## ${index + 1}. ${name} (@${user})`);
    lines.push(`- Scope: ${record.scope || 'unknown'}`);
    lines.push(`- Tweet Time: ${postedAt}`);
    lines.push(`- Captured At: ${capturedAt}`);
    lines.push(`- URL: ${record.url || ''}`);
    lines.push(`- Text: ${text}`);
    lines.push(`- Media: ${media}`);
    lines.push('');
  });

  return lines.join('\n');
}

function generateTextExport(records, { scope = 'all' } = {}) {
  const selected = filterByScope(records, scope);
  const lines = [];

  lines.push('X-Assistant Report');
  lines.push(`Scope: ${scope}`);
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push(`Total: ${selected.length}`);
  lines.push('');

  selected.forEach((record, index) => {
    const name = displayName(record) || 'Unknown';
    const user = username(record) || 'unknown';
    const postedAt = record.tweetPostedAt || 'N/A';
    const capturedAt = record.capturedAt || 'N/A';
    const text = record.text || '(No text)';
    const media = mediaUrls(record) || 'None';

    lines.push(`[${index + 1}] ${String(record.scope || 'unknown').toUpperCase()}`);
    lines.push(`Author: ${name} (@${user})`);
    lines.push(`Tweet Time: ${postedAt}`);
    lines.push(`Captured At: ${capturedAt}`);
    lines.push(`URL: ${record.url || ''}`);
    lines.push(`Text: ${text}`);
    lines.push(`Media: ${media}`);
    lines.push('');
  });

  return lines.join('\n');
}

module.exports = {
  filterByScope,
  generateJSONExport,
  generateCSVExport,
  generateMarkdownExport,
  generateTextExport,
  escapeCSV
};
