import json, ast, sys

with open('/tmp/mcp_text.txt', 'r') as f:
    text = f.read()

try:
    issues = ast.literal_eval(text)
    print(json.dumps(issues, ensure_ascii=False, default=str))
except Exception as e:
    print('[]', file=sys.stderr)
    print('[]')
