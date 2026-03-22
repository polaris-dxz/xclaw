mod platform;
mod protocol;

use std::io::{self, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};
use std::thread;

use protocol::ReadyEvent;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mock = std::env::args().any(|a| a == "--mock");

    let (tx, rx) = std::sync::mpsc::channel::<String>();

    let listener = TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(false)?;
    let port = listener.local_addr()?.port();

    let ready = ReadyEvent {
        v: 1,
        ty: "ready",
        port,
    };
    let ready_line = serde_json::to_string(&ready)?;
    println!("{ready_line}");
    io::stdout().flush()?;

    let stream_slot: Arc<Mutex<Option<std::net::TcpStream>>> = Arc::new(Mutex::new(None));
    let stream_for_writer = Arc::clone(&stream_slot);

    thread::spawn(move || {
        for inc in listener.incoming() {
            match inc {
                Ok(s) => {
                    let _ = s.set_nodelay(true);
                    let mut g = stream_for_writer.lock().unwrap();
                    *g = Some(s);
                    break;
                }
                Err(e) => {
                    eprintln!("[selection-sidecar] accept error: {e}");
                    break;
                }
            }
        }
    });

    thread::spawn(move || {
        platform::run_monitor(tx, mock);
    });

    for line in rx {
        let mut g = stream_slot.lock().unwrap();
        if let Some(ref mut tcp) = *g {
            if writeln!(tcp, "{line}").is_err() {
                *g = None;
            }
        }
    }

    Ok(())
}
