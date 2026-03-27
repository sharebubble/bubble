"""Pytest fixtures for users API tests."""

import pytest

from bubble.users.tests.factories import UserFactory


@pytest.fixture
def user():
    """Create a test user."""
    return UserFactory()
