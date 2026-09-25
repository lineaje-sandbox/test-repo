"""Puts an uploaded order document where the deployed agents can read it.

The agents run on Agent Engine, so the PDF has to leave this process somehow. It
goes to Cloud Storage and the agent receives a `gs://` reference, rather than
base64 bytes inline in the engine request. Two reasons: a scanned order is large
enough that base64 in a JSON body is wasteful, and Vertex reads `gs://` directly,
so the bytes take the shorter path.

The bucket is regional (europe-west1), which is what keeps the documents in the EU
even though inference is served from the global endpoint. That distinction is
stated in the UI rather than glossed over.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_BUCKET = "fieldops-agentic-poc-eu-marssnack-staging"
PREFIX = "orders"


def bucket_name() -> str:
    return os.environ.get("DOCUMENT_BUCKET", DEFAULT_BUCKET)


def bucket_location() -> str:
    return os.environ.get("DOCUMENT_BUCKET_LOCATION", "europe-west1")


@lru_cache(maxsize=1)
def _client():
    from google.cloud import storage

    return storage.Client(project=os.environ.get("GOOGLE_CLOUD_PROJECT"))


def upload(order_id: str, filename: str, data: bytes) -> str:
    """Upload one document and return its gs:// URI."""
    safe = filename.replace("/", "_").strip() or "order.pdf"
    blob_name = f"{PREFIX}/{order_id}/{safe}"
    blob = _client().bucket(bucket_name()).blob(blob_name)
    blob.upload_from_string(data, content_type="application/pdf")
    uri = f"gs://{bucket_name()}/{blob_name}"
    logger.info("Uploaded %s (%d bytes) to %s", safe, len(data), uri)
    return uri


def delete(uri: Optional[str]) -> None:
    """Best effort cleanup. Never allowed to fail a request."""
    if not uri or not uri.startswith("gs://"):
        return
    try:
        _, _, rest = uri.partition("gs://")
        bucket, _, blob_name = rest.partition("/")
        _client().bucket(bucket).blob(blob_name).delete()
    except Exception:
        logger.warning("Could not delete %s", uri, exc_info=True)
