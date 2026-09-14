const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const DAY = 86400000;
const TIME_ZONE = 'America/New_York';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const isoDay = date => date.toISOString().slice(0, 10);
const dateMs = value => Date.parse(`${value}T00:00:00Z`);

function createClient(token) {
  let lastSearch = 0;
  return async function request(endpoint, body) {
    assert(endpoint.startsWith('/') && !endpoint.startsWith('//'));
    if (endpoint.startsWith('/search/')) {
      await delay(Math.max(0, 2100 - (Date.now() - lastSearch)));
      lastSearch = Date.now();
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      try {
        response = await fetch(`https://api.github.com${endpoint}`, {
          method: body ? 'POST' : 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: `Bearer ${token}`,
            'X-GitHub-Api-Version': '2026-03-10',
            'User-Agent': 'pljf-profile-refresh',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30000),
          redirect: 'error',
        });
      } catch {
        if (attempt === 2) throw new Error('GitHub could not be reached; keeping the last successful profile.');
        await delay(2000 * (attempt + 1));
        continue;
      }
      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429 ||
          (response.status === 403 && (response.headers.get('retry-after') || response.headers.get('x-ratelimit-remaining') === '0'));
        if (retryable && attempt < 2) {
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
          const retryAfter = Number(response.headers.get('retry-after')) * 1000;
          await delay(Math.min(60000, Math.max(3000, retryAfter || reset - Date.now())));
          continue;
        }
        throw new Error(`GitHub ${endpoint.split('?')[0]} returned HTTP ${response.status}; keeping the last successful profile.`);
      }
      const data = await response.json();
      if (data.errors?.length) throw new Error(`GitHub GraphQL: ${data.errors.map(error => error.message).join('; ')}`);
      return data;
    }
  };
}

function normalizeCalendar(raw, username, start, end) {
  assert(raw && Array.isArray(raw.weeks), 'Missing GitHub contribution calendar.');
  const daily = raw.weeks.flatMap(week => week.contributionDays)
    .filter(day => day.date >= start && day.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date));
  const expected = (dateMs(end) - dateMs(start)) / DAY + 1;
  assert.equal(daily.length, expected, 'GitHub returned an incomplete calendar.');
  const levels = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
  daily.forEach((day, index) => {
    assert.equal(day.date, isoDay(new Date(dateMs(start) + index * DAY)), 'Duplicate or missing calendar day.');
    assert(Number.isInteger(day.contributionCount) && day.contributionCount >= 0, 'Invalid contribution count.');
    assert(levels.includes(day.contributionLevel), 'Invalid contribution level.');
  });
  const total = daily.reduce((sum, day) => sum + day.contributionCount, 0);
  assert.equal(total, raw.totalContributions, 'Contribution total does not match daily counts.');
  return {
    username, source: `https://github.com/users/${username}/contributions`,
    captured: end, start, end, days: expected, total, zeroDaysOmitted: true,
    active: daily.filter(day => day.contributionCount > 0)
      .map(day => [day.date, day.contributionCount, levels.indexOf(day.contributionLevel)]),
  };
}

async function fetchCalendar(request, username, now) {
  const end = isoDay(now);
  // Keep the full first day while staying within GraphQL's one-year limit.
  const start = isoDay(new Date(dateMs(end) - 364 * DAY));
  const result = await request('/graphql', {
    query: `query ProfileCalendar($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) { contributionsCollection(from: $from, to: $to) {
        contributionCalendar { totalContributions weeks {
          contributionDays { date contributionCount contributionLevel }
        } }
      } }
    }`,
    variables: { login: username, from: `${start}T00:00:00Z`, to: now.toISOString() },
  });
  return normalizeCalendar(result.data?.user?.contributionsCollection?.contributionCalendar, username, start, end);
}

async function fetchRepositories(request, username) {
  const repositories = new Map();
  for (let page = 1; ; page++) {
    const items = await request(`/users/${username}/repos?type=owner&sort=full_name&per_page=100&page=${page}`);
    assert(Array.isArray(items), 'Missing public repository list.');
    for (const repo of items) {
      assert.equal(repo.private, false, 'Only public repositories are supported.');
      assert.equal(repo.owner?.login.toLowerCase(), username.toLowerCase(), 'Unexpected repository owner.');
      assert.equal(typeof repo.fork, 'boolean');
      assert(Number.isInteger(repo.stargazers_count) && Number.isInteger(repo.forks_count));
      repositories.set(repo.full_name, {
        name: repo.name, full_name: repo.full_name, private: false, fork: repo.fork,
        stars: repo.stargazers_count, forks: repo.forks_count,
      });
    }
    if (items.length < 100) return [...repositories.values()];
  }
}

async function fetchCommits(request, username, start, end, now) {
  async function window(from, to) {
    const q = encodeURIComponent(`author:${username} is:public author-date:${from}..${to}`);
    const endpoint = `/search/commits?q=${q}&sort=author-date&order=asc&per_page=100`;
    const first = await request(`${endpoint}&page=1`);
    assert(Number.isInteger(first.total_count) && first.total_count >= 0 && Array.isArray(first.items), 'Missing commit search results.');
    if (first.total_count > 1000 || first.incomplete_results) {
      assert(from !== to, `GitHub commit search could not completely resolve ${from}.`);
      const middle = dateMs(from) + Math.floor((dateMs(to) - dateMs(from)) / DAY / 2) * DAY;
      return [...await window(from, isoDay(new Date(middle))), ...await window(isoDay(new Date(middle + DAY)), to)];
    }
    const items = [...first.items];
    for (let page = 2; items.length < first.total_count; page++) {
      const next = await request(`${endpoint}&page=${page}`);
      assert(!next.incomplete_results && next.total_count === first.total_count && next.items?.length, 'Commit search changed or was incomplete; retry on the next run.');
      items.push(...next.items);
    }
    assert.equal(items.length, first.total_count, 'Incomplete commit pagination.');
    return items;
  }
  const unique = new Map();
  for (const item of await window(start, end)) {
    assert.equal(item.repository?.private, false, 'Commit search must only return public repositories.');
    assert.equal(item.author?.login?.toLowerCase(), username.toLowerCase(), 'Unexpected commit author.');
    assert.match(item.sha, /^[a-f0-9]{40}$/i, 'Invalid commit identity.');
    const date = item.commit?.author?.date;
    const timestamp = Date.parse(date);
    assert(Number.isFinite(timestamp), 'Missing commit author timestamp.');
    if (timestamp >= dateMs(start) && timestamp <= now.getTime()) unique.set(item.sha, { sha: item.sha, date });
  }
  return [...unique.values()];
}

function codingRhythm(commits, timeZone = TIME_ZONE) {
  const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  const counts = { morning: 0, daytime: 0, evening: 0, night: 0 };
  for (const commit of commits) {
    const hour = Number(hourFormat.format(new Date(commit.date)));
    assert(Number.isInteger(hour) && hour >= 0 && hour < 24);
    counts[hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'daytime' : 'evening']++;
  }
  return { timeZone, total: commits.length, counts };
}

function replaceSection(readme, name, content) {
  const start = `<!--START_SECTION:${name}-->`;
  const end = `<!--END_SECTION:${name}-->`;
  assert.equal(readme.split(start).length, 2, `Expected one ${name} start marker.`);
  assert.equal(readme.split(end).length, 2, `Expected one ${name} end marker.`);
  const from = readme.indexOf(start) + start.length;
  const to = readme.indexOf(end);
  assert(to >= from, `Invalid ${name} marker order.`);
  return readme.slice(0, from) + '\n' + content + '\n' + readme.slice(to);
}

function updateReadme(readme, calendar, rhythm, updatedAt) {
  const labels = [['🌞 Morning', 'morning'], ['🌆 Daytime', 'daytime'], ['🌃 Evening', 'evening'], ['🌙 Night', 'night']];
  const rows = labels.map(([label, key]) => {
    const count = rhythm.counts[key];
    const percent = rhythm.total ? count / rhythm.total * 100 : 0;
    const bars = Math.round(percent / 5);
    return `${label.padEnd(22)}${`${count} commits`.padEnd(15)}${'█'.repeat(bars)}${'░'.repeat(20 - bars)} ${percent.toFixed(1).padStart(5)}%`;
  });
  const content = `**🦉 My Coding Rhythm**\n\n\`\`\`text\n${rows.join('\n')}\n\`\`\``;
  const updated = updatedAt.replace('T', ' ').slice(0, 16) + ' UTC';
  return replaceSection(replaceSection(readme, 'coding-rhythm', content), 'profile-updated',
    `<p align="center"><sub>Updated daily from GitHub · Last refreshed ${updated}</sub></p>`);
}

async function main() {
  const username = process.env.PROFILE_USERNAME || 'pljf';
  assert.match(username, /^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}$/, 'Invalid GitHub username.');
  assert(process.env.GITHUB_TOKEN, 'GITHUB_TOKEN is required. Run this through the Refresh profile workflow.');
  const now = new Date();
  const request = createClient(process.env.GITHUB_TOKEN);
  const calendar = await fetchCalendar(request, username, now);
  const repositories = await fetchRepositories(request, username);
  const commits = await fetchCommits(request, username, calendar.start, calendar.end, now);
  const rhythm = codingRhythm(commits);
  const { renderCards } = require('./render-cards.cjs');
  const cards = renderCards({ calendar, repositories });
  assert.equal(Object.keys(cards).length, 8, 'Expected eight themed chart assets.');
  const root = path.resolve(__dirname, '..');
  const readmeFile = path.join(root, 'README.md');
  const readme = updateReadme(await fs.readFile(readmeFile, 'utf8'), calendar, rhythm, now.toISOString());
  // Fetch and validate everything before touching the last successful output.
  for (const [filename, svg] of Object.entries(cards)) {
    assert.match(filename, /^reference-(contributions|streak|stats|activity)-(dark|light)\.svg$/);
    assert(!/<script\b|<foreignObject\b/.test(svg));
    await fs.writeFile(path.join(root, 'assets', filename), svg);
  }
  await fs.writeFile(readmeFile, readme);
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'profile.json'), JSON.stringify({
    updatedAt: now.toISOString(), calendar, repositories, rhythm,
  }, null, 2) + '\n');
  console.log(`Refreshed ${calendar.total} contributions, ${repositories.length} public repositories and ${rhythm.total} public commits (${TIME_ZONE}).`);
}

module.exports = { normalizeCalendar, fetchCalendar, fetchRepositories, fetchCommits, codingRhythm, replaceSection, updateReadme };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
