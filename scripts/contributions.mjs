import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const username = 'Alexsometimescode';
const query = `query { user(login: "${username}") { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date weekday contributionCount contributionLevel } } } } } }`;
const levelNames = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const escapeXml = value => String(value).replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]);

async function fetchCalendar() {
  // Credentials stay in process memory and are never written to generated files.
  const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], { encoding: 'utf8' }).trim();
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  return response.json();
}

function validateCalendar(response) {
  if (response.errors?.length) throw new Error('GitHub GraphQL query failed');
  const calendar = response.data?.user?.contributionsCollection?.contributionCalendar;
  if (!calendar || !Number.isInteger(calendar.totalContributions) || calendar.totalContributions < 0 || !Array.isArray(calendar.weeks) || calendar.weeks.length < 52 || calendar.weeks.length > 54) {
    throw new Error('Invalid contribution calendar');
  }
  let previous;
  for (const week of calendar.weeks) {
    if (!Array.isArray(week.contributionDays) || week.contributionDays.length < 1 || week.contributionDays.length > 7) throw new Error('Invalid calendar week');
    for (const day of week.contributionDays) {
      const time = Date.parse(`${day.date}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Number.isFinite(time) || (previous !== undefined && time - previous !== 86_400_000) || !Number.isInteger(day.weekday) || day.weekday !== new Date(time).getUTCDay() || !Number.isInteger(day.contributionCount) || day.contributionCount < 0 || !levelNames.includes(day.contributionLevel)) {
        throw new Error('Invalid contribution day');
      }
      previous = time;
    }
  }
  return calendar;
}

function render(calendar, dark) {
  const days = calendar.weeks.flatMap(week => week.contributionDays);
  const palette = dark ? ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'] : ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
  const foreground = dark ? '#e6edf3' : '#1f2328';
  const muted = dark ? '#9198a1' : '#59636e';
  const end = days.at(-1).date;
  const label = `${calendar.totalContributions.toLocaleString('en-US')} contributions in the last year`;
  const cells = calendar.weeks.flatMap((week, column) => week.contributionDays.map(day => {
    const x = 42 + column * 13;
    const y = 76 + day.weekday * 13;
    const delay = (column + day.weekday * 1.6) * 22;
    return `<rect class="day" x="${x}" y="${y}" width="10" height="10" rx="2" fill="${palette[levelNames.indexOf(day.contributionLevel)]}" style="transform-origin:${x + 5}px ${y + 5}px;animation-delay:${delay}ms"><title>${day.date}: ${day.contributionCount} contributions</title></rect>`;
  })).join('\n');
  let previousMonth;
  const months = calendar.weeks.map((week, column) => {
    const date = new Date(`${week.contributionDays[0].date}T00:00:00Z`);
    const month = date.getUTCMonth();
    if (month === previousMonth) return '';
    previousMonth = month;
    if (column > calendar.weeks.length - 3) return '';
    return { column, name: date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) };
  }).filter(Boolean).filter((month, index, labels) => !labels[index + 1] || labels[index + 1].column - month.column >= 3)
    .map(month => `<text x="${42 + month.column * 13}" y="66">${month.name}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="224" viewBox="0 0 760 224" role="img" aria-labelledby="title description">
<title id="title">${escapeXml(label)}</title>
<desc id="description">${username}'s GitHub contribution calendar from ${days[0].date} to ${end}. Each square represents one day. A brief diagonal wave reveals the real GitHub contribution levels.</desc>
<style>
text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: ${muted}; font-size: 10px; }
.heading { fill: ${foreground}; font-size: 19px; font-weight: 600; }
.day { transform-box: view-box; animation: arrive 560ms cubic-bezier(.2,.8,.2,1.2) both; }
@keyframes arrive { from { opacity: 0; transform: translateY(-5px) scale(.2); } to { opacity: 1; transform: translateY(0) scale(1); } }
@media (prefers-reduced-motion: reduce) { .day { animation: none; } }
</style>
<rect width="760" height="224" rx="12" fill="${dark ? '#0d1117' : '#ffffff'}"/>
<text class="heading" x="24" y="32">${escapeXml(label)}</text>
<text x="24" y="48">@${username}</text>
${months}
<text x="13" y="97">Mon</text><text x="13" y="123">Wed</text><text x="13" y="149">Fri</text>
${cells}
<text x="24" y="197">${days[0].date} to ${end}</text>
<text x="575" y="197">Less</text>
${palette.map((color, index) => `<rect x="${603 + index * 13}" y="188" width="10" height="10" rx="2" fill="${color}"/>`).join('')}
<text x="673" y="197">More</text>
</svg>\n`;
}

// A fixture enables repeatable offline verification without credentials.
const fixture = process.argv[2];
const calendar = validateCalendar(fixture ? JSON.parse(await readFile(fixture, 'utf8')) : await fetchCalendar());
await mkdir('assets', { recursive: true });
for (const dark of [false, true]) {
  await writeFile(`assets/contributions${dark ? '-dark' : ''}.svg`, render(calendar, dark));
}
console.log(`Generated calendar: ${calendar.totalContributions} contributions, ${calendar.weeks.flatMap(week => week.contributionDays).length} days`);
