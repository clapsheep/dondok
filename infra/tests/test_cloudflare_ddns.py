import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("cloudflare_ddns", Path(__file__).parents[1] / "cloudflare_ddns.py")
ddns = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ddns)
CONFIG = {"zone_id": "a" * 32, "record_name": "money.example.com", "api_token": "test-only-token-not-a-real-credential"}
RECORD = {"id": "b" * 32, "type": "A", "name": CONFIG["record_name"],
          "content": "8.8.8.8", "proxied": False, "ttl": 300, "comment": "keep"}


class CloudflareDdnsTest(unittest.TestCase):
    def simulate(self, ip="9.9.9.9", records=None, patch_result=None):
        calls = []

        def fetch(url, token=None, payload=None):
            calls.append((url, token, payload))
            if token is None:
                return ip
            if payload is None:
                return json.dumps({"success": True, "result": [RECORD] if records is None else records})
            return json.dumps({"success": True, "result": patch_result if patch_result is not None
                               else dict(RECORD, content=ip)})

        return calls, patch.object(ddns, "fetch", side_effect=fetch)

    def test_changed_ip_patches_only_content(self):
        calls, mocked = self.simulate()
        with mocked:
            self.assertEqual(ddns.update(CONFIG), "updated")
        self.assertEqual(calls[-1][2], {"content": "9.9.9.9"})
        self.assertTrue(calls[-1][0].endswith("/dns_records/" + RECORD["id"]))
        self.assertIn("type=A&name=money.example.com", calls[1][0])

    def test_unchanged_ip_does_not_write(self):
        calls, mocked = self.simulate(ip=RECORD["content"])
        with mocked:
            self.assertEqual(ddns.update(CONFIG), "unchanged")
        self.assertEqual(len(calls), 2)

    def test_install_proves_write_permission_even_when_ip_matches(self):
        calls, mocked = self.simulate(ip=RECORD["content"])
        with mocked:
            self.assertEqual(ddns.update(CONFIG, force=True), "updated")
        self.assertEqual(calls[-1][2], {"content": RECORD["content"]})

    def test_missing_duplicate_or_wrong_record_refused_without_write(self):
        for records in ([], [RECORD, RECORD], [dict(RECORD, type="CNAME")],
                        [dict(RECORD, name="other.example.com")], [dict(RECORD, id="../wrong")]):
            with self.subTest(records=records):
                calls, mocked = self.simulate(records=records)
                with mocked, self.assertRaises(ddns.SetupError):
                    ddns.update(CONFIG)
                self.assertTrue(all(payload is None for _, _, payload in calls))

    def test_invalid_nonpublic_and_ipv6_addresses_refused_before_api(self):
        for ip in ("bad response", "192.168.1.1", "100.64.0.1", "127.0.0.1", "224.0.0.1", "::1"):
            with self.subTest(ip=ip):
                calls, mocked = self.simulate(ip=ip)
                with mocked, self.assertRaises((ValueError, ddns.SetupError)):
                    ddns.update(CONFIG)
                self.assertEqual(len(calls), 1)

    def test_unconfirmed_update_not_reported_as_success(self):
        _, mocked = self.simulate(patch_result=RECORD)
        with mocked, self.assertRaises(ddns.SetupError):
            ddns.update(CONFIG)

    def test_api_error_body_is_not_echoed(self):
        with patch.object(ddns, "fetch", return_value=json.dumps({"success": False, "errors": [CONFIG["api_token"]]})):
            with self.assertRaises(ddns.SetupError) as error:
                ddns.api(CONFIG, "/dns_records")
        self.assertNotIn(CONFIG["api_token"], str(error.exception))

    def test_curl_credentials_on_stdin_and_no_redirect_or_verbose_config(self):
        with patch.object(ddns.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "{}", "")) as run:
            ddns.fetch(ddns.API, CONFIG["api_token"], {"content": "9.9.9.9"})
        args, kwargs = run.call_args
        self.assertNotIn(CONFIG["api_token"], " ".join(args[0]))
        self.assertIn(CONFIG["api_token"], kwargs["input"])
        self.assertEqual(args[0][:2], ["/usr/bin/curl", "-q"])
        self.assertNotIn("--location", args[0])
        self.assertIn('request = "PATCH"', kwargs["input"])

    def test_http_error_and_timeout_do_not_leak_secrets(self):
        with patch.object(ddns.subprocess, "run", return_value=subprocess.CompletedProcess([], 22, CONFIG["api_token"], CONFIG["api_token"])):
            with self.assertRaises(ddns.SetupError) as error:
                ddns.fetch(ddns.API, CONFIG["api_token"])
        self.assertNotIn(CONFIG["api_token"], str(error.exception))
        with patch.object(ddns.sys, "argv", ["ddns", "update"]), \
             patch.object(ddns, "read_config", return_value=CONFIG), \
             patch.object(ddns, "update", side_effect=subprocess.TimeoutExpired(CONFIG["api_token"], 35)), \
             contextlib.redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(ddns.main(), 1)
        self.assertNotIn(CONFIG["api_token"], errors.getvalue())

    def test_config_permissions_and_symlinks(self):
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "config.json"
            ddns.write_private(config, json.dumps(CONFIG).encode())
            self.assertEqual(ddns.read_config(config), CONFIG)
            config.chmod(0o640)
            with self.assertRaises(ddns.SetupError):
                ddns.read_config(config)
            config.chmod(0o600)
            linked = Path(root) / "linked.json"
            linked.symlink_to(config)
            with self.assertRaises(OSError):
                ddns.read_config(linked)

    def test_header_injection_and_invalid_zone_rejected(self):
        for config in (dict(CONFIG, api_token=CONFIG["api_token"] + "\nheader=x"),
                       dict(CONFIG, zone_id="../invalid"), dict(CONFIG, record_name="bad/name.example.com")):
            with self.assertRaises(ddns.SetupError):
                ddns.validate(config)

    def test_logs_exclude_hostname_ip_and_token(self):
        with contextlib.redirect_stdout(io.StringIO()) as output:
            ddns.report("updated")
        for private in (CONFIG["record_name"], CONFIG["api_token"], RECORD["content"]):
            self.assertNotIn(private, output.getvalue())

    def test_install_copies_runtime_and_schedules_without_stopping_duckdns(self):
        with tempfile.TemporaryDirectory() as root, \
             patch.object(ddns.Path, "home", return_value=Path(root)), \
             patch.object(ddns.sys, "platform", "darwin"), \
             patch.object(ddns.sys.stdin, "isatty", return_value=True), \
             patch("builtins.input", side_effect=[CONFIG["record_name"], CONFIG["zone_id"]]), \
             patch.object(ddns.getpass, "getpass", return_value=CONFIG["api_token"]), \
             patch.object(ddns, "update", return_value="updated") as update, \
             patch.object(ddns.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run, \
             contextlib.redirect_stdout(io.StringIO()):
            ddns.install()
            update.assert_called_once_with(CONFIG, force=True)
            runtime = Path(root) / ".local/share/dondok/cloudflare_ddns.py"
            self.assertEqual(runtime.read_bytes(), Path(ddns.__file__).read_bytes())
            plist_path = Path(root) / "Library/LaunchAgents" / (ddns.LABEL + ".plist")
            plist = plistlib.loads(plist_path.read_bytes())
            self.assertEqual(plist["StartInterval"], 300)
            self.assertTrue(plist["RunAtLoad"])
            self.assertNotIn(CONFIG["api_token"], str(plist))
            self.assertNotIn("duckdns", str(run.call_args_list))
            config_path = Path(root) / ".config/dondok/cloudflare-ddns.json"
            self.assertEqual(ddns.read_config(config_path), CONFIG)
            with self.assertRaises(ddns.SetupError):
                ddns.install()

    def test_failed_permission_check_keeps_previous_installation(self):
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / ".config/dondok/cloudflare-ddns.json"
            config.parent.mkdir(parents=True)
            config.write_text("previous configuration")
            with patch.object(ddns.Path, "home", return_value=Path(root)), \
                 patch.object(ddns.sys, "platform", "darwin"), \
                 patch.object(ddns.sys.stdin, "isatty", return_value=True), \
                 patch("builtins.input", side_effect=[CONFIG["record_name"], CONFIG["zone_id"]]), \
                 patch.object(ddns.getpass, "getpass", return_value=CONFIG["api_token"]), \
                 patch.object(ddns, "update", side_effect=ddns.SetupError("API denied")):
                with self.assertRaises(ddns.SetupError):
                    ddns.install(replace=True)
            self.assertEqual(config.read_text(), "previous configuration")


if __name__ == "__main__":
    unittest.main()
