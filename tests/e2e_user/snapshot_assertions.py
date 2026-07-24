def snapshot_section(stdout: str, heading: str) -> str:
    lines = stdout.splitlines()
    matches = [index for index, line in enumerate(lines) if line == heading]
    if not matches:
        raise AssertionError(f"Snapshot section missing: {heading}")
    if len(matches) > 1:
        raise AssertionError(f"Snapshot section appears more than once: {heading}")

    start = matches[0]
    section_lines = [lines[start]]
    for line in lines[start + 1 :]:
        if line and not line.startswith(" "):
            break
        section_lines.append(line)
    return "\n".join(section_lines)


def assert_opencode_process_smoke_idle(stdout: str) -> None:
    section = snapshot_section(stdout, "OpenCode process smoke")
    assert "preview=none" in section
    assert "latest=none" in section
    assert "records=0" in section
    assert "note=real smoke is opt-in and not part of default CI" in section
    assert "preview_status=" not in section
    assert "selected=" not in section
    assert "command_error=" not in section
