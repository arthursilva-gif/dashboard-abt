const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 9090;
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || '1941a9de63ca6c3fa414560414bb4fefc81b147144d40d9ae0e24fce4eea4c11';
const CACHE_FILE = '/tmp/jira_cache.json';
const MAJORS_CACHE_FILE = '/tmp/jira_majors_cache.json';
const CACHE_TTL = 5 * 60 * 1000;

function callMCPPage(jql) {
  const fields = 'key,summary,status,assignee,priority,issuetype,created,updated';
  const args = { jql, max_results: 100, fields };
  const payload = JSON.stringify({ tool: 'jira__jira_search_issues', arguments: args });
  fs.writeFileSync('/tmp/mcp_payload.json', payload);
  const res = execSync(
    `curl -s 'https://kant-proxy.staradm.com/proxy/mcp/call' \
     -H 'X-Gateway-Token: ${TOKEN}' \
     -H 'Content-Type: application/json' \
     -d @/tmp/mcp_payload.json`,
    { timeout: 30000 }
  );
  const d = JSON.parse(res.toString());
  const text = d?.result?.content?.[0]?.text || '[]';
  fs.writeFileSync('/tmp/mcp_text.txt', text);
  const pyRes = execSync(
    'python3 /opt/openclaw/.openclaw/workspace/dashboard-abt/parse_issues.py',
    { timeout: 10000 }
  );
  return JSON.parse(pyRes.toString());
}

function inferCategory(summary) {
  const s = (summary || '').toLowerCase();
  if (/login|senha|conta|cadastro|acesso|bloqueio|verifica|closed|encerr/.test(s)) return 'Login / Conta / Cadastro';
  if (/b.nus|bonus|promo|cashback|free|giro|rodada|cr.dit|credit|premia/.test(s)) return 'Bônus / Promoção / Cashback';
  if (/saque|devolu|estorno|reembolso/.test(s)) return 'Saque / Devolução';
  if (/dep.sito|deposito|pagamento|pix|boleto|transa/.test(s)) return 'Depósito / Pagamento';
  if (/jogo|aposta|slot|cassino|casino|sport|esporte|odd|resultado/.test(s)) return 'Jogos / Apostas';
  if (/kyc|document|identidade|cpf|comprovante|compliance/.test(s)) return 'KYC / Conformidade';
  if (/informe|imposto|declara|renda/.test(s)) return 'Fiscal / IR';
  if (/reclame|reclama/.test(s)) return 'Reclame Aqui';
  return 'Outros';
}

function inferTimeInterno(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('major')) return 'Major';
  if (s.includes('fornecedor')) return 'Fornecedor';
  if (s.includes('interno')) return 'Time Interno';
  if (s.includes('n3') || s.includes('n2')) return 'Suporte N2/N3';
  if (s.includes('aprovação') || s.includes('aprovacao')) return 'Aprovação';
  if (s.includes('creditação') || s.includes('creditacao')) return 'Creditação';
  if (s.includes('desenvolvimento')) return 'Desenvolvimento';
  if (s.includes('jogador')) return 'Aguard. Jogador';
  return 'Outros';
}

function fetchAllIssues() {
  const allIssues = [];
  let lastKey = null;
  let page = 1;

  while (true) {
    const jql = lastKey
      ? `filter=19623 AND key > ${lastKey} ORDER BY key ASC`
      : 'filter=19623 ORDER BY key ASC';
    const issues = callMCPPage(jql);
    console.log(`Page ${page}: ${issues.length} issues`);
    allIssues.push(...issues);
    if (issues.length < 100) break;
    lastKey = issues[issues.length - 1].key;
    page++;
  }
  return allIssues;
}

function buildDataset(issues) {
  return issues.map(i => ({
    key: i.key,
    summary: i.summary,
    status: i.status || 'Sem Status',
    assignee: i.assignee || 'Não atribuído',
    priority: i.priority || 'Sem Priority',
    issuetype: i.issuetype || 'Sem Tipo',
    created: i.created,
    updated: i.updated,
    category: inferCategory(i.summary),
    timeInterno: inferTimeInterno(i.status),
  }));
}

function fetchMajors() {
  const jql = 'filter=21187 ORDER BY key ASC';
  const issues = callMCPPage(jql);
  const dataset = buildDataset(issues);
  return { issues: dataset, fetchedAt: new Date().toISOString(), total: dataset.length };
}

let cache = null;
let cacheTime = 0;
let majorsCache = null;
let majorsCacheTime = 0;

function getMajorsData(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && majorsCache && (now - majorsCacheTime) < CACHE_TTL) return majorsCache;

  if (!forceRefresh && fs.existsSync(MAJORS_CACHE_FILE)) {
    try {
      const disk = JSON.parse(fs.readFileSync(MAJORS_CACHE_FILE, 'utf8'));
      if (now - disk.time < CACHE_TTL) {
        majorsCache = disk.data; majorsCacheTime = disk.time;
        return majorsCache;
      }
    } catch(e) {}
  }

  console.log('Fetching fresh Jira majors data...');
  const data = fetchMajors();
  majorsCache = data;
  majorsCacheTime = now;
  fs.writeFileSync(MAJORS_CACHE_FILE, JSON.stringify({ time: now, data }));
  console.log(`Done: ${data.total} majors cached.`);
  return majorsCache;
}

function getData(forceRefresh) {
  const now = Date.now();
  if (!forceRefresh && cache && (now - cacheTime) < CACHE_TTL) return cache;

  if (!forceRefresh && fs.existsSync(CACHE_FILE)) {
    try {
      const disk = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (now - disk.time < CACHE_TTL) {
        cache = disk.data; cacheTime = disk.time;
        return cache;
      }
    } catch(e) {}
  }

  console.log('Fetching fresh Jira data...');
  const issues = fetchAllIssues();
  const dataset = buildDataset(issues);
  cache = { issues: dataset, fetchedAt: new Date().toISOString(), total: dataset.length };
  cacheTime = now;
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ time: now, data: cache }));
  console.log(`Done: ${dataset.length} issues cached.`);
  return cache;
}

const MIMES = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
const PUBLIC = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url.startsWith('/api/majors')) {
    const refresh = req.url.includes('refresh=1');
    if (refresh) {
      majorsCache = null;
      majorsCacheTime = 0;
      if (fs.existsSync(MAJORS_CACHE_FILE)) fs.unlinkSync(MAJORS_CACHE_FILE);
    }
    try {
      const data = getMajorsData(refresh);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.url.startsWith('/api/data')) {
    const refresh = req.url.includes('refresh=1');
    if (refresh) {
      cache = null;
      cacheTime = 0;
      if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    }
    try {
      const data = getData(refresh);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      console.error(e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  const filePath = path.join(PUBLIC, req.url === '/' ? 'index.html' : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    const headers = { 'Content-Type': MIMES[ext] || 'text/plain' };
    if (ext === '.html') {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
      headers['Pragma'] = 'no-cache';
      headers['Expires'] = '0';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard ABT running on :${PORT}`);
  try { getData(); } catch(e) { console.error('Pre-warm failed:', e.message); }
});
