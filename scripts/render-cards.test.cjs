'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderCards } = require('./render-cards.cjs');
const DAY = 86_400_000;
function calendar(start, end, active = []) {
  return { username: 'pljf', source: 'https://github.com/users/pljf/contributions', captured: end, start, end, days: (new Date(end) - new Date(start)) / DAY + 1, total: active.reduce((sum, day) => sum + day[1], 0), zeroDaysOmitted: true, active };
}
function metadata(svg) {
  return JSON.parse(svg.match(/<metadata>(.*?)<\/metadata>/s)[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]));
}
const fixtureRepos = [
  { name: 'one', full_name: 'pljf/one', private: false, fork: false, stars: 3, forks: 2 },
  { name: 'two', full_name: 'pljf/two', private: false, fork: true, stars: 1, forks: 0 },
];

test('renders exactly eight self-contained assets, including an empty 365-day year', () => {
  const cards = renderCards({ calendar: calendar('2025-01-01', '2025-12-31'), repositories: [] });
  assert.deepEqual(Object.keys(cards).sort(), ['activity', 'contributions', 'stats', 'streak'].flatMap(kind => ['dark', 'light'].map(theme => `reference-${kind}-${theme}.svg`)).sort());
  for (const svg of Object.values(cards)) {
    assert.match(svg, /^<svg /);
    assert.match(svg, /Updated/);
    assert.doesNotMatch(svg, /<script\b|<foreignObject\b|\shref=|\sxlink:href=|NaN|Infinity|snapshot/i);
  }
  const contribution = cards['reference-contributions-dark.svg'];
  assert.equal((contribution.match(/data-date=/g) || []).length, 365);
  assert.equal((contribution.match(/class="tower"/g) || []).length, 0);
  assert.equal(metadata(contribution).total, 0);
  const activity = cards['reference-activity-light.svg'];
  assert.equal((activity.match(/data-date=/g) || []).length, 30);
  assert.equal(metadata(activity).activityAxisMaximum, 4);
  assert.equal(metadata(activity).recentStart, '2025-12-02');
  const streak = cards['reference-streak-dark.svg'];
  assert.match(streak, /No active days/);
  assert.deepEqual(metadata(streak).longestStreak, { length: 0, start: null, end: null });
  assert.equal(metadata(streak).currentStreak, 0);
});

test('preserves all 366 dates in a 54-column leap-year window and fits extreme towers', () => {
  const input = calendar('2028-01-01', '2028-12-31', [['2028-01-01', 100_000, 4], ['2028-02-29', 500, 2], ['2028-12-31', 1_000_000, 4]]);
  const cards = renderCards({ calendar: input, repositories: [] });
  for (const theme of ['dark', 'light']) {
    const svg = cards[`reference-contributions-${theme}.svg`];
    const dates = [...svg.matchAll(/data-date="([^"]+)" data-count="(\d+)"/g)];
    assert.equal(dates.length, 366);
    assert.equal(new Set(dates.map(match => match[1])).size, 366);
    assert.equal(dates.reduce((sum, match) => sum + Number(match[2]), 0), 1_100_500);
    const data = metadata(svg);
    assert.equal(data.weekCount, 54);
    assert(data.pixelsPerContribution > 0 && data.pixelsPerContribution < 4);
    assert(data.bounds.top >= 81.999 && data.bounds.left >= 30 && data.bounds.right <= 970 && data.bounds.bottom < 365);
    assert.equal(data.activeDays, 3);
    assert.match(svg, /data-date="2028-02-29" data-count="500"/);
    assert.match(svg, /prefers-reduced-motion:no-preference/);
  }
});

test('calculates current and longest streaks across a year boundary with yesterday grace', () => {
  const input = calendar('2025-12-01', '2026-01-02', [['2025-12-30', 2, 1], ['2025-12-31', 3, 2], ['2026-01-01', 1, 1]]);
  const cards = renderCards({ calendar: input, repositories: fixtureRepos });
  const data = metadata(cards['reference-streak-dark.svg']);
  assert.equal(data.currentStreak, 3);
  assert.equal(data.currentStreakEnd, '2026-01-01');
  assert.deepEqual(data.longestStreak, { length: 3, start: '2025-12-30', end: '2026-01-01' });
  assert.equal(data.recentDays, 30);
  assert.equal(data.recentStart, '2025-12-04');
  assert.equal(data.recentTotal, 6);
  const expired = renderCards({ calendar: calendar('2025-12-01', '2026-01-03', input.active), repositories: [] });
  assert.equal(metadata(expired['reference-streak-dark.svg']).currentStreak, 0);
  const ongoing = renderCards({ calendar: calendar('2025-12-01', '2026-01-01', input.active), repositories: [] });
  assert.equal(metadata(ongoing['reference-streak-dark.svg']).currentStreak, 3);
});

test('recent activity is based on the last 30 calendar dates, not the last 30 active dates', () => {
  const input = calendar('2025-01-01', '2025-12-31', [['2025-01-01', 12, 4], ['2025-12-01', 9, 3], ['2025-12-02', 7, 3], ['2025-12-31', 2, 1]]);
  const cards = renderCards({ calendar: input, repositories: [] });
  const svg = cards['reference-activity-dark.svg'];
  const data = metadata(svg);
  assert.equal(data.total, 30);
  assert.equal(data.recentTotal, 9);
  assert.equal(data.activityMaximum, 7);
  assert.equal(data.activityAxisMaximum, 8);
  assert.equal([...svg.matchAll(/data-count="(\d+)"/g)].reduce((sum, match) => sum + Number(match[1]), 0), 9);
});

test('computes public owned repository totals and rejects private or foreign repositories', () => {
  const input = calendar('2025-01-01', '2025-12-31');
  const cards = renderCards({ calendar: input, repositories: fixtureRepos });
  const data = metadata(cards['reference-stats-dark.svg']);
  assert.equal(data.publicRepositories, 2);
  assert.equal(data.originalRepositories, 1);
  assert.equal(data.includedForks, 1);
  assert.equal(data.stars, 4);
  assert.equal(data.forks, 2);
  assert.match(cards['reference-stats-dark.svg'], /Includes 1 fork · github.com\/pljf/);
  assert.throws(() => renderCards({ calendar: input, repositories: [{ ...fixtureRepos[0], private: true }] }), /Only public/);
  assert.throws(() => renderCards({ calendar: input, repositories: [{ ...fixtureRepos[0], full_name: 'someone/one' }] }), /owned by/);
  assert.throws(() => renderCards({ calendar: input, repositories: [fixtureRepos[0], fixtureRepos[0]] }), /Duplicate repository/);
});

test('rejects incomplete or contradictory calendar data before rendering any asset', () => {
  const input = calendar('2025-01-01', '2025-12-31', [['2025-12-31', 2, 1]]);
  const render = value => renderCards({ calendar: value, repositories: [] });
  assert.throws(() => render({ ...input, total: 5 }), /total must match/);
  assert.throws(() => render({ ...input, days: 366 }), /Inclusive period/);
  assert.throws(() => render({ ...input, zeroDaysOmitted: false }), /Omitted days/);
  assert.throws(() => render({ ...input, active: [...input.active, ...input.active] }), /Duplicate calendar/);
  assert.throws(() => render({ ...input, active: [['2025-02-29', 2, 1]] }), /Invalid calendar date/);
  assert.throws(() => render({ ...input, active: [['2026-01-01', 2, 1]] }), /outside the calendar/);
});

test('supports a short calendar safely and escapes untrusted source metadata', () => {
  const input = { ...calendar('2026-01-01', '2026-01-01', [['2026-01-01', 1, 1]]), source: 'https://example.com/?x=<script>&y="value"' };
  const cards = renderCards({ calendar: input, repositories: [] });
  const svg = cards['reference-activity-dark.svg'];
  assert.equal(metadata(svg).recentDays, 1);
  assert.equal(metadata(svg).source, input.source);
  assert.doesNotMatch(svg, /<script>|NaN|Infinity/);
});
