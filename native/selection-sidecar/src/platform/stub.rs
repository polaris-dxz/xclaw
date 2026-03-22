use std::sync::mpsc::Sender;
use std::thread;

/// 非 macOS：默认仅 `--mock` 时产生事件；否则空闲（占位，供后续 UIA / AT-SPI）。
pub fn run_monitor(tx: Sender<String>, mock: bool) {
    if mock {
        super::mock_loop::run(tx);
        return;
    }
    eprintln!("[selection-sidecar] selection monitor not implemented on this OS (use --mock to test IPC)");
    thread::park();
}
