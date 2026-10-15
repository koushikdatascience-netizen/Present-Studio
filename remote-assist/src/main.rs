#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#[cfg(not(windows))]
compile_error!("SnapKey Remote Assist supports Windows only");
mod input;
use eframe::egui;
use serde_json::{json, Value};
use std::{sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc}, time::{Duration, Instant}};
use tungstenite::{client::connect_with_config, Message, stream::MaybeTlsStream};
use url::Url;

enum Command { Approve, Stop }
enum Update { Ready(String), Active, Ended(String) }
struct Assist {
    pairing: String, owner: String, status: String, primary_confirmed: bool,
    running: Arc<AtomicBool>, commands: Option<mpsc::Sender<Command>>,
    updates: mpsc::Receiver<Update>, sender: mpsc::Sender<Update>, paired: bool, active: bool, closing: bool,
}
impl Default for Assist {
    fn default() -> Self {
        let (sender, updates) = mpsc::channel();
        Self { pairing: String::new(), owner: String::new(), status: "Paste the pairing text from your meeting.".into(), primary_confirmed: false,
            running: Arc::new(AtomicBool::new(false)), commands: None, updates, sender, paired: false, active: false, closing: false }
    }
}
impl Drop for Assist {
    fn drop(&mut self) { self.running.store(false, Ordering::SeqCst); }
}
impl eframe::App for Assist {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        while let Ok(event) = self.updates.try_recv() {
            match event {
                Update::Ready(owner) => { self.owner = owner; self.paired = true; self.status = "Waiting for your explicit permission. No input is authorized.".into(); }
                Update::Active => { self.active = true; self.status = "CONTROL ACTIVE — press F12 or Stop Control immediately to revoke.".into(); }
                Update::Ended(reason) => { self.active = false; self.paired = false; self.running.store(false, Ordering::SeqCst); self.commands = None; self.status = reason; }
            }
        }
        if ctx.input(|i| i.viewport().close_requested()) && self.commands.is_some() {
            ctx.send_viewport_cmd(egui::ViewportCommand::CancelClose);
            self.closing = true;
            self.running.store(false, Ordering::SeqCst);
            if let Some(tx) = &self.commands { let _ = tx.send(Command::Stop); }
            self.status = "Stopping control and releasing held input before closing...".into();
        }
        if self.closing && self.commands.is_none() {
            ctx.send_viewport_cmd(egui::ViewportCommand::Close);
        }
        egui::CentralPanel::default().show(ctx, |ui| {
            ui.heading("SnapKey Remote Assist");
            if ui.add_sized([450.0, 75.0], egui::Button::new(egui::RichText::new("STOP CONTROL / DENY").size(25.0)).fill(egui::Color32::from_rgb(190, 25, 35))).clicked() {
                self.running.store(false, Ordering::SeqCst);
                if let Some(tx) = &self.commands { let _ = tx.send(Command::Stop); }
            }

            ui.label("Attended Windows assistance only. No service, startup entry, or stored credentials.");
            ui.label(&self.status);
            if self.commands.is_none() {
                ui.label("Short-lived pairing text (keep private):");
                ui.add(egui::TextEdit::singleline(&mut self.pairing).password(true));
                if ui.button("Connect to pending meeting request").clicked() {
                    let pairing = std::mem::take(&mut self.pairing);
                    let (tx, rx) = mpsc::channel(); self.commands = Some(tx);
                    self.running = Arc::new(AtomicBool::new(true));
                    self.primary_confirmed = false;
                    let running = self.running.clone(); let sender = self.sender.clone();
                    std::thread::spawn(move || {
                        let result = std::panic::catch_unwind(|| session(pairing, rx, running.clone(), sender.clone()));
                        running.store(false, Ordering::SeqCst);
                        let reason = match result { Ok(Ok(())) => "Control ended. Pair again for another session.", _ => "Connection failed or authorization expired. All remote input stopped." };
                        let _ = sender.send(Update::Ended(reason.into()));
                    });
                }
            }
            if self.paired && !self.active {
                ui.separator();
                ui.label(format!("Verified requesting owner: {}", self.owner));
                ui.label("Approving shares and controls your entire PRIMARY display, including visible applications. Do not expose passwords or private data. Elevated and secure desktops are unsupported.");
                ui.checkbox(&mut self.primary_confirmed, "I approve the primary display for this owner and this session only");
                if ui.add_enabled(self.primary_confirmed, egui::Button::new("Allow Control")).clicked() {
                    if let Some(tx) = &self.commands { let _ = tx.send(Command::Approve); }
                    self.primary_confirmed = false;
                }
            }
            ui.separator();
            ui.label("Closing this window also stops control. F12 is a local emergency stop.");
        });
        ctx.request_repaint_after(Duration::from_millis(50));
    }
}

fn session(pairing: String, commands: mpsc::Receiver<Command>, running: Arc<AtomicBool>, updates: mpsc::Sender<Update>) -> Result<(), Box<dyn std::error::Error>> {
    let mut origin = Url::parse(pairing.trim())?;
    // Reject credentials, query strings, arbitrary hosts, redirects and untrusted schemes.
    let trusted = Url::parse(option_env!("SNAPKEY_REMOTE_ASSIST_ORIGIN").unwrap_or("https://connect.snapkeystudio.com"))?;
    if trusted.scheme() != "https" || origin.scheme() != "https" || origin.origin() != trusted.origin() || !origin.username().is_empty() || origin.password().is_some() || origin.query().is_some() || origin.path() != "/" { return Err("Untrusted pairing origin".into()); }
    let ticket = origin.fragment().ok_or("Missing pairing credential")?.to_owned();
    if ticket.len() < 32 || ticket.len() > 128 { return Err("Invalid pairing credential".into()); }
    origin.set_fragment(None);
    let client = reqwest::blocking::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(8)).build()?;
    let paired: Value = client.post(origin.join("api/remote-control/pair")?).json(&json!({"ticket":ticket})).send()?.error_for_status()?.json()?;
    let id = paired["id"].as_str().ok_or("Missing session id")?;
    let credential = paired["credential"].as_str().ok_or("Missing helper credential")?;
    let mut endpoint = origin.join("api/remote-control/helper")?; endpoint.set_scheme("wss").map_err(|_| "Invalid scheme")?;
    let (mut ws, _) = connect_with_config(endpoint.as_str(), None, 0)?;
    match ws.get_mut() {
        MaybeTlsStream::Rustls(stream) => { stream.sock.set_read_timeout(Some(Duration::from_millis(100)))?; stream.sock.set_write_timeout(Some(Duration::from_millis(100)))?; }
        _ => return Err("TLS required".into()),
    }
    ws.send(Message::Text(json!({"sessionId":id,"credential":credential}).to_string()))?;
    let mut input = input::InputGuard::new();
    let mut approved_locally = false; let mut active = false;
    let mut lease = Instant::now(); let mut heartbeat = Instant::now() - Duration::from_secs(1);
    let mut last_frame = Instant::now(); let started = Instant::now(); let mut seq: u64 = 0;
    let screen = screenshots::Screen::all()?.into_iter().find(|s| s.display_info.is_primary).ok_or("Primary display unavailable")?;
    while running.load(Ordering::SeqCst) && started.elapsed() < Duration::from_secs(600) {
        if input::emergency_stop() || !input::default_desktop() { break; }
        match commands.try_recv() {
            Ok(Command::Stop) => break,
            Ok(Command::Approve) if !approved_locally => { approved_locally = true; ws.send(Message::Text(json!({"type":"approve"}).to_string()))?; }
            _ => (),
        }
        if lease.elapsed() > Duration::from_millis(1000) { break; }
        if heartbeat.elapsed() >= Duration::from_millis(250) {
            ws.send(Message::Text(json!({"type":"heartbeat"}).to_string()))?;
            heartbeat = Instant::now();
        }
        if active && approved_locally && last_frame.elapsed() >= Duration::from_millis(200) {
            let primary = screenshots::Screen::all()?.into_iter().find(|s| s.display_info.is_primary).ok_or("Primary display missing")?;
            let a = primary.display_info; let b = screen.display_info;
            if a.id != b.id || a.x != b.x || a.y != b.y || a.width != b.width || a.height != b.height { return Err("Display changed; request new approval".into()); }
            let capture = screen.capture()?;
            let image = image::RgbaImage::from_raw(capture.width(), capture.height(), capture.into_raw()).ok_or("Invalid screen")?;
            let image = image::DynamicImage::ImageRgba8(image).resize(1280, 720, image::imageops::FilterType::Triangle).to_rgb8();
            let mut jpeg = Vec::new(); image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 60).encode_image(&image)?;
            if jpeg.len() > 512_000 { return Err("Frame too large".into()); }
            ws.send(Message::Binary(jpeg))?;
            last_frame = Instant::now();
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                if text.len() > 4096 { break; }
                let packet: Value = serde_json::from_str(&text)?;
                match packet["type"].as_str() {
                    Some("ready") => { let owner = packet["ownerName"].as_str().ok_or("Missing owner")?; updates.send(Update::Ready(owner.to_owned()))?; lease = Instant::now(); }
                    Some("lease") => {
                        if packet["active"] == true && !approved_locally { break; }
                        let next = approved_locally && packet["active"] == true;
                        if active && !next { break; }
                        if next && !active { updates.send(Update::Active)?; }
                        active = next; lease = Instant::now();
                    }
                    Some("input") if active && approved_locally && lease.elapsed() < Duration::from_millis(1000) => {
                        let next = packet["seq"].as_u64().ok_or("Missing sequence")?;
                        if next != seq + 1 { break; }
                        seq = next;
                        input.apply(&packet["input"], screen.display_info.x, screen.display_info.y, screen.display_info.width, screen.display_info.height)?;
                    }
                    Some("stop") => break,
                    _ => break,
                }
            }
            Err(tungstenite::Error::Io(error)) if matches!(error.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => (),
            Ok(Message::Ping(_)) | Ok(Message::Pong(_)) => (),
            _ => break,
        }
    }
    // Drop guard releases every held key/button on every return or unwind.
    input.release();
    let _ = ws.send(Message::Text(json!({"type":"stop"}).to_string()));
    let _ = ws.close(None);
    Ok(())
}
fn main() -> eframe::Result {
    let _singleton = input::MachineLock::acquire().expect("SnapKey Remote Assist is already running for this Windows session");
    let options = eframe::NativeOptions { viewport: egui::ViewportBuilder::default().with_title("SnapKey Remote Assist — Attended Control").with_inner_size([560.0, 580.0]).with_min_inner_size([520.0, 500.0]).with_window_level(egui::WindowLevel::AlwaysOnTop).with_minimize_button(false), ..Default::default() };
    eframe::run_native("SnapKey Remote Assist", options, Box::new(|_| Ok(Box::new(Assist::default()))))
}
