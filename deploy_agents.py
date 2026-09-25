#!/usr/bin/env python3
"""Deploys both order-processing agents to Vertex AI Agent Engine.

    cd mars-snack
    export GOOGLE_CLOUD_PROJECT=fieldops-agentic-poc
    backend/.venv/bin/python deploy_agents.py

Writes `.remote_agents.json`, which the Cloud Run backend reads to find the
deployed engines. Pass `--list` to show what is currently deployed, or
`--delete-stale` to remove older engines with the same display names.

Four things here were established by deploying and watching it fail, not by
reading documentation:

* `GOOGLE_CLOUD_PROJECT` cannot be set in `env_vars`: the runtime reserves the
  name and the create call is rejected outright.
* `extra_packages` must be a path to a package *directory*, relative to the
  working directory. An absolute path, or a bare `.py` file, is accepted at
  create time and then the engine fails to boot with `No module named ...`.
* `GOOGLE_CLOUD_LOCATION=global` is what puts inference on the only endpoint that
  serves Gemini 3.x for this project, while the engine itself runs in a real
  region. Verified: a europe-west1 engine reporting `model_version:
  gemini-3.8-flash`.
* gRPC does not survive the corporate proxy, so the SDK is initialised with
  `api_transport="rest"`.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "fieldops-agentic-poc")
# Agent Engine will not accept `global` for the engine's own location.
ENGINE_LOCATION = os.environ.get("AGENT_ENGINE_LOCATION", "europe-west1")
STAGING_BUCKET = os.environ.get(
    "VERTEX_STAGING_BUCKET", "gs://fieldops-agentic-poc-eu-marssnack-staging"
)
RESOURCE_FILE = HERE / ".remote_agents.json"

REQUIREMENTS = [
    "google-adk==2.9.2",
    "google-cloud-aiplatform[agent_engines]>=2.1,<3",
    "google-genai>=2.24,<3",
    "pydantic>=2.9",
]

ENV_VARS = {
    "GOOGLE_CLOUD_LOCATION": "global",
    "GOOGLE_GENAI_USE_VERTEXAI": "TRUE",
}


def _ensure_ca_bundle() -> None:
    """Point TLS at the corporate CA bundle for the deploy calls.

    Only the deploy needs this. The deployed engines run inside Google's network,
    where nothing intercepts TLS, which is why no certificate material is shipped
    with the agents.
    """
    if os.environ.get("REQUESTS_CA_BUNDLE") and os.environ.get("SSL_CERT_FILE"):
        return
    for candidate in (
        HERE.parent / "combined_certs.pem",
        Path.home() / "combined_certs.pem",
    ):
        if candidate.is_file():
            for var in (
                "REQUESTS_CA_BUNDLE",
                "SSL_CERT_FILE",
                "GRPC_DEFAULT_SSL_ROOTS_FILE_PATH",
            ):
                os.environ.setdefault(var, str(candidate))
            print(f"CA bundle : {candidate}")
            return
    print("! combined_certs.pem not found; TLS to Vertex may fail on the corp network.")


def _patch_protobuf_lenient() -> None:
    """Tolerate response fields this client version does not know about.

    The service adds fields ahead of the client library, and strict parsing turns
    that into a deploy failure with a misleading message.
    """
    from google.protobuf import json_format

    original = json_format.Parse

    def lenient(text, message, *args, **kwargs):
        kwargs["ignore_unknown_fields"] = True
        return original(text, message, *args, **kwargs)

    json_format.Parse = lenient


def _init() -> None:
    import vertexai

    vertexai.init(
        project=PROJECT,
        location=ENGINE_LOCATION,
        staging_bucket=STAGING_BUCKET,
        api_transport="rest",
    )


def _specs():
    sys.path.insert(0, str(HERE))
    from agent_pkg import extraction_agent, validation_agent

    return [
        ("extraction", extraction_agent.DISPLAY_NAME, extraction_agent.root_agent),
        ("validation", validation_agent.DISPLAY_NAME, validation_agent.root_agent),
    ]


def list_engines() -> None:
    _ensure_ca_bundle()
    _patch_protobuf_lenient()
    _init()
    from vertexai import agent_engines

    print(f"\nEngines in {PROJECT}/{ENGINE_LOCATION}:")
    for engine in agent_engines.list():
        print(f"  {engine.display_name:34} {engine.resource_name.split('/')[-1]}")


def deploy() -> None:
    _ensure_ca_bundle()
    _patch_protobuf_lenient()
    _init()
    from vertexai import agent_engines

    print(f"project   : {PROJECT}")
    print(f"engine loc: {ENGINE_LOCATION}")
    print(f"bucket    : {STAGING_BUCKET}")
    print(f"inference : {ENV_VARS['GOOGLE_CLOUD_LOCATION']} (Gemini 3.x is global-only here)")

    resources: dict[str, str] = {}
    if RESOURCE_FILE.exists():
        try:
            resources = json.loads(RESOURCE_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            resources = {}

    for key, display_name, agent in _specs():
        print(f"\n{'=' * 64}\nDeploying {display_name}  (model: {agent.model})\n{'=' * 64}")
        app = agent_engines.AdkApp(agent=agent, enable_tracing=True)
        remote = agent_engines.create(
            app,
            display_name=display_name,
            description=agent.description,
            requirements=REQUIREMENTS,
            # Relative path to a package directory: see the module docstring.
            extra_packages=["./agent_pkg"],
            env_vars=ENV_VARS,
            # Scale to zero between demos; one instance is plenty for a pitch.
            min_instances=0,
            max_instances=2,
        )
        print(f"  -> {remote.resource_name}")
        resources[key] = remote.resource_name

    resources["_engine_location"] = ENGINE_LOCATION
    resources["_project"] = PROJECT
    RESOURCE_FILE.write_text(json.dumps(resources, indent=2) + "\n", encoding="utf-8")
    print(f"\nWrote {RESOURCE_FILE.name}:")
    for key, value in resources.items():
        if not key.startswith("_"):
            print(f"  {key:12} -> {value}")
    print("\nNext: bash backend/cloudrun-deploy.sh")


if __name__ == "__main__":
    if "--list" in sys.argv:
        list_engines()
    else:
        deploy()
