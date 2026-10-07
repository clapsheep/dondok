import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'e2e/ci/summarize-benchmark.py'


class BenchmarkSummaryTest(unittest.TestCase):
    def summary(self, missing=False, failure=False, memory=.5, swap=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for workers in (1, 2, 3):
                for repeat in (1, 2, 3):
                    if missing and workers == 3 and repeat == 3:
                        continue
                    file = root / f'w{workers}-r{repeat}' / 'resource-usage.json'
                    file.parent.mkdir()
                    file.write_text(json.dumps(dict(workers=workers, seconds=120/workers,
                        exitCode=1 if failure and workers == 2 else 0,
                        peakMemoryFraction=memory, swapPages=swap)))
            return subprocess.run([sys.executable, str(SCRIPT), str(root)], capture_output=True, text=True)

    def test_compares_three_clean_runs_per_worker_count(self):
        result = self.summary()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('1→2 reduction: 50.0%', result.stdout)

    def test_missing_failed_or_over_budget_runs_do_not_qualify(self):
        for options in [dict(missing=True), dict(failure=True), dict(memory=.81), dict(swap=1)]:
            with self.subTest(options=options):
                result = self.summary(**options)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Not enough clean runs', result.stdout)
