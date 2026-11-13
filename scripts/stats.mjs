// Genera la tarjeta de estadísticas del perfil (claro y oscuro) sin servicios externos.
// Usa tu token personal, así que cuenta también tus commits en repos privados de la organización.
// Uso: GH_TOKEN=... GH_USER=nelson-cz OUT=dist node scripts/stats.mjs
// Prueba local sin token: MOCK=datos.json node scripts/stats.mjs
import fs from 'node:fs';

const USER = process.env.GH_USER;
const OUT = process.env.OUT || 'dist';

const THEMES = {
  dark:  { bg: '#15112E', line: '#2F2860', ink: '#F3F0FF', muted: '#A49DCC', violet: '#B47BFF', cyan: '#3DE8EC', coral: '#FF6B8A', sun: '#FFD23F', extra: ['#6E62B8', '#4A4185'] },
  light: { bg: '#F4F1FF', line: '#DCD5F5', ink: '#1B1640', muted: '#5D5780', violet: '#7B2FF7', cyan: '#008EA6', coral: '#E0335A', sun: '#B98500', extra: ['#9A8FD6', '#C4BCEB'] },
};

const QUERY = `query($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
      commitContributionsByRepository(maxRepositories: 100) {
        contributions { totalCount }
        repository {
          nameWithOwner
          languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
            totalSize
            edges { size node { name } }
          }
        }
      }
    }
  }
}`;

async function load() {
  if (process.env.MOCK) return JSON.parse(fs.readFileSync(process.env.MOCK, 'utf8'));
  if (!process.env.GH_TOKEN || !USER) throw new Error('Faltan GH_TOKEN o GH_USER');
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 864e5);
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${process.env.GH_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
    body: JSON.stringify({ query: QUERY, variables: { login: USER, from: from.toISOString(), to: to.toISOString() } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data.user.contributionsCollection;
}

function streaks(days) {
  // días ordenados; hoy sin contribuciones no rompe la racha actual
  let longest = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  let current = 0;
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  for (; i >= 0 && days[i].contributionCount > 0; i--) current++;
  return { current, longest };
}

function languages(byRepo) {
  // cada repo aporta tantos "votos" como commits tuyos, repartidos según los bytes de cada lenguaje
  const acc = new Map();
  for (const r of byRepo) {
    const commits = r.contributions.totalCount;
    const { totalSize, edges } = r.repository.languages;
    if (!totalSize) continue;
    for (const e of edges) acc.set(e.node.name, (acc.get(e.node.name) || 0) + commits * (e.size / totalSize));
  }
  const total = [...acc.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  const sorted = [...acc].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 5).map(([name, v]) => ({ name, pct: (v / total) * 100 }));
  const rest = sorted.slice(5).reduce((a, [, v]) => a + v, 0);
  if (rest > 0) top.push({ name: 'Otros', pct: (rest / total) * 100 });
  return top;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => new Intl.NumberFormat('es-GT').format(Math.round(n));

function render(c, d) {
  const font = `font-family="-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"`;
  const cells = [
    [d.total, 'contribuciones', c.violet],
    [d.commits, 'commits', c.violet],
    [d.prs, 'pull requests', c.cyan],
    [d.repos, 'repositorios', c.cyan],
    [d.current, 'días de racha actual', c.coral],
    [d.longest, 'días de racha máxima', c.sun],
  ];
  const cellSvg = cells.map(([v, label, color], i) => {
    const x = 48 + (i % 3) * 200;
    const y = i < 3 ? 160 : 272;
    return `<text x="${x}" y="${y}" font-size="46" font-weight="800" fill="${color}">${fmt(v)}</text>
<text x="${x}" y="${y + 28}" font-size="16" fill="${c.muted}">${esc(label)}</text>`;
  }).join('\n');

  const palette = [c.violet, c.cyan, c.coral, c.sun, ...c.extra];
  let langSvg;
  if (!d.langs.length) {
    langSvg = `<text x="708" y="140" font-size="16" fill="${c.muted}">Sin commits en el último año</text>`;
  } else {
    let x = 708;
    const bar = d.langs.map((l, i) => {
      const w = (l.pct / 100) * 444;
      const r = `<rect x="${x.toFixed(1)}" y="104" width="${Math.max(w, 0).toFixed(1)}" height="16" fill="${palette[i]}"/>`;
      x += w;
      return r;
    }).join('');
    const list = d.langs.map((l, i) => {
      const cx = 708 + (i % 2) * 236;
      const cy = 168 + Math.floor(i / 2) * 46;
      return `<circle cx="${cx + 6}" cy="${cy - 6}" r="6" fill="${palette[i]}"/>
<text x="${cx + 22}" y="${cy}" font-size="17" fill="${c.ink}">${esc(l.name)}</text>
<text x="${cx + 208}" y="${cy}" font-size="17" fill="${c.muted}" text-anchor="end">${l.pct.toFixed(1)}%</text>`;
    }).join('\n');
    langSvg = `<clipPath id="bar"><rect x="708" y="104" width="444" height="16" rx="8"/></clipPath>
<g clip-path="url(#bar)">${bar}</g>
${list}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360" role="img" aria-label="Últimos 12 meses: ${fmt(d.total)} contribuciones, ${fmt(d.commits)} commits, ${fmt(d.prs)} pull requests, ${fmt(d.repos)} repositorios, racha actual de ${d.current} días.">
<rect x="1" y="1" width="1198" height="358" rx="28" fill="${c.bg}" stroke="${c.line}" stroke-width="2"/>
<g ${font}>
<text x="48" y="70" font-size="24" font-weight="700" fill="${c.ink}">Últimos 12 meses</text>
${cellSvg}
<line x1="664" y1="44" x2="664" y2="316" stroke="${c.line}" stroke-width="2"/>
<text x="708" y="70" font-size="24" font-weight="700" fill="${c.ink}">Lenguajes por commits</text>
${langSvg}
<text x="1152" y="332" font-size="13" fill="${c.muted}" text-anchor="end">Incluye repositorios privados · actualizado ${esc(d.updated)}</text>
</g>
</svg>`;
}

const cc = await load();
const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays).sort((a, b) => a.date.localeCompare(b.date));
const data = {
  total: cc.contributionCalendar.totalContributions,
  commits: cc.totalCommitContributions,
  prs: cc.totalPullRequestContributions,
  repos: cc.commitContributionsByRepository.length,
  ...streaks(days),
  langs: languages(cc.commitContributionsByRepository),
  updated: new Intl.DateTimeFormat('es-GT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guatemala' }).format(new Date()),
};
fs.mkdirSync(OUT, { recursive: true });
for (const [mode, c] of Object.entries(THEMES)) fs.writeFileSync(`${OUT}/stats-${mode}.svg`, render(c, data));
console.log('Tarjetas generadas:', JSON.stringify({ ...data, langs: data.langs.map((l) => `${l.name} ${l.pct.toFixed(1)}%`) }));
