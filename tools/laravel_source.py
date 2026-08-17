"""
Where the Laravel source database lives.

This repository is generated FROM the Laravel app's schema, so the parity tools
need to read its SQLite file. The two repositories are separate, so the path is
configurable rather than assumed:

    LARAVEL_ROOT   path to the Laravel checkout
                   (default: ../TT002-LEO-LMS, i.e. a sibling directory)

Every generator also still accepts an explicit path as argv[1].
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

DEFAULT_LARAVEL_ROOT = os.path.join(REPO, "..", "TT002-LEO-LMS")


def laravel_root():
    return os.environ.get("LARAVEL_ROOT", DEFAULT_LARAVEL_ROOT)


def source_db(argv=None):
    """The Laravel SQLite file: argv[1] if given, else LARAVEL_ROOT/database."""
    if argv and len(argv) > 1:
        return argv[1]
    path = os.path.join(laravel_root(), "database", "database.sqlite")
    if not os.path.exists(path):
        raise SystemExit(
            "Cannot find the Laravel source database at:\n  " + os.path.abspath(path)
            + "\nSet LARAVEL_ROOT to the Laravel checkout, or pass the path as an argument.")
    return path
