import os
from functools import lru_cache

import boto3
from botocore.config import Config


class S3Storage:
    def __init__(self):
        self.bucket = os.getenv("S3_BUCKET_NAME", "").strip()
        if not self.bucket:
            raise RuntimeError("S3_BUCKET_NAME is not configured")
        self.prefix = os.getenv("S3_KEY_PREFIX", "snapkey-studio").strip("/")
        self.presigned_expiry = int(os.getenv("S3_PRESIGNED_URL_EXPIRES", "900"))
        self.client = boto3.client(
            "s3", region_name=os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "ap-south-1",
            config=Config(signature_version="s3v4", retries={"max_attempts": 4, "mode": "standard"}),
        )

    def media_key(self, owner_id, asset_id):
        return f"{self.prefix}/media/{owner_id}/{asset_id}"

    def meeting_key(self, presentation_id, object_id):
        return f"{self.prefix}/meeting-chat/{presentation_id}/{object_id}"

    def upload_bytes(self, *, content, key, content_type):
        self.client.put_object(Bucket=self.bucket, Key=key, Body=content, ContentType=content_type, CacheControl="private,max-age=3600")

    def presigned_get(self, key):
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=self.presigned_expiry)

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)


@lru_cache
def get_s3_storage():
    return S3Storage()
