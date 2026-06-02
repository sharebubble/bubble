"""Smoke tests for federation crypto helpers."""

import base64
import secrets

import pytest
from cryptography.hazmat.primitives import serialization

from bubble.federation.crypto import (
    decrypt_private_key,
    encrypt_private_key,
    generate_rsa_keypair,
    rsa_sign_bytes,
    rsa_verify_bytes,
)

_RSA_KEY_SIZE = 2048


@pytest.fixture(autouse=True)
def federation_key_setting(settings):
    """Provide a valid FEDERATION_KEY_ENCRYPTION_KEY for all tests in this module."""
    settings.FEDERATION_KEY_ENCRYPTION_KEY = base64.urlsafe_b64encode(
        secrets.token_bytes(32)
    ).decode()


class TestKeyGenAndEncryption:
    def test_generate_rsa_keypair_returns_tuple(self):
        _, public_pem, encrypted = generate_rsa_keypair()
        assert isinstance(public_pem, str)
        assert "BEGIN PUBLIC KEY" in public_pem
        assert isinstance(encrypted, str)

    def test_keypair_is_2048_bits(self):
        private_key, _, _ = generate_rsa_keypair()
        assert private_key.key_size == _RSA_KEY_SIZE

    def test_roundtrip_encrypt_decrypt(self):
        private_key, _, encrypted = generate_rsa_keypair()
        recovered = decrypt_private_key(encrypted)
        # Compare public key bytes to confirm the same keypair
        orig_pub = private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        recovered_pub = recovered.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        assert orig_pub == recovered_pub

    def test_encrypt_produces_different_ciphertext_each_time(self):
        private_key, _, _ = generate_rsa_keypair()
        enc1 = encrypt_private_key(private_key)
        enc2 = encrypt_private_key(private_key)
        # Different nonces -> different ciphertext
        assert enc1 != enc2

    def test_decrypt_with_wrong_key_raises(self, settings):
        _, _, encrypted = generate_rsa_keypair()
        # Swap the encryption key
        settings.FEDERATION_KEY_ENCRYPTION_KEY = base64.urlsafe_b64encode(
            secrets.token_bytes(32)
        ).decode()
        # cryptography raises InvalidTag (AES-GCM MAC failure) or ValueError
        with pytest.raises((ValueError, Exception)):
            decrypt_private_key(encrypted)


class TestRsaSignVerify:
    def test_sign_and_verify_roundtrip(self):
        private_key, public_pem, _ = generate_rsa_keypair()
        data = b"hello federation"
        sig = rsa_sign_bytes(data, private_key)
        assert rsa_verify_bytes(data, sig, public_pem) is True

    def test_verify_wrong_data_returns_false(self):
        private_key, public_pem, _ = generate_rsa_keypair()
        sig = rsa_sign_bytes(b"original", private_key)
        assert rsa_verify_bytes(b"tampered", sig, public_pem) is False

    def test_verify_wrong_key_returns_false(self):
        private_key, _, _ = generate_rsa_keypair()
        _, other_pub_pem, _ = generate_rsa_keypair()
        sig = rsa_sign_bytes(b"data", private_key)
        assert rsa_verify_bytes(b"data", sig, other_pub_pem) is False

    def test_verify_invalid_pem_returns_false(self):
        private_key, _, _ = generate_rsa_keypair()
        sig = rsa_sign_bytes(b"data", private_key)
        assert rsa_verify_bytes(b"data", sig, "not-a-pem") is False
