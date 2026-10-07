import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release_manifest', Path(__file__).resolve().parents[1] / 'release_manifest.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = 'a' * 40


def manifest():
    return dict(schemaVersion=1, repository=release.REPOSITORY, revision=SHA, runId=42,
                runAttempt=2, platform='linux/arm64', images={
                    service: f'ghcr.io/{release.REPOSITORY}-{service}@sha256:' + 'b' * 64
                    for service in ('backend', 'frontend')})


def run(**overrides):
    value = dict(id=42, run_attempt=2, head_sha=SHA, event='push', head_branch='main',
                 path='.github/workflows/ci.yml', repository={'full_name': release.REPOSITORY},
                 status='completed', conclusion='success')
    return value | overrides


class ReleaseManifestTest(unittest.TestCase):
    def test_requires_exact_revision_attempt_and_platform(self):
        self.assertEqual(release.validate(manifest(), SHA, 42, 2), manifest())
        for key, value in [('revision', 'c' * 40), ('runAttempt', 1), ('runId', 43), ('platform', 'linux/amd64'), ('repository', 'example/untrusted')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate(manifest() | {key: value}, SHA, 42, 2)

    def test_tags_wrong_registries_missing_services_and_shell_text_are_rejected(self):
        for image in ['ghcr.io/clapsheep/dondok-backend:latest', 'example.test/image@sha256:' + 'b' * 64, '$(touch /tmp/example)']:
            value = manifest()
            value['images']['backend'] = image
            with self.assertRaises(ValueError):
                release.validate(value, SHA, 42, 2)
        value = manifest()
        del value['images']['frontend']
        with self.assertRaises(ValueError):
            release.validate(value, SHA, 42, 2)

    def test_failed_latest_run_does_not_fall_back_to_older_success(self):
        with patch.object(release, 'gh_json', side_effect=[{'sha': SHA}, {'workflow_runs': [run(), run(id=43, conclusion='failure')]}]), patch.object(release.subprocess, 'run') as download:
            with self.assertRaises(ValueError):
                release.fetch(SHA, '/unused')
            download.assert_not_called()

    def test_pr_and_benchmark_cannot_authorize_release(self):
        for event in ('pull_request', 'workflow_dispatch'):
            with self.subTest(event=event), patch.object(release, 'gh_json', side_effect=[{'sha': SHA}, {'workflow_runs': [run(event=event)]}]):
                with self.assertRaises(ValueError):
                    release.fetch(SHA, '/unused')

    def test_only_successful_main_artifact_is_accepted_and_saved_privately(self):
        def download(args, **kwargs):
            self.assertIn('release-manifest-2', args)
            (Path(args[-1]) / 'release.json').write_text(json.dumps(manifest()))
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'release.json'
            responses = [{'sha': SHA}, {'workflow_runs': [run()]}, run(), {'sha': SHA}]
            with patch.object(release, 'gh_json', side_effect=responses), patch.object(release.subprocess, 'run', side_effect=download):
                release.fetch(SHA, output)
            self.assertEqual(json.loads(output.read_text()), manifest())
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)

    def test_new_main_or_rerun_during_download_invalidates_approval(self):
        def download(args, **kwargs):
            (Path(args[-1]) / 'release.json').write_text(json.dumps(manifest()))
        for changed in (run(run_attempt=3), run(status='in_progress', conclusion=None)):
            with patch.object(release, 'gh_json', side_effect=[{'sha': SHA}, {'workflow_runs': [run()]}, changed]), patch.object(release.subprocess, 'run', side_effect=download):
                with self.assertRaises(ValueError):
                    release.fetch(SHA, '/unused')
        with patch.object(release, 'gh_json', side_effect=[{'sha': SHA}, {'workflow_runs': [run()]}, run(), {'sha': 'c' * 40}]), patch.object(release.subprocess, 'run', side_effect=download):
            with self.assertRaises(ValueError):
                release.fetch(SHA, '/unused')
