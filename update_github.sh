#!/bin/bash
cd /opt/openclaw/.openclaw/workspace/dashboard-abt
python3 update_github.py >> /tmp/dashboard-update.log 2>&1
