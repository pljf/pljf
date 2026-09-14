const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCalendar, fetchRepositories, fetchCommits, codingRhythm, updateReadme } = require('./refresh-profile.cjs');

const commit = (index, date = '2026-09-13T20:00:00Z', repo = 'pljf/example') => ({
  sha: index.toString(16).padStart(40, '0'), repository: { private: false, full_name: repo },
  author: { login: 'pljf' }, commit: { author: { date } },
});
const now = new Date('2026-09-14T12:00:00Z');

test('rhythm respects New York daylight saving and all six-hour boundaries', () => {
  const dates = [
    '2026-09-14T04:00:00Z', // summer midnight: night
    '2026-09-14T09:59:59Z', // 05:59: night
    '2026-09-14T10:00:00Z', // 06:00: morning
    '2026-09-14T16:00:00Z', // 12:00: daytime
    '2026-09-14T22:00:00Z', // 18:00: evening
    '2026-01-14T10:30:00Z', // winter 05:30: night
    '2026-01-14T11:00:00Z', // winter 06:00: morning
    '2026-11-01T05:30:00Z', // repeated hour, before DST ends
    '2026-11-01T06:30:00Z', // repeated hour, after DST ends
  ];
  assert.deepEqual(codingRhythm(dates.map(date => ({ date }))).counts, { morning: 2, daytime: 1, evening: 1, night: 5 });
  assert.equal(codingRhythm([]).total, 0);
});

test('calendar detects missing days, duplicates and inconsistent totals', () => {
  const raw = { totalContributions: 2, weeks: [{ contributionDays: [
    { date: '2026-09-13', contributionCount: 2, contributionLevel: 'FIRST_QUARTILE' },
    { date: '2026-09-14', contributionCount: 0, contributionLevel: 'NONE' },
  ] }] };
  assert.deepEqual(normalizeCalendar(raw, 'pljf', '2026-09-13', '2026-09-14').active, [['2026-09-13', 2, 1]]);
  assert.throws(() => normalizeCalendar({ ...raw, totalContributions: 3 }, 'pljf', '2026-09-13', '2026-09-14'), /total/);
  assert.throws(() => normalizeCalendar(raw, 'pljf', '2026-09-12', '2026-09-14'), /incomplete/);
  const duplicate = structuredClone(raw);
  duplicate.weeks[0].contributionDays[1].date = '2026-09-13';
  assert.throws(() => normalizeCalendar(duplicate, 'pljf', '2026-09-13', '2026-09-14'), /Duplicate/);
});

test('repository fetching paginates and excludes accidental private data', async () => {
  const repo = index => ({ name: `repo${index}`, full_name: `pljf/repo${index}`, private: false, fork: false, owner: { login: 'pljf' }, stargazers_count: 0, forks_count: 0 });
  const pages = [];
  const result = await fetchRepositories(async url => {
    const page = Number(new URL(url, 'https://api.github.com').searchParams.get('page'));
    pages.push(page);
    return page === 1 ? Array.from({ length: 100 }, (_, index) => repo(index)) : [repo(100)];
  }, 'pljf');
  assert.equal(result.length, 101);
  assert.deepEqual(pages, [1, 2]);
  await assert.rejects(fetchRepositories(async () => [{ ...repo(0), private: true }], 'pljf'), /public/);
});

test('commit pagination deduplicates mirrored SHAs and filters future author dates', async () => {
  const items = Array.from({ length: 100 }, (_, i) => commit(i));
  const calls = [];
  const result = await fetchCommits(async url => {
    const page = Number(new URL(url, 'https://api.github.com').searchParams.get('page'));
    calls.push(page);
    return { total_count: 102, incomplete_results: false, items: page === 1 ? items : [commit(0, undefined, 'pljf/mirror'), commit(100, '2026-09-14T23:00:00Z')] };
  }, 'pljf', '2026-09-13', '2026-09-14', now);
  assert.equal(result.length, 100);
  assert.deepEqual(calls, [1, 2]);
});

test('large and incomplete search windows split into complete date windows', async () => {
  for (const partial of [false, true]) {
    const queries = [];
    const result = await fetchCommits(async url => {
      const q = new URL(url, 'https://api.github.com').searchParams.get('q');
      queries.push(q);
      if (q.endsWith('2026-09-13..2026-09-14')) return { total_count: partial ? 2 : 1001, incomplete_results: partial, items: [] };
      return { total_count: 1, incomplete_results: false, items: [commit(q.endsWith('2026-09-13..2026-09-13') ? 1 : 2)] };
    }, 'pljf', '2026-09-13', '2026-09-14', now);
    assert.equal(queries.length, 3);
    assert.equal(result.length, 2);
  }
});

test('unresolvable, truncated and private commit results fail closed', async () => {
  await assert.rejects(fetchCommits(async () => ({ total_count: 1, incomplete_results: true, items: [] }), 'pljf', '2026-09-14', '2026-09-14', now), /completely resolve/);
  let count = 0;
  await assert.rejects(fetchCommits(async () => ({ total_count: 101, incomplete_results: false, items: count++ ? [] : Array.from({ length: 100 }, (_, i) => commit(i)) }), 'pljf', '2026-09-13', '2026-09-14', now), /incomplete/);
  const privateCommit = commit(1);
  privateCommit.repository.private = true;
  await assert.rejects(fetchCommits(async () => ({ total_count: 1, incomplete_results: false, items: [privateCommit] }), 'pljf', '2026-09-13', '2026-09-14', now), /public/);
});

test('README updates only generated sections and handles no commits without NaN', () => {
  const readme = 'Personal introduction\n<!--START_SECTION:profile-updated-->old<!--END_SECTION:profile-updated-->\nMy projects\n<!--START_SECTION:coding-rhythm-->old<!--END_SECTION:coding-rhythm-->\nContact links';
  const updated = updateReadme(readme, { start: '2025-09-15', end: '2026-09-14' }, codingRhythm([]), now.toISOString());
  assert(updated.startsWith('Personal introduction\n'));
  assert(updated.includes('\nMy projects\n'));
  assert(updated.endsWith('\nContact links'));
  assert(updated.includes('New York time'));
  assert(updated.includes('2026-09-14 12:00 UTC'));
  assert(!/NaN|Infinity|Awaiting/.test(updated));
  assert.throws(() => updateReadme('No markers', {}, codingRhythm([]), now.toISOString()), /marker/);
});
