import datetime as dt
import hashlib
import json
import urllib.parse
from functools import lru_cache
from pathlib import Path
from typing import Mapping

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

GCS_HOST = "storage.googleapis.com"
MAX_EXPIRATION_SECONDS = 7 * 24 * 60 * 60  # 7 days


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _goog_timestamps(now: dt.datetime | None = None) -> tuple[str, str]:
    now = now or _utc_now()
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    return amz_date, date_stamp


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _quote(value: str, safe: str = "") -> str:
    return urllib.parse.quote(value, safe=safe)


def _canonical_query_string(params: Mapping[str, str]) -> str:
    # Sort by encoded key, then encoded value.
    encoded_items = [(_quote(str(k)), _quote(str(v))) for k, v in params.items()]
    encoded_items.sort()
    return "&".join(f"{k}={v}" for k, v in encoded_items)


def _validate_service_account_payload(data: Mapping[str, str]) -> tuple[str, bytes]:
    client_email = str(data.get("client_email", "")).strip()
    private_key = str(data.get("private_key", "")).strip()
    if not client_email:
        raise ValueError("Service account JSON is missing 'client_email'.")
    if not private_key:
        raise ValueError("Service account JSON is missing 'private_key'.")
    return client_email, private_key.encode("utf-8")


@lru_cache(maxsize=4)
def load_service_account_key_from_path(path: str | Path) -> tuple[str, bytes]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return _validate_service_account_payload(data)


def load_service_account_key_from_json(raw_json: str) -> tuple[str, bytes]:
    data = json.loads(raw_json)
    return _validate_service_account_payload(data)


def generate_v4_signed_get_url(
    *,
    bucket: str,
    object_name: str,
    service_account_email: str,
    private_key_pem: bytes,
    expires_seconds: int = 900,
    headers: Mapping[str, str] | None = None,
    query_params: Mapping[str, str] | None = None,
) -> str:
    """
    Generate a GCS V4 signed URL for GET.

    bucket: GCS bucket name
    object_name: object path within bucket, e.g. "folder/file.json"
    service_account_email: from service account JSON
    private_key_pem: PEM private key bytes from service account JSON
    expires_seconds: URL lifetime in seconds (1 to 604800)
    headers: optional additional headers to sign; usually leave empty
    query_params: additional non-X-Goog query params to include in the signed URL
    """
    if not bucket:
        raise ValueError("bucket must be non-empty")
    if not object_name:
        raise ValueError("object_name must be non-empty")
    if not service_account_email:
        raise ValueError("service_account_email must be non-empty")
    if not private_key_pem:
        raise ValueError("private_key_pem must be non-empty")
    if not (1 <= expires_seconds <= MAX_EXPIRATION_SECONDS):
        raise ValueError("expires_seconds must be between 1 and 604800")

    amz_date, date_stamp = _goog_timestamps()
    credential_scope = f"{date_stamp}/auto/storage/goog4_request"
    credential = f"{service_account_email}/{credential_scope}"

    # GCS manual signing uses the XML API endpoint.
    # Canonical URI should be: /bucket-name/object/path
    escaped_object = urllib.parse.quote(object_name, safe="/~")
    canonical_uri = f"/{bucket}/{escaped_object}"

    signed_headers_map = {"host": GCS_HOST}
    if headers:
        for key, value in headers.items():
            signed_headers_map[key.strip().lower()] = " ".join(value.strip().split())

    canonical_headers = "".join(
        f"{key}:{signed_headers_map[key]}\n" for key in sorted(signed_headers_map)
    )
    signed_headers = ";".join(sorted(signed_headers_map))

    canonical_query_params = {
        "X-Goog-Algorithm": "GOOG4-RSA-SHA256",
        "X-Goog-Credential": credential,
        "X-Goog-Date": amz_date,
        "X-Goog-Expires": str(expires_seconds),
        "X-Goog-SignedHeaders": signed_headers,
    }
    if query_params:
        for key, value in query_params.items():
            if str(key).lower().startswith("x-goog-"):
                raise ValueError("query_params cannot override X-Goog-* parameters.")
            canonical_query_params[str(key)] = str(value)

    canonical_query = _canonical_query_string(canonical_query_params)

    canonical_request = "\n".join(
        [
            "GET",
            canonical_uri,
            canonical_query,
            canonical_headers,
            signed_headers,
            "UNSIGNED-PAYLOAD",
        ]
    )

    canonical_request_hash = _sha256_hex(canonical_request.encode("utf-8"))
    string_to_sign = "\n".join(
        [
            "GOOG4-RSA-SHA256",
            amz_date,
            credential_scope,
            canonical_request_hash,
        ]
    )

    private_key = serialization.load_pem_private_key(private_key_pem, password=None)
    signature = private_key.sign(
        string_to_sign.encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    ).hex()

    return (
        f"https://{GCS_HOST}{canonical_uri}"
        f"?{canonical_query}&X-Goog-Signature={signature}"
    )
