import importlib.util
import io
import json
import hashlib
from pathlib import Path
import sys
import tarfile
import time
from types import SimpleNamespace
from unittest.mock import patch

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

spec = importlib.util.spec_from_file_location("vps_ci", Path(__file__).resolve().parents[2] / "deploy/vps_ci.py")
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)
SHA = "a" * 40
IMAGE = "snapkey-studio:release-" + SHA


@pytest.mark.parametrize("ssh_command", ["id", "bash", "status; id", "deploy ../root a 0", "deploy " + SHA + " " + "b"*64 + " 2", "status extra"])
def test_forced_command_rejects_arbitrary_commands(ssh_command):
    with pytest.raises(ValueError): ci.parse_request(ssh_command)


def test_deployment_command_and_policy_are_bound_to_main():
    assert ci.parse_request("deploy " + SHA + " " + "b"*64 + " 0")[1] == SHA
    policy = ci.identity_policy(SHA, False)
    assert policy["ref"] == "refs/heads/main"
    assert policy["repository_id"] == "1379740996"
    assert policy["sha"] == policy["workflow_sha"] == SHA
    assert policy["workflow_ref"].endswith("/deploy.yml@refs/heads/main")


@pytest.fixture
def identity(monkeypatch):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(ci, "verifier_image", lambda: "approved-image")
    monkeypatch.setattr(jwt, "PyJWKClient", lambda *a, **kw: SimpleNamespace(get_signing_key_from_jwt=lambda _: SimpleNamespace(key=key.public_key())))
    def isolated(arguments, **options):
        assert "--read-only" in arguments and "--cap-drop" in arguments
        with patch.object(sys, "stdin", io.StringIO(options["input"])), patch.object(sys, "stdout", io.StringIO()):
            exec(arguments[-1], {})
        return ""
    monkeypatch.setattr(ci, "command", isolated)
    claims = {**ci.identity_policy(SHA, False), "iss": "https://token.actions.githubusercontent.com",
              "aud": "snapkey-studio-vps", "sub": "GitHub", "iat": int(time.time()),
              "nbf": int(time.time())-1, "exp": int(time.time())+120, "event_name": "push"}
    return key, claims


def test_signed_identity_is_verified_without_consuming_image_bytes(identity):
    key, claims = identity
    token = jwt.encode(claims, key, algorithm="RS256")
    stream = io.BytesIO(token.encode() + b"\nimage bytes")
    ci.verify_identity(stream, SHA, False)
    assert stream.read() == b"image bytes"


@pytest.mark.parametrize("change", [{"ref": "refs/heads/other"}, {"sha": "c"*40}, {"repository_id": "other"}, {"event_name": "pull_request"}, {"exp": 1}])
def test_untrusted_or_expired_identities_are_rejected(identity, change):
    key, claims = identity
    token = jwt.encode({**claims, **change}, key, algorithm="RS256")
    with pytest.raises((ValueError, jwt.PyJWTError)):
        ci.verify_identity(io.BytesIO(token.encode()+b"\n"), SHA, False)


def test_forged_signature_and_automatic_meeting_override_are_rejected(identity):
    key, claims = identity
    forged = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(jwt.InvalidSignatureError):
        ci.verify_identity(io.BytesIO(jwt.encode(claims, forged, algorithm="RS256").encode()+b"\n"), SHA, False)
    with pytest.raises(ValueError):
        ci.verify_identity(io.BytesIO(jwt.encode(claims, key, algorithm="RS256").encode()+b"\n"), SHA, True)
    ci.verify_identity(io.BytesIO(jwt.encode({**claims, "event_name": "workflow_dispatch"}, key, algorithm="RS256").encode()+b"\n"), SHA, True)


def archive(path, *, revision=SHA, tags=None):
    config = json.dumps({"config": {"Labels": {"org.opencontainers.image.revision": revision}}}).encode()
    config_id = "sha256:" + hashlib.sha256(config).hexdigest()
    manifest_blob = json.dumps({"config": {"digest": config_id}}).encode()
    manifest_id = "sha256:" + hashlib.sha256(manifest_blob).hexdigest()
    files = {"manifest.json": json.dumps([{"RepoTags": tags or [IMAGE], "Config": "blobs/sha256/"+config_id[7:]}]).encode(),
             "index.json": json.dumps({"manifests": [{"digest": manifest_id}]}).encode(),
             "blobs/sha256/"+config_id[7:]: config, "blobs/sha256/"+manifest_id[7:]: manifest_blob}
    with tarfile.open(path, "w:gz") as output:
        for name, data in files.items():
            member = tarfile.TarInfo(name); member.size = len(data)
            output.addfile(member, io.BytesIO(data))
    return {config_id, manifest_id}


def test_archive_verifies_both_docker_image_identity_formats(tmp_path):
    path = tmp_path / "image.tar.gz"
    ids = archive(path)
    assert ci.archive_identity(path, IMAGE, SHA) == ids
    archive(path, revision="c"*40)
    with pytest.raises(ValueError): ci.archive_identity(path, IMAGE, SHA)
    archive(path, tags=[IMAGE, "other:tag"])
    with pytest.raises(ValueError): ci.archive_identity(path, IMAGE, SHA)


def test_bad_checksum_or_oversized_upload_preserves_existing_archive(tmp_path, monkeypatch):
    target = tmp_path / "image.tar.gz"; target.write_bytes(b"previous")
    with pytest.raises(ValueError): ci.receive_archive(io.BytesIO(b"wrong"), target, "0"*64)
    assert target.read_bytes() == b"previous" and not target.with_suffix(".partial").exists()
    monkeypatch.setattr(ci, "MAX_ARCHIVE", 2)
    with pytest.raises(ValueError): ci.receive_archive(io.BytesIO(b"oversized"), target, "0"*64)
    assert target.read_bytes() == b"previous"


def test_meeting_guard_and_environment_preservation(monkeypatch):
    monkeypatch.setattr(ci, "participants", lambda: 2)
    with pytest.raises(BlockingIOError): ci.check_meetings(False)
    assert ci.check_meetings(True) == 2
    original = "SECRET=keep-me\nAPP_IMAGE=previous\nOTHER=keep-too\n"
    assert ci.image_environment(original, IMAGE) == original.replace("APP_IMAGE=previous", "APP_IMAGE="+IMAGE)
    with pytest.raises(ValueError): ci.image_environment("SECRET=keep-me", IMAGE)


def test_failed_backend_replacement_restores_environment_and_only_restarts_backend(tmp_path, monkeypatch):
    original = b"APP_IMAGE=previous\nSECRET=keep\n"
    (tmp_path / ".env.vps").write_bytes(original)
    (tmp_path / "compose.vps.yml").write_text("unchanged")
    image_path = tmp_path / "fixture.tar.gz"; ids = archive(image_path); data = image_path.read_bytes()
    monkeypatch.setattr(ci, "inspect", lambda _: {"Config": {"Image": "previous"}})
    monkeypatch.setattr(ci, "check_meetings", lambda _: 0)
    monkeypatch.setattr(ci, "snapshot", lambda: {})
    monkeypatch.setattr(ci, "health", lambda: None)
    replacements = []
    def commands(arguments, **options):
        if arguments[:3] == ["docker", "image", "inspect"]: return json.dumps([{"Id": next(iter(ids))}])
        if arguments[0] == "python3": return "Validated database backup"
        if "up" in arguments:
            assert arguments[-1] == "backend" and "--no-deps" in arguments
            replacements.append(arguments)
            if len(replacements) == 1: raise RuntimeError("new backend unhealthy")
        return ""
    monkeypatch.setattr(ci, "command", commands)
    with pytest.raises(RuntimeError, match="previous backend restored"):
        ci.deploy(SHA, hashlib.sha256(data).hexdigest(), False, io.BytesIO(data), root=tmp_path)
    assert len(replacements) == 2
    assert (tmp_path / ".env.vps").read_bytes() == original
    assert not (tmp_path / "releases" / SHA / "DEPLOYED.json").exists()


def test_already_deployed_retry_consumes_upload_without_restarting(tmp_path, monkeypatch):
    path = tmp_path / "fixture.tar.gz"; archive(path); data = path.read_bytes()
    monkeypatch.setattr(ci, "inspect", lambda _: {"Config": {"Image": IMAGE}})
    monkeypatch.setattr(ci, "status", lambda: {"healthy": True})
    monkeypatch.setattr(ci, "check_meetings", lambda _: pytest.fail("No restart should be attempted"))
    monkeypatch.setattr(ci, "command", lambda *a, **kw: pytest.fail("No backup/load/restart should run"))
    stream = io.BytesIO(data)
    result = ci.deploy(SHA, hashlib.sha256(data).hexdigest(), False, stream, root=tmp_path)
    assert result["alreadyDeployed"] and stream.read() == b""


def test_owned_repository_identity_is_also_authorized(identity):
    key, claims = identity
    policy = ci.identity_policy(SHA, False, 'koushikdatascience-netizen/Present-Studio')
    token = jwt.encode({**claims, **policy}, key, algorithm='RS256')
    ci.verify_identity(io.BytesIO(token.encode()+b'\n'), SHA, False)
    assert policy['repository_id'] == '1345831771'
    assert policy['repository_owner_id'] == '234684887'
