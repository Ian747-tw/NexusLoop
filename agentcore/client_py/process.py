"""agentcore.client_py.process — server lifecycle management."""
import subprocess
import time
import signal
from typing import Optional


class ServerProcess:
    """Manages the forked OpenCode TS server subprocess."""

    def __init__(self, server_path: str):
        self._server_path = server_path
        self._proc: Optional[subprocess.Popen] = None

    def start(self) -> None:
        """Spawn the TS server subprocess."""
        self._proc = subprocess.Popen(
            ['bun', 'run', self._server_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if not self.health_check():
            raise RuntimeError('Server failed health check on start')

    def health_check(self) -> bool:
        """Ping/pong over stdio to verify server is responsive."""
        if self._proc is None or self._proc.stdin is None:
            return False
        try:
            self._proc.stdin.write(b'{"type":"ping"}\n')
            self._proc.stdin.flush()
            # Read response with timeout
            import select
            if select.select([self._proc.stdout], [], [], 5)[0]:
                return True
        except Exception:
            pass
        return False

    def shutdown(self, timeout: float = 10.0) -> None:
        """Graceful shutdown with force-kill fallback."""
        if self._proc is None:
            return
        self._proc.send_signal(signal.SIGTERM)
        try:
            self._proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            self._proc.wait()

    def restart_on_hang(self) -> None:
        """Restart the server if it becomes unresponsive."""
        self.shutdown(timeout=2.0)
        time.sleep(1)
        self.start()