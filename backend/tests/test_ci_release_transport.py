"""Offline tests: fake SSH only, never connect to a server."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ReleaseTransportTests(unittest.TestCase):
    def run_transport(self, code=0, message="", large=False, missing_token=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "bin").mkdir()
            ssh = root / "bin" / "ssh"
            ssh.write_text("#!/bin/sh\n" + (
                "printf '%s\\n' \"$FAKE_MESSAGE\"; exit \"$FAKE_CODE\"\n" if code else
                "cat >/dev/null; printf '%s\\n' \"$FAKE_MESSAGE\"\n"))
            ssh.chmod(0o700)
            (root / "release").mkdir()
            (root / "release" / "snapkey-studio-image.tar.gz").write_bytes(b"x" * (2_000_000 if large else 10))
            if not missing_token:
                (root / "snapkey-oidc").write_text("isolated-test-token\n")
            env = {**os.environ, "PATH": str(root / "bin") + os.pathsep + os.environ["PATH"],
                   "RUNNER_TEMP": str(root), "GITHUB_OUTPUT": str(root / "output"),
                   "GITHUB_STEP_SUMMARY": str(root / "summary"), "GITHUB_SHA": "a" * 40,
                   "VPS_HOST": "unused.invalid", "VPS_PORT": "22", "VPS_USER": "unused",
                   "ALLOW_ACTIVE": "0", "RELEASE_DIR": str(root / "release"),
                   "FAKE_CODE": str(code), "FAKE_MESSAGE": message}
            result = subprocess.run(["bash", str(ROOT / "deploy/run_vps_release.sh")], env=env,
                                    text=True, capture_output=True, timeout=10)
            return result, (root / "output").read_text() if (root / "output").exists() else "", (
                (root / "summary").read_text() if (root / "summary").exists() else "")

    def test_success_enables_public_verification(self):
        result, output, summary = self.run_transport(message='{"healthy":true}')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("deployed=true", output)
        self.assertEqual(summary, "")

    def test_active_meetings_defer_even_when_upload_pipe_breaks(self):
        result, output, summary = self.run_transport(3, "Deployment held: active meeting participants: 13", large=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, "deployed=false\n")
        self.assertIn("Deployment deferred", summary)
        self.assertIn("did not deploy", summary)

    def test_lock_and_real_errors_still_fail(self):
        for code, message in [(3, "Resource temporarily unavailable"), (255, "Permission denied"),
                              (1, "VPS deployment failed: RuntimeError"),
                              (1, "Deployment held: active meeting participants: 13")]:
            with self.subTest(code=code, message=message):
                result, output, summary = self.run_transport(code, message)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(output, "deployed=false\n")
                self.assertEqual(summary, "")

    def test_failed_local_upload_is_not_successful_deployment(self):
        result, output, _ = self.run_transport(missing_token=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("deployed=true", output)


if __name__ == "__main__":
    unittest.main()
