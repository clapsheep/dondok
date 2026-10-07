#!/usr/bin/env python3
import json
from pathlib import Path
import statistics
import sys

root = Path(sys.argv[1])
groups = {workers: [] for workers in (1, 2, 3)}
for path in root.rglob('resource-usage.json'):
    value = json.loads(path.read_text())
    groups[value['workers']].append(value)
print('| Workers | Runs | Median seconds | Peak RAM | Swap pages | Failures |')
print('|---|---|---|---|---|---|')
medians = {}
valid = True
for workers, values in groups.items():
    if not values:
        valid = False
        print(f'| {workers} | 0 | missing | — | — | missing |')
        continue
    medians[workers] = statistics.median(value['seconds'] for value in values)
    failures = sum(value['exitCode'] != 0 for value in values)
    peak = max(value['peakMemoryFraction'] for value in values)
    swap = sum(value['swapPages'] for value in values)
    valid &= len(values) == 3 and failures == 0 and peak <= .8 and swap == 0
    print(f'| {workers} | {len(values)} | {medians[workers]:.1f} | {peak:.1%} | {swap} | {failures} |')
if valid:
    print(f'\n1→2 reduction: {1 - medians[2] / medians[1]:.1%}; 2→3 reduction: {1 - medians[3] / medians[2]:.1%}.')
    print('Review test reports and shard imbalance before changing the worker setting.')
else:
    print('\nNot enough clean runs within the resource budget to select a worker count.')
    raise SystemExit(1)
