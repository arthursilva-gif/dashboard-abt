#!/usr/bin/env python3
"""Fetch fresh Jira data, update EMBEDDED_DATA in index.html, push to GitHub."""
import json, re, base64, urllib.request, urllib.error, subprocess, os, sys

# Load .env if present
_env_file = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(_env_file):
    for _line in open(_env_file):
        _k, _, _v = _line.strip().partition("=")
        if _k and not _k.startswith("#"):
            os.environ.setdefault(_k, _v)

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
REPO = "arthursilva-gif/dashboard-abt"
FILE_PATH = "index.html"
LOCAL_HTML = os.path.join(os.path.dirname(__file__), "public", "index.html")
API_URL = "http://localhost:9090/api/data?refresh=1"
MAJORS_API_URL = "http://localhost:9090/api/majors?refresh=1"

def gh_request(method, path, data=None):
    req = urllib.request.Request(
        f"https://api.github.com{path}",
        data=json.dumps(data).encode() if data else None,
        method=method,
        headers={
            "Authorization": f"token {GITHUB_TOKEN}",
            "Content-Type": "application/json",
            "User-Agent": "kant-agent"
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read()), resp.headers

def fetch_jira():
    req = urllib.request.Request(API_URL, headers={"User-Agent": "kant-agent"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

def fetch_majors():
    req = urllib.request.Request(MAJORS_API_URL, headers={"User-Agent": "kant-agent"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

def update_html(fresh_data, majors_data):
    html = open(LOCAL_HTML).read()
    new_json = json.dumps(fresh_data, ensure_ascii=False, separators=(',', ':'))
    new_html = re.sub(r'const EMBEDDED_DATA = \{.*?\};', f'const EMBEDDED_DATA = {new_json};', html, flags=re.DOTALL)
    if new_html == html:
        print("ERROR: EMBEDDED_DATA pattern not found in HTML")
        sys.exit(1)
    majors_json = json.dumps(majors_data, ensure_ascii=False, separators=(',', ':'))
    new_html2 = re.sub(r'const EMBEDDED_MAJORS = \{.*?\};', f'const EMBEDDED_MAJORS = {majors_json};', new_html, flags=re.DOTALL)
    if new_html2 == new_html:
        print("ERROR: EMBEDDED_MAJORS pattern not found in HTML")
        sys.exit(1)
    open(LOCAL_HTML, 'w').write(new_html2)
    return new_html2

def push_to_github(html_content):
    # Get current SHA
    file_info, _ = gh_request("GET", f"/repos/{REPO}/contents/{FILE_PATH}")
    sha = file_info["sha"]
    content_b64 = base64.b64encode(html_content.encode()).decode()
    fetched_at = json.loads(re.search(r'"fetchedAt":"([^"]+)"', html_content).group(0)[1:-1].split(':',1)[1] if False else '""') 
    # simpler:
    import datetime
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")
    result, _ = gh_request("PUT", f"/repos/{REPO}/contents/{FILE_PATH}", {
        "message": f"auto: atualiza dados {ts}",
        "content": content_b64,
        "sha": sha
    })
    return result["commit"]["sha"]

if __name__ == "__main__":
    print("Fetching Jira data...")
    data = fetch_jira()
    print(f"Got {len(data['issues'])} issues, fetchedAt: {data['fetchedAt']}")
    print("Fetching Majors data...")
    majors_data = fetch_majors()
    print(f"Got {majors_data['total']} majors, fetchedAt: {majors_data['fetchedAt']}")
    print("Updating HTML...")
    new_html = update_html(data, majors_data)
    print("Pushing to GitHub...")
    commit_sha = push_to_github(new_html)
    print(f"Done! Commit: {commit_sha}")
