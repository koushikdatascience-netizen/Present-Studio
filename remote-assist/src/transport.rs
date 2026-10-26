//! Nonblocking WebSocket I/O: WouldBlock is retryable; all other errors fail closed.
use std::io::{Read, Write};
use tungstenite::{Error, Message, WebSocket};

fn pending(error: &Error) -> bool {
    matches!(error, Error::Io(e) if e.kind() == std::io::ErrorKind::WouldBlock)
}

pub fn flush<S: Read + Write>(ws: &mut WebSocket<S>) -> Result<(), Error> {
    match ws.flush() { Err(e) if pending(&e) => Ok(()), result => result }
}

pub fn send<S: Read + Write>(ws: &mut WebSocket<S>, message: Message) -> Result<(), Error> {
    // Tungstenite retains partially written frames; never resend them on WouldBlock.
    match ws.write(message) {
        Err(e) if pending(&e) => (),
        Err(e) => return Err(e),
        Ok(()) => (),
    }
    flush(ws)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{net::{TcpListener, TcpStream}, thread, time::{Duration, Instant}};

    #[test]
    fn idle_nonblocking_reads_and_binary_frames_preserve_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
            let mut ws = tungstenite::accept(stream).unwrap();
            thread::sleep(Duration::from_millis(150));
            assert_eq!(ws.read().unwrap(), Message::Binary(vec![42; 256_000]));
            ws.send(Message::Text("lease".into())).unwrap();
            assert_eq!(ws.read().unwrap(), Message::Text("heartbeat".into()));
        });
        let stream = TcpStream::connect(address).unwrap();
        let (mut ws, _) = tungstenite::client(format!("ws://{address}"), stream).unwrap();
        ws.get_mut().set_nonblocking(true).unwrap();
        assert!(matches!(ws.read(), Err(ref e) if pending(e)));
        send(&mut ws, Message::Binary(vec![42; 256_000])).unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            assert!(Instant::now() < deadline, "lease delivery timed out");
            flush(&mut ws).unwrap();
            match ws.read() {
                Ok(Message::Text(value)) => { assert_eq!(value, "lease"); break; }
                Err(e) if pending(&e) => thread::sleep(Duration::from_millis(5)),
                result => panic!("unexpected result: {result:?}"),
            }
        }
        send(&mut ws, Message::Text("heartbeat".into())).unwrap();
        server.join().unwrap();
    }
}
