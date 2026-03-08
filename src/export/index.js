function filterRecords(records, { platform = 'all', target = 'all' } = {}) {
  return (records || []).filter((record) => {
    if (platform !== 'all' && record.platform !== platform) return false;
    if (target !== 'all' && record.target !== target) return false;
    return true;
  });
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

function projectRecord(record) {
  return {
    id: record.id,
    platform: record.platform,
    target: record.target,
    postedAt: record.postedAt || '',
    capturedAt: record.capturedAt || '',
    authorDisplayName: displayName(record),
    authorUsername: username(record),
    text: record.text || '',
    mediaUrls: mediaUrls(record),
    likes: record.metrics?.likes ?? '',
    replies: record.metrics?.replies ?? '',
    views: record.metrics?.views ?? '',
    shares: record.metrics?.shares ?? '',
    saves: record.metrics?.saves ?? '',
    platformMetrics: record.metrics?.platform || {},
    url: record.url || ''
  };
}

function buildMetadata(selected, options) {
  return {
    platform: options.platform || 'all',
    target: options.target || 'all',
    exportedAt: new Date().toISOString(),
    totalRecords: selected.length,
    schemaVersion: 3
  };
}

function generateJSONExport(records, options = {}) {
  const selected = filterRecords(records, options);
  return {
    metadata: buildMetadata(selected, options),
    records: selected
  };
}

function generateCSVExport(records, options = {}) {
  const selected = filterRecords(records, options).map(projectRecord);
  const header = [
    'id',
    'platform',
    'target',
    'postedAt',
    'capturedAt',
    'authorDisplayName',
    'authorUsername',
    'text',
    'mediaUrls',
    'likes',
    'replies',
    'views',
    'shares',
    'saves',
    'platformMetrics',
    'url'
  ];

  const rows = [header.join(',')];
  selected.forEach((record) => {
    rows.push([
      escapeCSV(record.id),
      escapeCSV(record.platform),
      escapeCSV(record.target),
      escapeCSV(record.postedAt),
      escapeCSV(record.capturedAt),
      escapeCSV(record.authorDisplayName),
      escapeCSV(record.authorUsername),
      escapeCSV(record.text),
      escapeCSV(record.mediaUrls),
      escapeCSV(record.likes),
      escapeCSV(record.replies),
      escapeCSV(record.views),
      escapeCSV(record.shares),
      escapeCSV(record.saves),
      escapeCSV(JSON.stringify(record.platformMetrics)),
      escapeCSV(record.url)
    ].join(','));
  });

  return rows.join('\n');
}

function generateMarkdownExport(records, options = {}) {
  const selected = filterRecords(records, options).map(projectRecord);
  const lines = [];

  lines.push('# Social Export Report');
  lines.push('');
  lines.push(`- Platform: ${options.platform || 'all'}`);
  lines.push(`- Target: ${options.target || 'all'}`);
  lines.push(`- Exported: ${new Date().toISOString()}`);
  lines.push(`- Total: ${selected.length}`);
  lines.push('');

  selected.forEach((record, index) => {
    const authorName = record.authorDisplayName || 'Unknown';
    const authorUser = record.authorUsername ? ` (@${record.authorUsername})` : '';
    const postedAt = record.postedAt || 'N/A';
    const media = record.mediaUrls || 'None';

    lines.push(`## ${index + 1}. ${authorName}${authorUser}`);
    lines.push(`- Platform: ${record.platform}`);
    lines.push(`- Target: ${record.target}`);
    lines.push(`- Posted At: ${postedAt}`);
    lines.push(`- Captured At: ${record.capturedAt || 'N/A'}`);
    lines.push(`- URL: ${record.url}`);
    lines.push(`- Text: ${record.text || '(No text)'}`);
    lines.push(`- Media: ${media}`);
    lines.push('');
  });

  return lines.join('\n');
}

function generateTextExport(records, options = {}) {
  const selected = filterRecords(records, options).map(projectRecord);
  const lines = [];

  lines.push('Social Export Report');
  lines.push(`Platform: ${options.platform || 'all'}`);
  lines.push(`Target: ${options.target || 'all'}`);
  lines.push(`Exported: ${new Date().toISOString()}`);
  lines.push(`Total: ${selected.length}`);
  lines.push('');

  selected.forEach((record, index) => {
    const authorName = record.authorDisplayName || 'Unknown';
    const authorUser = record.authorUsername ? ` (@${record.authorUsername})` : '';
    lines.push(`[${index + 1}] ${String(record.platform).toUpperCase()} ${String(record.target).toUpperCase()}`);
    lines.push(`Author: ${authorName}${authorUser}`);
    lines.push(`Posted At: ${record.postedAt || 'N/A'}`);
    lines.push(`Captured At: ${record.capturedAt || 'N/A'}`);
    lines.push(`URL: ${record.url}`);
    lines.push(`Text: ${record.text || '(No text)'}`);
    lines.push(`Media: ${record.mediaUrls || 'None'}`);
    lines.push('');
  });

  return lines.join('\n');
}

module.exports = {
  filterRecords,
  projectRecord,
  generateJSONExport,
  generateCSVExport,
  generateMarkdownExport,
  generateTextExport,
  escapeCSV
};
