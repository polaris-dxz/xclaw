use std::sync::mpsc::Sender;
use std::thread;
use std::time::Duration;

use crate::protocol::SelectionChangedEvent;

pub fn run(tx: Sender<String>) {
    let mut tick: u64 = 0;
    loop {
        tick += 1;
        let ev = SelectionChangedEvent::new(
            Some(format!("mock selection #{tick}")),
            true,
            "low",
        );
        if tx.send(serde_json::to_string(&ev).unwrap()).is_err() {
            break;
        }
        thread::sleep(Duration::from_secs(5));
    }
}
