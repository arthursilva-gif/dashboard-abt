import subprocess, json, ast, sys

TOKEN = "1941a9de63ca6c3fa414560414bb4fefc81b147144d40d9ae0e24fce4eea4c11"

def fetch_page(jql):
    payload = json.dumps({
        "tool": "jira__jira_search_issues",
        "arguments": {
            "jql": jql,
            "max_results": 100,
            "fields": "key,summary,status,assignee,priority,issuetype,created,updated"
        }
    })
    result = subprocess.run([
        "curl", "-s", "https://kant-proxy.staradm.com/proxy/mcp/call",
        "-H", f"X-Gateway-Token: {TOKEN}",
        "-H", "Content-Type: application/json",
        "-d", payload
    ], capture_output=True, text=True, timeout=30)
    d = json.loads(result.stdout)
    text = d["result"]["content"][0]["text"]
    return ast.literal_eval(text)

def infer_category(summary):
    s = (summary or "").lower()
    if any(x in s for x in ["login","senha","conta","cadastro","acesso","bloqueio","verifica","closed","encerr"]): return "Login / Conta / Cadastro"
    if any(x in s for x in ["bônus","bonus","promoç","promoc","cashback","free","giro","rodada","crédit","credit","premia"]): return "Bônus / Promoção / Cashback"
    if any(x in s for x in ["saque","devolu","estorno","reembolso"]): return "Saque / Devolução"
    if any(x in s for x in ["depósito","deposito","pagamento","pix","boleto","transa"]): return "Depósito / Pagamento"
    if any(x in s for x in ["jogo","aposta","slot","cassino","casino","sport","esporte","odd","resultado"]): return "Jogos / Apostas"
    if any(x in s for x in ["kyc","document","identidade","cpf","comprovante","compliance"]): return "KYC / Conformidade"
    if any(x in s for x in ["informe","imposto","declara","renda"]): return "Fiscal / IR"
    if any(x in s for x in ["reclame","reclama"]): return "Reclame Aqui"
    return "Outros"

def infer_time_interno(status):
    s = (status or "").lower()
    if "major" in s: return "Major"
    if "fornecedor" in s: return "Fornecedor"
    if "interno" in s: return "Time Interno"
    if "n3" in s or "n2" in s: return "Suporte N2/N3"
    if "aprovação" in s or "aprovacao" in s: return "Aprovação"
    if "creditação" in s or "creditacao" in s: return "Creditação"
    if "desenvolvimento" in s: return "Desenvolvimento"
    if "jogador" in s: return "Aguard. Jogador"
    return "Outros"

all_issues = []
last_key = None
page = 1

while True:
    if last_key:
        jql = f"filter=19623 AND key > {last_key} ORDER BY key ASC"
    else:
        jql = "filter=19623 ORDER BY key ASC"
    
    issues = fetch_page(jql)
    print(f"Page {page}: {len(issues)}", file=sys.stderr)
    all_issues.extend(issues)
    
    if len(issues) < 100:
        break
    
    last_key = issues[-1]["key"]
    page += 1

RESOLVED_STATUSES = {"resolvido n3", "resolvido", "fechado", "done", "resolved", "closed"}

def is_resolved(status):
    return (status or "").lower() in RESOLVED_STATUSES

def is_open(status):
    return not is_resolved(status)

dataset = [{
    "key": i["key"],
    "summary": i.get("summary",""),
    "status": i.get("status","Sem Status"),
    "assignee": i.get("assignee","Não atribuído"),
    "priority": i.get("priority","Sem Priority"),
    "issuetype": i.get("issuetype","Sem Tipo"),
    "created": i.get("created"),
    "updated": i.get("updated"),
    "resolved": is_resolved(i.get("status","")),
    "resolvedAt": i.get("updated") if is_resolved(i.get("status","")) else None,
    "category": infer_category(i.get("summary","")),
    "timeInterno": infer_time_interno(i.get("status",""))
} for i in all_issues]

import datetime
output = {
    "issues": dataset,
    "fetchedAt": datetime.datetime.utcnow().isoformat() + "Z",
    "total": len(dataset)
}

print(json.dumps(output, ensure_ascii=False))
