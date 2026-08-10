import pytest

from traceme.models import looks_like_a_placeholder


@pytest.mark.parametrize(
    "value,expected",
    [
        ("ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", True),
        ("PASTE_YOUR_CLASSIC_PAT_HERE", True),
        ("", True),
        ("ghp_realLookingToken1234567890abcdefghij", False),
    ],
)
def test_looks_like_a_placeholder(value, expected):
    assert looks_like_a_placeholder(value) is expected
