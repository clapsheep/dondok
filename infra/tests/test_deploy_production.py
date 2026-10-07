"""Exercise release orchestration with fake Git/Docker; no host services are used."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy-production.sh'
NEW = 'a' * 40
OLD = 'b' * 40
IMAGE_ID = 'sha256:' + 'c' * 64
MOCK = r'''
import json, os, pathlib, sys
kind, *args = sys.argv[1:]
with open(os.environ['CALLS'], 'a') as log:
    log.write(json.dumps([kind, args, os.environ.get('DONDOK_BACKEND_IMAGE', '')]) + '\n')
if kind == 'git':
    directory = pathlib.Path(args[1]); args = args[2:]
    if args[:2] == ['rev-parse', 'HEAD']:
        print(os.environ['NEW'] if directory.name == 'source' else (directory / 'head').read_text())
    elif args[:2] == ['rev-parse', 'origin/main']:
        print('d' * 40 if os.environ['MODE'] == 'new-main' else os.environ['NEW'])
    elif args[:3] == ['remote', 'get-url', 'origin']:
        print('https://github.com/clapsheep/dondok.git')
    elif args[:2] == ['checkout', '--detach']:
        (directory / 'head').write_text(args[2])
elif kind == 'docker':
    if args[:2] == ['image', 'inspect'] and '--format' in args:
        template = args[args.index('--format') + 1]
        if 'Architecture' in template:
            print('linux/amd64' if os.environ['MODE'] == 'wrong-platform' else 'linux/arm64')
        elif 'revision' in template:
            print(os.environ['OLD'] if os.environ['MODE'] == 'wrong-label' else os.environ['NEW'])
    elif args and args[0] == 'inspect':
        print(os.environ['IMAGE_ID'])
    elif args and args[0] == 'compose':
        if 'ps' in args and args[-1] in ('backend', 'frontend'):
            print('old-' + args[-1])
        if 'up' in args and os.environ['MODE'] == 'unhealthy' and os.environ.get('DONDOK_BACKEND_IMAGE', '').startswith('ghcr.io/'):
            sys.exit(17)
'''
FUNCTIONS = r'''
function git() { "$REAL_PYTHON" "$MOCK" git "$@"; }
function docker() { "$REAL_PYTHON" "$MOCK" docker "$@"; }
function gh() { return 99; }
function python3() {
  if [[ "$1" == */release_manifest.py ]]; then
    if [[ "$MODE" == missing-approval ]]; then return 1; fi
    printf '%s\n' "$MANIFEST" > "${6}"
  else
    "$REAL_PYTHON" "$@"
  fi
}
export -f git docker gh python3
exec bash "$@"
'''


class DeployProductionTest(unittest.TestCase):
    def exercise(self, mode):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            for name in ('source/.git', 'deploy/.git', 'backups', 'state'):
                (root / name).mkdir(parents=True, mode=0o700)
            (root / 'deploy/head').write_text(OLD)
            (root / 'deploy/compose.yaml').touch()
            (root / 'deploy/compose.prod.yaml').touch()
            env_file = root / 'example.env'
            env_file.write_text('POSTGRES_PASSWORD=example_test_only\n')
            env_file.chmod(0o600)
            mock = root / 'mock.py'
            mock.write_text(MOCK)
            calls = root / 'calls.jsonl'
            manifest = {'images': {service: f'ghcr.io/clapsheep/dondok-{service}@sha256:' + 'e' * 64 for service in ('backend', 'frontend')}}
            env = os.environ | dict(REAL_PYTHON=sys.executable, MOCK=str(mock), CALLS=str(calls),
                                    NEW=NEW, OLD=OLD, IMAGE_ID=IMAGE_ID, MODE=mode, MANIFEST=json.dumps(manifest))
            args = ['bash', '-c', FUNCTIONS, 'test', str(SCRIPT), '--source-dir', str(root / 'source'),
                    '--deploy-dir', str(root / 'deploy'), '--env-file', str(env_file),
                    '--backup-dir', str(root / 'backups'), '--state-dir', str(root / 'state'), '--revision', NEW]
            result = subprocess.run(args, env=env, capture_output=True, text=True)
            log = [json.loads(line) for line in calls.read_text().splitlines()]
            revision_file = root / 'state/current-revision'
            revision = revision_file.read_text().strip() if revision_file.exists() else None
            self.assertFalse((root / 'state/deploy.lock').exists())
            self.assertEqual(list((root / 'state').glob('.release.*')), [])
            return result, log, revision, (root / 'deploy/head').read_text()

    def test_success_uses_digest_without_building_and_records_revision(self):
        result, log, revision, head = self.exercise('success')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((revision, head), (NEW, NEW))
        self.assertFalse(any('build' in args for kind, args, _ in log if kind == 'docker'))
        pulls = [args for kind, args, _ in log if kind == 'docker' and args[0] == 'pull']
        self.assertEqual(len(pulls), 2)
        self.assertTrue(all('--platform' in args and '@sha256:' in args[-1] for args in pulls))

    def test_invalid_approval_or_image_cannot_replace_running_app(self):
        for mode in ('missing-approval', 'wrong-platform', 'wrong-label', 'new-main'):
            with self.subTest(mode=mode):
                result, log, revision, head = self.exercise(mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((revision, head), (None, OLD))
                self.assertFalse(any('up' in args for kind, args, _ in log if kind == 'docker'))

    def test_failed_health_uses_actual_previous_image_ids_and_preserves_state(self):
        result, log, revision, head = self.exercise('unhealthy')
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual((revision, head), (None, OLD))
        starts = [image for kind, args, image in log if kind == 'docker' and 'up' in args]
        self.assertEqual(len(starts), 2)
        self.assertEqual(starts[-1], IMAGE_ID)
