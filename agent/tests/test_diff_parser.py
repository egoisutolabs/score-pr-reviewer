from src.github import BINARY_MARKER, guess_language, parse_unified_diff

# One block per status, plus a binary file and a `\ No newline` trailer so the
# counters are proven to ignore everything that is not a real +/- line.
SAMPLE_DIFF = """diff --git a/src/app.py b/src/app.py
index 1111111..2222222 100644
--- a/src/app.py
+++ b/src/app.py
@@ -1,4 +1,5 @@
 import os
-def main():
-    print("hi")
+def main(name):
+    print(f"hi {name}")
+    return 0

diff --git a/src/new_module.ts b/src/new_module.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new_module.ts
@@ -0,0 +1,3 @@
+export function add(a: number, b: number) {
+  return a + b;
+}
diff --git a/old/legacy.rb b/old/legacy.rb
deleted file mode 100644
index 4444444..0000000
--- a/old/legacy.rb
+++ /dev/null
@@ -1,2 +0,0 @@
-puts "bye"
-exit
diff --git a/docs/OLD.md b/docs/NEW.md
similarity index 90%
rename from docs/OLD.md
rename to docs/NEW.md
index 5555555..6666666 100644
--- a/docs/OLD.md
+++ b/docs/NEW.md
@@ -1,2 +1,2 @@
 # Title
-old line
+new line
diff --git a/assets/logo.png b/assets/logo.png
new file mode 100644
index 0000000..7777777
Binary files /dev/null and b/assets/logo.png differ
diff --git a/Makefile b/Makefile
index 8888888..9999999 100644
--- a/Makefile
+++ b/Makefile
@@ -1 +1,2 @@
 all:
+\techo hi
\\ No newline at end of file
""".replace("\\t", "\t")


def by_path(files):
    return {file.path: file for file in files}


def test_splits_into_one_patch_per_file_with_headers():
    files = parse_unified_diff(SAMPLE_DIFF)
    assert [file.path for file in files] == [
        "src/app.py",
        "src/new_module.ts",
        "old/legacy.rb",
        "docs/NEW.md",
        "assets/logo.png",
        "Makefile",
    ]
    for file in files:
        assert file.patch.startswith("diff --git ")
        assert file.patch.endswith("\n")
    # Concatenating the text patches must reproduce the input: nothing dropped, nothing duplicated.
    text_files = [file for file in files if file.path != "assets/logo.png"]
    assert all(file.patch in SAMPLE_DIFF for file in text_files)


def test_statuses_and_rename_tracking():
    files = by_path(parse_unified_diff(SAMPLE_DIFF))
    assert files["src/app.py"].status == "modified"
    assert files["src/new_module.ts"].status == "added"
    assert files["old/legacy.rb"].status == "removed"
    assert files["docs/NEW.md"].status == "renamed"
    assert files["docs/NEW.md"].previous_path == "docs/OLD.md"
    assert files["assets/logo.png"].status == "added"
    assert all(file.previous_path is None for path, file in files.items() if path != "docs/NEW.md")


def test_counts_exclude_headers_and_no_newline_marker():
    files = by_path(parse_unified_diff(SAMPLE_DIFF))
    assert (files["src/app.py"].additions, files["src/app.py"].deletions) == (3, 2)
    assert (files["src/new_module.ts"].additions, files["src/new_module.ts"].deletions) == (3, 0)
    assert (files["old/legacy.rb"].additions, files["old/legacy.rb"].deletions) == (0, 2)
    assert (files["docs/NEW.md"].additions, files["docs/NEW.md"].deletions) == (1, 1)
    assert (files["Makefile"].additions, files["Makefile"].deletions) == (1, 0)


def test_language_guesses():
    files = by_path(parse_unified_diff(SAMPLE_DIFF))
    assert files["src/app.py"].language == "py"
    assert files["src/new_module.ts"].language == "ts"
    assert files["old/legacy.rb"].language == "rb"
    assert files["docs/NEW.md"].language == "md"
    assert files["Makefile"].language is None
    assert files["assets/logo.png"].language is None
    assert guess_language("a/b/c.yml") == "yaml"
    assert guess_language("weird.unknownext") is None


def test_binary_file_gets_marker_and_no_counts():
    logo = by_path(parse_unified_diff(SAMPLE_DIFF))["assets/logo.png"]
    assert logo.patch.startswith("diff --git a/assets/logo.png b/assets/logo.png")
    assert BINARY_MARKER in logo.patch
    assert "@@" not in logo.patch
    assert (logo.additions, logo.deletions) == (0, 0)


def test_git_binary_patch_payload_is_stripped():
    diff = (
        "diff --git a/img.bin b/img.bin\n"
        "index 1111111..2222222 100644\n"
        "GIT binary patch\n"
        "literal 12\nTcmZQzU|?i`00001\n\nliteral 0\nHcmV?d00001\n"
    )
    [file] = parse_unified_diff(diff)
    assert file.status == "modified"
    assert "literal" not in file.patch
    assert BINARY_MARKER in file.patch


def test_paths_with_spaces_survive_the_header_split():
    diff = (
        "diff --git a/docs/my notes.md b/docs/my notes.md\n"
        "index 1111111..2222222 100644\n"
        "--- a/docs/my notes.md\n"
        "+++ b/docs/my notes.md\n"
        "@@ -1 +1 @@\n-a\n+b\n"
    )
    [file] = parse_unified_diff(diff)
    assert file.path == "docs/my notes.md"


def test_empty_diff_gives_no_files():
    assert parse_unified_diff("") == []
    assert parse_unified_diff("\n\n") == []
