'use strict';

// Pure renderers: fetching and writing belong to the update script.
const assert = require('node:assert/strict');
const DAY = 86_400_000;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const f = value => Number(value.toFixed(3));
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const rangeFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const palettes = {
  dark: { title: '#00b3b3', text: '#f0f6fc', label: '#8b949e', divider: '#30363d', line: '#00b3b3', point: '#f78166', calendarMuted: '#aaa398', calendarFaint: '#877e71', calendarRule: '#34312d' },
  light: { title: '#00838f', text: '#24292f', label: '#57606a', divider: '#d8dee4', line: '#00b3b3', point: '#f78166', calendarMuted: '#746858', calendarFaint: '#847765', calendarRule: '#e8e0d4' },
};
const textStyle = '<style>text{font-family:Arial,Helvetica,sans-serif}.metric{font-weight:600}.label{font-size:12px}.date{font-size:10px}</style>';

function parseDate(iso) {
  assert.equal(typeof iso, 'string', 'Calendar dates must be strings.');
  assert.match(iso, /^\d{4}-\d{2}-\d{2}$/);
  const date = new Date(`${iso}T00:00:00Z`);
  assert(Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso, `Invalid calendar date: ${iso}`);
  return date;
}

function normalizeCalendar(input) {
  assert(input && typeof input.username === 'string' && input.username, 'A GitHub username is required.');
  const start = parseDate(input.start);
  const end = parseDate(input.end);
  const capturedDate = parseDate(String(input.captured).slice(0, 10));
  assert(end >= start && capturedDate >= end, 'Calendar range must end no later than its capture date.');
  assert.equal(input.zeroDaysOmitted, true, 'Omitted days must explicitly represent zero contributions.');
  assert.equal((end - start) / DAY + 1, input.days, 'Inclusive period must match the declared day count.');
  assert(Number.isSafeInteger(input.days) && input.days >= 1 && input.days <= 366, 'Expected a calendar of at most one year.');
  assert(Array.isArray(input.active), 'Active contribution days are required.');
  const active = new Map();
  for (const [iso, count, level] of input.active) {
    const date = parseDate(iso);
    assert(date >= start && date <= end, `Active date outside the calendar: ${iso}`);
    assert(!active.has(iso), `Duplicate calendar date: ${iso}`);
    assert(Number.isSafeInteger(count) && count > 0, `Invalid contribution count: ${iso}`);
    assert(Number.isInteger(level) && level >= 1 && level <= 4, `Invalid contribution level: ${iso}`);
    active.set(iso, { count, level });
  }
  const days = Array.from({ length: input.days }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY);
    const iso = date.toISOString().slice(0, 10);
    return { date, iso, ...(active.get(iso) || { count: 0, level: 0 }) };
  });
  const total = days.reduce((sum, day) => sum + day.count, 0);
  assert(Number.isSafeInteger(total), 'Contribution total exceeds integer precision.');
  assert.equal(total, input.total, 'Contribution total must match the daily data.');
  let runLength = 0;
  let runStart = null;
  let longest = { length: 0, start: null, end: null };
  for (const day of days) {
    if (day.count) {
      if (!runLength) runStart = day.iso;
      runLength += 1;
      if (runLength > longest.length) longest = { length: runLength, start: runStart, end: day.iso };
    } else {
      runLength = 0;
      runStart = null;
    }
  }
  // Today is still in progress: a streak ending yesterday remains current.
  let index = days.length - 1;
  if (days[index].count === 0) index -= 1;
  const currentEnd = index >= 0 && days[index].count ? days[index].iso : null;
  let current = 0;
  while (index >= 0 && days[index].count) { current += 1; index -= 1; }
  const recent = days.slice(-30);
  const recentTotal = recent.reduce((sum, day) => sum + day.count, 0);
  const metadata = {
    username: input.username, source: input.source, captured: input.captured,
    start: input.start, end: input.end, days: input.days, total, activeDays: active.size,
    currentStreak: current, currentStreakEnd: currentEnd,
    currentStreakRule: 'A streak ending yesterday remains current when the calendar end day has zero contributions.',
    longestStreak: longest, recentStart: recent[0].iso, recentDays: recent.length, recentTotal,
  };
  return { input, start, end, capturedDate, days, active, total, current, longest, recent, recentTotal, metadata, name: input.username === 'pljf' ? 'Patrick Luo' : input.username };
}

function frame(width, height, title, description, metadata, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">\n<title id="title">${escape(title)}</title>\n<desc id="desc">${escape(description)}</desc>\n<metadata>${escape(JSON.stringify(metadata))}</metadata>\n${body}\n</svg>\n`;
}

function contributionSvg(data, theme) {
  const { input, days, start, end, total, active } = data;
  const p = palettes[theme];
  const firstSunday = start.getTime() - start.getUTCDay() * DAY;
  const weekCount = Math.floor((end.getTime() - firstSunday) / (7 * DAY)) + 1;
  // Some leap-year windows occupy 54 week columns. Fit them without dropping a day.
  const spacingScale = Math.min(1, 52 / Math.max(1, weekCount - 1));
  const geometry = { width: 1000, height: 420, stepX: 15.2 * spacingScale, stepY: 3.8 * spacingScale, tileX: 14 * spacingScale, tileY: 3.5 * spacingScale, originX: 142, originY: 126, floor: 2.5 };
  const { tileX: tx, tileY: ty } = geometry;
  const cells = days.map(day => {
    const week = Math.floor((day.date.getTime() - firstSunday) / (7 * DAY));
    const weekday = day.date.getUTCDay();
    return { ...day, week, weekday, x: geometry.originX + (week - weekday) * geometry.stepX, y: geometry.originY + (week + weekday) * geometry.stepY };
  });
  // Keep a linear, uniform height scale. Reduce it for large counts so the highest
  // tower remains below the heading; metadata records the exact pixels/count.
  const pixelsPerContribution = Math.min(4, ...cells.filter(cell => cell.count).map(cell => (cell.y - ty - 82 - geometry.floor) / cell.count));
  for (const cell of cells) cell.height = geometry.floor + cell.count * pixelsPerContribution;
  const bounds = {
    left: Math.min(...cells.map(cell => cell.x - tx)), top: Math.min(...cells.map(cell => cell.y - cell.height - ty)),
    right: Math.max(...cells.map(cell => cell.x + tx)), bottom: Math.max(...cells.map(cell => cell.y + ty)),
  };
  assert(bounds.left >= 30 && bounds.right <= 970 && bounds.top >= 81.999 && bounds.bottom < 365, 'Contribution board exceeds its image margins.');
  function color(cell, face) {
    const hue = Math.round(285 - cell.week * 285 / Math.max(1, weekCount - 1));
    const saturation = cell.count ? (theme === 'dark' ? 62 : 53) : 25;
    const levels = theme === 'dark' ? [12, 30, 40, 49, 59] : [94, 72, 61, 50, 40];
    const shade = face === 'top' ? 0 : face === 'left' ? -12 : -6;
    return `hsl(${hue} ${saturation}% ${Math.max(5, levels[cell.level] + shade)}%)`;
  }
  const bars = cells.slice().sort((a, b) => a.y - b.y || a.x - b.x).map(cell => {
    const h = f(cell.height);
    const motion = cell.count ? ` class="tower" style="--rise:-${h}px;--floor-scale:${f(geometry.floor / h)};--delay:${f(0.14 + cell.week * 0.018 + cell.weekday * 0.009)}s"` : '';
    return `<g transform="translate(${f(cell.x)} ${f(cell.y)})"${motion} data-date="${cell.iso}" data-count="${cell.count}" data-level="${cell.level}"><title>${cell.iso}: ${cell.count} contribution${cell.count === 1 ? '' : 's'}</title><g class="faces"><path d="M ${f(-tx)} ${-h} L 0 ${f(ty - h)} L 0 ${f(ty)} L ${f(-tx)} 0 Z" fill="${color(cell, 'left')}"/><path d="M 0 ${f(ty - h)} L ${f(tx)} ${-h} L ${f(tx)} 0 L 0 ${f(ty)} Z" fill="${color(cell, 'right')}"/></g><g class="top" transform="translate(0 ${-h})"><path d="M 0 ${f(-ty)} L ${f(tx)} 0 L 0 ${f(ty)} L ${f(-tx)} 0 Z" fill="${color(cell, 'top')}"/></g></g>`;
  }).join('\n');
  const monthStarts = cells.filter((cell, index) => index === 0 || cell.date.getUTCDate() === 1);
  const months = monthStarts.map(cell => `<text x="${f(geometry.originX + (cell.week - 6) * geometry.stepX)}" y="${f(geometry.originY + (cell.week + 7) * geometry.stepY + 17)}" fill="${p.calendarFaint}" font-size="11" text-anchor="middle">${monthFormat.format(cell.date)}</text>`).join('\n');
  const range = `${rangeFormat.format(start)} — ${rangeFormat.format(end)}`;
  const metadata = { ...data.metadata, weekCount, pixelsPerContribution, tileHeight: geometry.floor, heightScale: 'Uniform linear pixels per contribution; reduced from 4 when needed to keep all towers inside the board.', bounds };
  const body = `<style>
text{font-family:Georgia,'Times New Roman',serif}.detail{font-family:Arial,Helvetica,sans-serif}
@media(prefers-reduced-motion:no-preference){.tower .faces{transform-origin:0 0;animation:rise-faces 1.15s cubic-bezier(.22,.61,.36,1) var(--delay) both}.tower .top{animation:rise-top 1.15s cubic-bezier(.22,.61,.36,1) var(--delay) both}@keyframes rise-faces{from{transform:scaleY(var(--floor-scale))}to{transform:scaleY(1)}}@keyframes rise-top{from{transform:translateY(-2.5px)}to{transform:translateY(var(--rise))}}}
</style>
<text x="44" y="37" fill="${p.text}" font-size="25">Daily contributions</text>
<text x="44" y="61" fill="${p.calendarMuted}" font-size="12" class="detail">${escape(range)}</text>
<text x="956" y="35" fill="${p.title}" font-size="19" text-anchor="end">${total} contributions</text>
<text x="956" y="59" fill="${p.calendarMuted}" font-size="12" text-anchor="end" class="detail">${active.size} active days</text>
<g class="calendar" aria-label="${input.days} daily contribution tiles">${bars}</g>
<g class="months" aria-hidden="true">${months}</g>
<path d="M 44 375 H 956" stroke="${p.calendarRule}" stroke-width="1"/>
<text x="44" y="399" fill="${p.calendarMuted}" font-size="11" class="detail">Each tile, a day. Height follows contributions.</text>
<text x="956" y="399" fill="${p.calendarFaint}" font-size="11" text-anchor="end" class="detail">Updated · ${escape(input.captured.slice(0, 10))}</text>`;
  return frame(1000, 420, `${data.name} — 3D GitHub contribution calendar`, `${range}. ${total} contributions across ${active.size} active days, from ${input.days} daily GitHub counts updated on ${input.captured}. Each day is a tile. Tower height is linear at ${pixelsPerContribution} pixels per contribution above a ${geometry.floor} pixel tile. Active columns rise once, then remain still.`, metadata, body);
}

function streakSvg(data, theme) {
  const { input, current, total, longest } = data;
  const p = palettes[theme];
  const longestRange = longest.length ? `${shortFormat.format(parseDate(longest.start))} – ${shortFormat.format(parseDate(longest.end))}` : 'No active days';
  const totalSize = Math.min(36, 180 / Math.max(1, String(total).length));
  const body = `${textStyle}
<text x="22" y="31" fill="${p.title}" font-size="19" font-weight="600">Contribution streaks</text>
<text x="22" y="52" fill="${p.label}" class="label">${input.days} days · Updated ${dateFormat.format(data.capturedDate)}</text>
<path d="M 165 82 V 184 M 330 82 V 184" stroke="${p.divider}" stroke-width="1"/>
<text x="83" y="132" fill="${p.text}" class="metric" font-size="${f(totalSize)}" text-anchor="middle">${total}</text>
<text x="83" y="168" fill="${p.label}" class="label" text-anchor="middle">Total contributions</text>
<text x="83" y="190" fill="${p.label}" class="date" text-anchor="middle">In this ${input.days}-day period</text>
<circle cx="247.5" cy="120" r="34" fill="none" stroke="${p.title}" stroke-width="3"/>
<text x="247.5" y="132" fill="${p.text}" class="metric" font-size="${current > 99 ? 29 : 36}" text-anchor="middle">${current}</text>
<text x="247.5" y="168" fill="${p.title}" class="label" text-anchor="middle">Current streak</text>
<text x="247.5" y="190" fill="${p.label}" class="date" text-anchor="middle">As of ${shortFormat.format(data.end)}</text>
<text x="412" y="132" fill="${p.text}" class="metric" font-size="36" text-anchor="middle">${longest.length}</text>
<text x="412" y="168" fill="${p.label}" class="label" text-anchor="middle">Longest streak</text>
<text x="412" y="190" fill="${p.label}" class="date" text-anchor="middle">${longestRange}</text>`;
  return frame(495, 220, `${data.name} — contribution streaks`, `${input.start} through ${input.end}: ${total} contributions across ${input.days} days. Current streak: ${current} days; yesterday remains current if today has no contributions yet. Longest streak within the displayed period: ${longest.length} days${longest.length ? `, ${longest.start} through ${longest.end}` : ''}. These are period statistics, not all-time statistics.`, data.metadata, body);
}

function activitySvg(data, theme) {
  const { input, recent, recentTotal } = data;
  const p = palettes[theme];
  const maxCount = Math.max(...recent.map(day => day.count));
  const step = Math.max(1, Math.ceil(maxCount / 4));
  const ceiling = step * 4;
  const plot = { left: Math.max(52, String(ceiling).length * 7 + 18), right: 974, top: 78, bottom: 214 };
  const positions = recent.map((day, index) => ({ ...day, x: plot.left + index * (plot.right - plot.left) / Math.max(1, recent.length - 1), y: plot.bottom - day.count / ceiling * (plot.bottom - plot.top) }));
  const line = positions.map((point, index) => `${index ? 'L' : 'M'} ${f(point.x)} ${f(point.y)}`).join(' ');
  const area = `${line} L ${f(positions.at(-1).x)} ${plot.bottom} L ${plot.left} ${plot.bottom} Z`;
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = index * step;
    const y = plot.bottom - value / ceiling * (plot.bottom - plot.top);
    return `<path d="M ${plot.left} ${f(y)} H ${plot.right}" stroke="${p.divider}" stroke-width="1"${index ? ' stroke-dasharray="3 5"' : ''}/><text x="${plot.left - 12}" y="${f(y + 4)}" fill="${p.label}" font-size="11" text-anchor="end">${value}</text>`;
  }).join('\n');
  const labelIndices = [...new Set(Array.from({ length: Math.min(7, recent.length) }, (_, index) => Math.round(index * (recent.length - 1) / Math.max(1, Math.min(7, recent.length) - 1))))];
  const labels = labelIndices.map(index => {
    const point = positions[index];
    return `<path d="M ${f(point.x)} ${plot.bottom} v 4" stroke="${p.divider}"/><text x="${f(point.x)}" y="239" fill="${p.label}" font-size="11" text-anchor="${index === 0 ? 'start' : index === recent.length - 1 ? 'end' : 'middle'}">${shortFormat.format(point.date)}</text>`;
  }).join('\n');
  const points = positions.map(point => `<circle cx="${f(point.x)}" cy="${f(point.y)}" r="2.5" fill="${p.point}" data-date="${point.iso}" data-count="${point.count}"><title>${point.iso}: ${point.count} contribution${point.count === 1 ? '' : 's'}</title></circle>`).join('\n');
  const body = `${textStyle}
<text x="24" y="31" fill="${p.title}" font-size="20" font-weight="600">Contribution activity</text>
<text x="24" y="52" fill="${p.label}" font-size="12">${recentTotal} contributions in the last ${recent.length} days</text>
<text x="974" y="32" fill="${p.label}" font-size="12" text-anchor="end">Updated · ${dateFormat.format(data.capturedDate)}</text>
<text x="${plot.left}" y="68" fill="${p.label}" font-size="10">Contributions / day</text>
${grid}
<path d="M ${plot.left} ${plot.top} V ${plot.bottom}" stroke="${p.divider}" stroke-width="1"/>
<path d="${area}" fill="${p.line}" fill-opacity="0.12"/>
<path d="${line}" fill="none" stroke="${p.line}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
${points}
${labels}`;
  return frame(1000, 270, `${data.name} — daily contribution activity in the last ${recent.length} days`, `Daily GitHub contributions from ${recent[0].iso} through ${input.end}, updated on ${input.captured}. Total ${recentTotal} contributions across ${recent.length} days. Horizontal axis: dates. Vertical axis: contributions per day, zero to ${ceiling}. Maximum daily count: ${maxCount}.`, { ...data.metadata, activityMaximum: maxCount, activityAxisMaximum: ceiling }, body);
}

function repositoryTotals(repositories, username) {
  assert(Array.isArray(repositories), 'Public repository data is required.');
  const names = new Set();
  let stars = 0;
  let forks = 0;
  let original = 0;
  for (const repo of repositories) {
    assert(repo.private === false, 'Only public repository data may be rendered.');
    assert(typeof repo.fork === 'boolean', 'Repository fork status is required.');
    assert(typeof repo.full_name === 'string' && repo.full_name.split('/')[0].toLowerCase() === username.toLowerCase(), 'Only repositories owned by the profile user may be rendered.');
    assert(!names.has(repo.full_name.toLowerCase()), 'Duplicate repository in source data.');
    names.add(repo.full_name.toLowerCase());
    for (const key of ['stars', 'forks']) assert(Number.isSafeInteger(repo[key]) && repo[key] >= 0, `Invalid repository ${key} count.`);
    stars += repo.stars;
    forks += repo.forks;
    if (!repo.fork) original += 1;
  }
  assert(Number.isSafeInteger(stars) && Number.isSafeInteger(forks), 'Repository totals exceed integer precision.');
  return { publicRepositories: repositories.length, originalRepositories: original, includedForks: repositories.length - original, stars, forks };
}

function statsSvg(data, totals, theme) {
  const p = palettes[theme];
  const title = data.input.username === 'pljf' ? "Patrick's GitHub Stats" : `${data.name}'s GitHub Stats`;
  const t = (x, y, value, size = 14, color = p.text, weight = 400, extra = '') => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" ${extra}>${escape(value)}</text>`;
  let body = t(25, 30, title, 20, p.title, 600) + t(25, 52, `Public repositories · Updated ${dateFormat.format(data.capturedDate)}`, 12, p.label);
  const rows = [['Public repositories', totals.publicRepositories], ['Original public repositories', totals.originalRepositories], ['Stars received', totals.stars], ['Forks received', totals.forks]];
  rows.forEach(([label, value], index) => {
    const y = 83 + index * 29;
    body += `<rect x="26" y="${y - 9}" width="7" height="7" rx="1.5" fill="${p.title}"/>` + t(45, y, label, 14, p.text, 500) + t(461, y, value, Math.min(15, 210 / String(value).length), p.text, 600, 'text-anchor="end"');
  });
  body += `<path d="M25 186H470" stroke="${p.divider}"/>` + t(25, 207, `Includes ${totals.includedForks} fork${totals.includedForks === 1 ? '' : 's'} · github.com/${data.input.username}`, 12, p.label);
  return frame(495, 220, title, `Updated ${dateFormat.format(data.capturedDate)}: ${totals.publicRepositories} public repositories, ${totals.originalRepositories} original repositories, ${totals.stars} stars received, ${totals.forks} forks received. Counts include only public repositories owned by ${data.input.username}.`, { username: data.input.username, captured: data.input.captured, ...totals }, `<g font-family="Segoe UI,Arial,sans-serif">${body}</g>`);
}

function renderCards({ calendar, repositories }) {
  const data = normalizeCalendar(calendar);
  const totals = repositoryTotals(repositories, calendar.username);
  const cards = {};
  for (const theme of ['dark', 'light']) {
    cards[`reference-contributions-${theme}.svg`] = contributionSvg(data, theme);
    cards[`reference-streak-${theme}.svg`] = streakSvg(data, theme);
    cards[`reference-activity-${theme}.svg`] = activitySvg(data, theme);
    cards[`reference-stats-${theme}.svg`] = statsSvg(data, totals, theme);
  }
  return cards;
}

module.exports = { renderCards };
