#!/usr/bin/env python3
"""Measure the isolated Linux runner, including the app stack and browsers."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def memory():
    values = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines()}
    return values['MemTotal'], values['MemTotal'] - values['MemAvailable']


def swap():
    values = dict(line.split() for line in Path('/proc/vmstat').read_text().splitlines())
    return int(values['pswpin']) + int(values['pswpout'])


def cpu():
    values = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    return sum(values), values[3] + values[4]


started = time.monotonic()
swap_start = swap()
cpu_start = cpu()
total, peak = memory()
process = subprocess.Popen(sys.argv[1:])
while process.poll() is None:
    peak = max(peak, memory()[1])
    time.sleep(1)
cpu_end = cpu()
cpu_total = max(1, cpu_end[0] - cpu_start[0])
result = {
    'workers': int(os.environ.get('E2E_WORKERS', '2')),
    'seconds': round(time.monotonic() - started, 2), 'exitCode': process.returncode,
    'cpuCount': os.cpu_count(), 'totalMemoryBytes': total, 'peakUsedMemoryBytes': peak,
    'peakMemoryFraction': round(peak / total, 4),
    'cpuBusyFraction': round(1 - (cpu_end[1] - cpu_start[1]) / cpu_total, 4),
    'swapPages': swap() - swap_start,
}
output = Path('test-results/resource-usage.json')
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(result, indent=2) + '\n')
raise SystemExit(process.returncode)
